import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Reasons that count against the preference budget. */
const PREFERENCE_REASONS = Object.freeze(['preference', 'policy-disagreement'])

/** Version pins that must all agree with docs/upstream-lock.json. */
const VERSION_PIN_PROBES = Object.freeze([
  { file: '.pnpmfile.cjs', label: '.pnpmfile.cjs version constant', pattern: /const\s+version\s*=\s*['"]([^'"]+)['"]/ },
  { file: 'scripts/verify-upstream.mjs', label: 'verify-upstream DEFAULT_VERSION', pattern: /const\s+DEFAULT_VERSION\s*=\s*['"]([^'"]+)['"]/ },
  { file: 'apps/desktop/lib/upgrade-backup.cjs', label: 'upgrade-backup TARGET_VERSION', pattern: /TARGET_VERSION\s*=\s*['"]([^'"]+)['"]/ },
])

const FAMILY_PREFIX = /^@deepseek-ai\/dsh(?:-|$)/

/**
 * Read the `patchedDependencies` rows from a pnpm workspace manifest.
 * @param source - pnpm-workspace.yaml contents.
 * @returns declared patch path to dependency key.
 */
export function parsePatchedDependencies(source) {
  const declared = new Map()
  for (const match of source.matchAll(/^\s*'([^']+)':\s*(\S+\.patch)\s*$/gm)) {
    declared.set(match[2], match[1])
  }
  return declared
}

function requires(root, relative) {
  return readFile(join(root, ...relative.split('/')), 'utf8')
}

/**
 * Verify the patch inventory and every version pin that must track upstream.
 * @param root - Sandrone harness root.
 * @returns problems, advisory notes, and the pinned family version.
 */
