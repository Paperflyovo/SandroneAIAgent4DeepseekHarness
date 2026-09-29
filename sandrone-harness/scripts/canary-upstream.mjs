import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { parsePatchedDependencies } from './verify-patches.mjs'

const exec = promisify(execFile)
const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Sandrone patches use zero-context hunks, which only `git apply` accepts with this flag. */
async function tryRun(command, args, options = {}) {
  try {
    const { stdout, stderr } = await exec(command, args, { windowsHide: true, maxBuffer: 32 * 1024 * 1024, ...options })
    return { ok: true, stdout: String(stdout), stderr: String(stderr) }
  } catch (error) {
    return { ok: false, stdout: String(error.stdout ?? ''), stderr: String(error.stderr ?? error.message), code: error.code }
  }
}

/** npm is a .cmd shim on Windows, which Node only spawns through a shell. */
function runNpm(args, options = {}) {
  for (const argument of args) {
    if (!/^[@A-Za-z0-9._/-]+$/.test(argument)) throw new Error(`refusing to run npm with an unsafe argument: ${JSON.stringify(argument)}`)
  }
  if (process.platform !== 'win32') return tryRun('npm', args, options)
  // A single validated command string avoids Node's shell-with-args warning.
  return tryRun(['npm', ...args].join(' '), [], { ...options, shell: true })
}

/**
 * Check whether one patch still applies to an extracted package directory.
 * @param packageDir - extracted `package/` directory of the candidate version.
 * @param patchPath - absolute path to the patch file.
 * @returns outcome and the first conflicting file, when there is one.
 */
export async function patchAppliesTo(packageDir, patchPath) {
  const plain = await tryRun('git', ['apply', '--check', '-p1', patchPath], { cwd: packageDir })
  if (plain.ok) return { status: 'applies', mode: 'context' }
  const zero = await tryRun('git', ['apply', '--check', '-p1', '--unidiff-zero', patchPath], { cwd: packageDir })
  if (zero.ok) return { status: 'applies', mode: 'unidiff-zero' }
  const detail = `${plain.stderr}\n${zero.stderr}`
  const file = /error: ([^\s:]+): patch does not apply/.exec(detail)?.[1]
    ?? /error: patch failed: ([^\s:]+):/.exec(detail)?.[1]
    ?? null
  const line = new RegExp(`error: patch failed: ${file ?? '[^\\s:]+'}:(\\d+)`).exec(detail)?.[1]
  return { status: 'conflicts', mode: null, file, line: line ? Number(line) : null, detail: detail.trim().split('\n').slice(0, 4).join(' | ') }
}

/**
 * Turn one patch outcome into the decision the maintainer actually has to make.
 * A conflicting patch is only work if the patch must survive.
 * @param entry - patches/manifest.json entry for this patch.
 * @param outcome - result from {@link patchAppliesTo}.
 * @returns a one-line recommendation.
 */
export function recommendationFor(entry, outcome) {
  if (outcome.status === 'applies') return 'nothing to do'
  if (outcome.status === 'missing') return 'the upstream package is gone at this version; the patch must be retargeted or dropped'
  if (outcome.status === 'error') return 'could not be checked; inspect manually'
  switch (entry?.reason) {
    case 'upstream-bug':
      return entry.upstreamReport
        ? `CONFLICT — an upstream report exists (${entry.upstreamReport}); check whether it was fixed before re-porting`
        : 'CONFLICT — file an upstream report rather than re-porting this a third time'
    case 'historical-data':
      return 'CONFLICT — decide deliberately: re-port, or accept that pre-0.1.5 sessions stop opening'
    case 'capability':
      return 'CONFLICT — try moving this to a profile or your own preset instead of re-porting'
    case 'preference':
    case 'policy-disagreement':
      return 'CONFLICT — cheapest option is to delete this patch and accept upstream behaviour'
    default:
      return 'CONFLICT — no manifest reason recorded; add one before deciding'
  }
}

async function resolveTarget(target) {
  const result = await runNpm(['view', `@deepseek-ai/dsh@${target}`, 'version', '--json'])
  if (!result.ok) throw new Error(`cannot resolve @deepseek-ai/dsh@${target}: ${result.stderr.trim().split('\n')[0]}`)
  const parsed = JSON.parse(result.stdout)
  const version = Array.isArray(parsed) ? parsed[parsed.length - 1] : parsed
  if (typeof version !== 'string' || !version) throw new Error(`@deepseek-ai/dsh@${target} resolved to ${JSON.stringify(parsed)}`)
  return version
}

/**
 * Predict, without touching the lockfile, which patches a version bump will break.
 * @param options - root, target version or dist-tag, and an optional package filter.
 * @returns per-patch rows plus the decision-relevant summary.
 */