export async function verifyPatches(root = DEFAULT_ROOT) {
  const errors = []
  const notes = []

  let lock
  try {
    lock = JSON.parse(await requires(root, 'docs/upstream-lock.json'))
  } catch (error) {
    return { expectedVersion: null, entries: {}, errors: [`docs/upstream-lock.json is unreadable: ${error.message}`], notes }
  }
  const expectedVersion = lock.packageFamilyVersion
  if (typeof expectedVersion !== 'string' || expectedVersion.trim() === '') {
    return { expectedVersion: null, entries: {}, errors: ['docs/upstream-lock.json lacks packageFamilyVersion'], notes }
  }
  for (const field of ['npmVersion']) {
    if (lock[field] !== expectedVersion) errors.push(`docs/upstream-lock.json: ${field} is ${String(lock[field])}, expected ${expectedVersion}`)
  }
  if (lock.auditedSource?.version !== expectedVersion) {
    errors.push(`docs/upstream-lock.json: auditedSource.version is ${String(lock.auditedSource?.version)}, expected ${expectedVersion}`)
  }

  // Every place that restates the pinned version must agree, so a bump either
  // updates all of them or fails here with the exact list.
  for (const probe of VERSION_PIN_PROBES) {
    let source
    try {
      source = await requires(root, probe.file)
    } catch (error) {
      errors.push(`${probe.file} is unreadable: ${error.message}`)
      continue
    }
    const found = probe.pattern.exec(source)?.[1]
    if (found === undefined) errors.push(`${probe.file} does not declare ${probe.label}`)
    else if (found !== expectedVersion) errors.push(`${probe.label} is ${found}, expected ${expectedVersion}`)
  }

  const manifest = JSON.parse(await requires(root, 'package.json'))
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const [name, version] of Object.entries(manifest[section] ?? {})) {
      if (!FAMILY_PREFIX.test(name)) continue
      if (version !== expectedVersion) errors.push(`package.json ${section}: ${name} is ${version}, expected ${expectedVersion}`)
    }
  }

  const workspaceSource = await requires(root, 'pnpm-workspace.yaml')
  const declared = parsePatchedDependencies(workspaceSource)
  const files = (await readdir(join(root, 'patches'))).filter(name => name.endsWith('.patch')).sort()

  for (const declaredPath of declared.keys()) {
    if (!files.includes(declaredPath.split('/').pop())) errors.push(`pnpm-workspace.yaml declares ${declaredPath}, which does not exist`)
  }

  let manifestPatches = {}
  let preferenceBudget = null
  let allowedReasons = []
  try {
    const patchManifest = JSON.parse(await requires(root, 'patches/manifest.json'))
    manifestPatches = patchManifest.patches ?? {}
    preferenceBudget = patchManifest.preferenceBudget
    allowedReasons = patchManifest.reasons ?? []
  } catch (error) {
    errors.push(`patches/manifest.json is unreadable: ${error.message}`)
  }
  const allowed = new Set(allowedReasons)

  for (const file of files) {
    if (manifestPatches[file] === undefined) {
      errors.push(`patches/${file} has no patches/manifest.json entry; every carried patch states its reason and its removal condition`)
    }
  }
  for (const [file, entry] of Object.entries(manifestPatches)) {
    const declaredPath = `patches/${file}`
    if (!files.includes(file)) errors.push(`patches/manifest.json lists ${file}, which does not exist`)
    else if (!declared.has(declaredPath)) errors.push(`patches/manifest.json lists ${file}, which pnpm-workspace.yaml does not declare`)
    if (!allowed.has(entry.reason)) {
      errors.push(`patches/${file} reason ${JSON.stringify(entry.reason)} is not one of: ${allowedReasons.join(', ')}`)
    }
    for (const field of ['package', 'summary', 'removeWhen', 'lastVerified']) {
      if (typeof entry[field] !== 'string' || entry[field].trim() === '') errors.push(`patches/${file} is missing ${field}`)
    }
    if (entry.lastVerified !== expectedVersion) {
      errors.push(
        `patches/${file} was last verified against ${String(entry.lastVerified)}; re-check it against ${expectedVersion}` +
        ' and update lastVerified, or delete the patch',
      )
    }
  }

  const anyVersion = /@(\d[^@/]*)\.patch$/
  for (const file of files) {
    const version = anyVersion.exec(file)?.[1]
    if (version !== undefined && version !== expectedVersion) {
      errors.push(`patches/${file} is named for ${version}, expected ${expectedVersion}`)
    }
  }
  for (const [declaredPath, key] of declared) {
    const version = key.split('@').pop()
    if (version !== expectedVersion) errors.push(`pnpm-workspace.yaml key ${key} is pinned to ${version}, expected ${expectedVersion}`)
    if (!declaredPath.includes(`@${expectedVersion}`)) errors.push(`pnpm-workspace.yaml row ${declaredPath} is not named for ${expectedVersion}`)
  }

  const preferenceClass = Object.entries(manifestPatches).filter(([, entry]) => PREFERENCE_REASONS.includes(entry.reason))
  if (!Number.isInteger(preferenceBudget) || preferenceBudget < 0) {
    errors.push('patches/manifest.json needs a non-negative integer preferenceBudget')
  } else if (preferenceClass.length > preferenceBudget) {
    errors.push(
      `preference-class patches are ${preferenceClass.length} but preferenceBudget is ${preferenceBudget}: ` +
      `${preferenceClass.map(([file]) => file).join(', ')}. Delete one, or get a reason that survives review before adding another.`,
    )
  } else if (preferenceClass.length === preferenceBudget) {
    notes.push(
      `preference budget is exhausted (${preferenceClass.length}/${preferenceBudget}); the next preference-class patch is refused ` +
      'unless one is deleted first. Lower preferenceBudget whenever you delete one.',
    )
  }

  const byReason = new Map()
  for (const entry of Object.values(manifestPatches)) {
    byReason.set(entry.reason, (byReason.get(entry.reason) ?? 0) + 1)
  }

  return {
    expectedVersion,
    entries: manifestPatches,
    counts: Object.fromEntries([...byReason].sort()),
    notes,
    errors,
  }
}

/** Render one verification result for a terminal. */
export function formatPatchReport(report) {
  const lines = []
  if (report.errors.length === 0) {
    const counts = Object.entries(report.counts ?? {}).map(([reason, count]) => `${reason}=${count}`).join(' ')
    lines.push(`patch inventory passed (${Object.keys(report.entries).length} patches at ${report.expectedVersion}${counts ? `; ${counts}` : ''})`)
  } else {
    lines.push(`patch inventory failed with ${report.errors.length} problem(s):`)
    for (const error of report.errors) lines.push(`- ${error}`)
  }
  for (const note of report.notes ?? []) lines.push(`note: ${note}`)
  return lines.join('\n')
}

async function main() {
  const report = await verifyPatches(process.argv[2] ? resolve(process.argv[2]) : DEFAULT_ROOT)
  const output = formatPatchReport(report)
  if (report.errors.length > 0) {
    console.error(output)
    process.exitCode = 1
  } else {
    console.log(output)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main()
}

export { DEFAULT_ROOT, PREFERENCE_REASONS, VERSION_PIN_PROBES }