export async function canaryUpstream(options = {}) {
  const root = resolve(options.root ?? DEFAULT_ROOT)
  const only = options.only ? new Set(options.only) : null
  const lock = JSON.parse(await readFile(join(root, 'docs', 'upstream-lock.json'), 'utf8'))
  const currentVersion = lock.packageFamilyVersion
  const target = await resolveTarget(options.target ?? 'latest')
  const declared = parsePatchedDependencies(await readFile(join(root, 'pnpm-workspace.yaml'), 'utf8'))
  const manifest = JSON.parse(await readFile(join(root, 'patches', 'manifest.json'), 'utf8'))

  const work = await mkdtemp(join(tmpdir(), 'sandrone-canary-'))
  const rows = []
  try {
    for (const [declaredPath, key] of declared) {
      const file = declaredPath.split('/').pop()
      if (only && !only.has(key) && !only.has(file)) continue
      const packageName = key.replace(/@[^@]+$/, '')
      const entry = manifest.patches?.[file] ?? null
      const row = { file, key, packageName, reason: entry?.reason ?? null, removeWhen: entry?.removeWhen ?? null, upstreamReport: entry?.upstreamReport ?? null }

      const exists = await runNpm(['view', `${packageName}@${target}`, 'version', '--json'])
      if (!exists.ok) {
        rows.push({ ...row, status: 'missing', detail: `not published at ${target}` })
        continue
      }
      const staging = join(work, packageName.replace(/[@/]/g, '_'))
      await mkdir(staging, { recursive: true })
      const packed = await runNpm(['pack', `${packageName}@${target}`, '--silent'], { cwd: staging })
      const tarball = packed.stdout.trim().split('\n').pop() ?? ''
      if (!packed.ok || !tarball) {
        rows.push({ ...row, status: 'error', detail: `npm pack failed: ${packed.stderr.trim().split('\n')[0]}` })
        continue
      }
      const extracted = await tryRun('tar', ['-xzf', tarball, '-C', staging], { cwd: staging })
      if (!extracted.ok) {
        rows.push({ ...row, status: 'error', detail: `tar failed: ${extracted.stderr.trim().split('\n')[0]}` })
        continue
      }
      const outcome = await patchAppliesTo(join(staging, 'package'), join(root, ...declaredPath.split('/')))
      rows.push({ ...row, ...outcome })
    }
  } finally {
    if (!options.keep) await rm(work, { recursive: true, force: true })
    else console.log(`[canary] kept staging directory: ${work}`)
  }

  rows.sort((left, right) => String(left.status).localeCompare(String(right.status)) || left.file.localeCompare(right.file))
  return { currentVersion, target, rows }
}

/** Render the canary result for a terminal. */
export function formatCanaryReport(report) {
  const lines = [`[canary] pinned ${report.currentVersion} -> candidate ${report.target}`, '']
  const width = Math.max(...report.rows.map(row => row.packageName.length), 12)
  for (const row of report.rows) {
    const mark = row.status === 'applies' ? 'ok      ' : row.status === 'conflicts' ? 'CONFLICT' : row.status.toUpperCase()
    const where = row.status === 'conflicts' && row.file ? ` (${row.file}${row.line ? `:${row.line}` : ''})` : ''
    lines.push(`  ${mark}  ${row.packageName.padEnd(width)}  ${row.reason ?? 'no-reason'}${where}`)
    const advice = recommendationFor({ reason: row.reason, upstreamReport: row.upstreamReport }, row)
    if (row.status !== 'applies') lines.push(`            -> ${advice}`)
    if (row.status === 'error' && row.detail) lines.push(`            -> ${row.detail}`)
  }
  const counts = report.rows.reduce((total, row) => ({ ...total, [row.status]: (total[row.status] ?? 0) + 1 }), {})
  lines.push('')
  lines.push(`[canary] ${report.rows.length} patch(es): ${Object.entries(counts).map(([status, count]) => `${status}=${count}`).join(' ')}`)
  const conflicts = report.rows.filter(row => row.status === 'conflicts')
  const deletable = conflicts.filter(row => ['preference', 'policy-disagreement'].includes(row.reason))
  if (deletable.length) {
    lines.push(`[canary] ${deletable.length} conflict(s) are preference-class — deleting them is cheaper than re-porting:`)
    for (const row of deletable) lines.push(`  - ${row.packageName}: ${row.removeWhen ?? 'no removal condition recorded'}`)
  }
  if (conflicts.length === 0 && report.rows.every(row => row.status === 'applies')) {
    lines.push('[canary] every patch still applies; the bump is mechanical (rename files and update the pins)')
  }
  return lines.join('\n')
}

function parseArguments(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--keep') options.keep = true
    else if (argument === '--version' || argument === '--only') {
      const value = argv[index + 1]
      if (value === undefined) throw new Error(`${argument} needs a value`)
      if (argument === '--version') options.target = value
      else options.only = [...(options.only ?? []), value]
      index += 1
    } else throw new Error(`unknown argument: ${argument}`)
  }
  return options
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  const report = await canaryUpstream(options)
  console.log(formatCanaryReport(report))
  if (report.rows.some(row => row.status === 'conflicts' || row.status === 'missing' || row.status === 'error')) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main()
}

export { DEFAULT_ROOT, resolveTarget }
