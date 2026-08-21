import { access, readdir, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_VERSION = '0.1.1-rc.1'

const REQUIRED_PACKAGES = Object.freeze({
  '@deepseek-ai/dsh': { bin: 'dsh' },
  '@deepseek-ai/dsh-base': { bundlePatch: true },
  '@deepseek-ai/dsh-web-app': { bundlePatch: true },
  '@deepseek-ai/dsh-client-runtime': { export: './client' },
  '@deepseek-ai/dsh-client-ui-layout': { export: './client' },
  '@deepseek-ai/dsh-client-ui-primitives': { export: '.' },
  '@deepseek-ai/dsh-client-ui-slots': { export: '.' },
  '@deepseek-ai/dsh-client-ui-theme': { export: './client' },
})

function dependencyEntries(manifest) {
  return Object.entries({
    ...(manifest.dependencies ?? {}),
    ...(manifest.optionalDependencies ?? {}),
    ...(manifest.peerDependencies ?? {}),
  })
}

function manifestExport(manifest, key) {
  if (key === '.' && (typeof manifest.exports === 'string' || manifest.exports?.default)) {
    return typeof manifest.exports === 'string' ? manifest.exports : manifest.exports.default
  }
  const value = manifest.exports?.[key]
  return typeof value === 'string' ? value : value?.default
}

function packageJsonPath(packageName, root, resolvePackageJson) {
  if (resolvePackageJson) return resolvePackageJson(packageName, root)
  const requireFromRoot = createRequire(join(root, 'package.json'))
  return requireFromRoot.resolve(`${packageName}/package.json`)
}

async function inspectPackage(packageName, rule, root, resolvePackageJson) {
  let manifestPath
  try {
    manifestPath = packageJsonPath(packageName, root, resolvePackageJson)
  } catch (error) {
    return { packageName, errors: [`is not installed (${error.code ?? error.message})`] }
  }
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const packageRoot = dirname(manifestPath)
  const errors = []
  if (manifest.name !== packageName) errors.push(`resolved manifest name is ${String(manifest.name)}`)
  if (manifest.version !== DEFAULT_VERSION) errors.push(`resolved version is ${String(manifest.version)}, expected ${DEFAULT_VERSION}`)

  if (rule.bin) {
    const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[rule.bin]
    if (!bin) errors.push(`does not expose the ${rule.bin} CLI`)
    else if (!(await exists(join(packageRoot, bin)))) errors.push(`CLI target is missing: ${bin}`)
  }
  if (rule.export) {
    const target = manifestExport(manifest, rule.export)
    if (!target) errors.push(`does not expose public entry ${rule.export}`)
    else if (!(await exists(join(packageRoot, target)))) errors.push(`public entry target is missing: ${target}`)
  }
  if (rule.bundlePatch) {
    const patch = manifest.dsh?.bundle?.patch
    if (typeof patch !== 'string') errors.push('does not declare dsh.bundle.patch')
    else if (!(await exists(join(packageRoot, patch)))) errors.push(`bundle patch is missing: ${patch}`)
    if (!manifestExport(manifest, './cordis.patch.yml')) errors.push('does not export ./cordis.patch.yml')
  }

  return { packageName, manifestPath, manifest, errors }
}

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function collectWorkspaceManifests(root) {
  const manifests = [{ path: join(root, 'package.json'), manifest: JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) }]
  for (const directory of ['apps', 'packages']) {
    const parent = join(root, directory)
    let entries
    try {
      entries = await readdir(parent, { withFileTypes: true })
    } catch (error) {
      if (error.code === 'ENOENT') continue
      throw error
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const path = join(parent, entry.name, 'package.json')
      if (!(await exists(path))) continue
      manifests.push({ path, manifest: JSON.parse(await readFile(path, 'utf8')) })
    }
  }
  return manifests
}

function exactDshFamilyProblems(manifest, label = 'package.json') {
  const problems = []
  for (const [name, version] of dependencyEntries(manifest)) {
    if (!name.startsWith('@deepseek-ai/dsh')) continue
    if (version !== DEFAULT_VERSION) problems.push(`${label}: ${name} is ${version}, expected exact ${DEFAULT_VERSION}`)
  }
  return problems
}

async function bundlePatchProblems(result, expectedIds) {
  if (!result.manifestPath || !result.manifest?.dsh?.bundle?.patch) return []
  const patchPath = join(dirname(result.manifestPath), result.manifest.dsh.bundle.patch)
  const source = await readFile(patchPath, 'utf8')
  return expectedIds
    .filter(id => !new RegExp(`\\bid:\\s*${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(source))
    .map(id => `${result.packageName} bundle patch is missing required row ${id}`)
}

function patchProblems(source) {
  const problems = []
  if (!/-\s+insert:\s*[\s\S]*?id:\s*sandrone-ui\s*[\s\S]*?name:\s*['"]?@sandrone\/harness-ui['"]?/m.test(source)) {
    problems.push('Sandrone profile patch does not insert @sandrone/harness-ui')
  }
  if (!/-\s+id:\s*session-query-sqlite\s*[\s\S]*?openAt:\s*first-search/m.test(source)) {
    problems.push('Sandrone profile patch does not enable official first-search session indexing')
  }
  if (!/-\s+id:\s*directory-picker\s*[\s\S]*?disabled:\s*true/m.test(source)) {
    problems.push('Sandrone profile patch does not disable the incompatible automatic native directory picker')
  }
  if (!/name:\s*['"]?@deepseek-ai\/dsh-host-directory-picker-browse['"]?/m.test(source)) {
    problems.push('Sandrone profile patch does not mount the official browse directory picker backend')
  }
  if (!/name:\s*['"]?@deepseek-ai\/dsh-client-ui-directory-picker-browse['"]?/m.test(source)) {
    problems.push('Sandrone profile patch does not mount the official browse directory picker surface')
  }
  if (/\b(?:agent-loop|session-persistence|llm-deepseek|api-gateway)\b/.test(source)) {
    problems.push('Sandrone profile patch overrides an official backend owner')
  }
  return problems
}

/** Verify the exact upstream package family, public entries, and profile composition. */
export async function verifyUpstream(options = {}) {
  const root = resolve(options.root ?? DEFAULT_ROOT)
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  const lock = JSON.parse(await readFile(join(root, 'docs', 'upstream-lock.json'), 'utf8'))
  const patch = await readFile(join(root, 'profiles', 'sandrone-web.patch.yml'), 'utf8')
  const errors = []

  const workspaceManifests = await collectWorkspaceManifests(root)
  for (const workspace of workspaceManifests) {
    errors.push(...exactDshFamilyProblems(workspace.manifest, workspace.path.slice(root.length + 1).replaceAll('\\', '/')))
  }
  for (const name of Object.keys(REQUIRED_PACKAGES)) {
    if (manifest.dependencies?.[name] !== DEFAULT_VERSION) {
      errors.push(`${name} must be a direct dependency pinned to ${DEFAULT_VERSION}`)
    }
  }
  if (lock.npmVersion !== DEFAULT_VERSION || lock.packageFamilyVersion !== DEFAULT_VERSION) {
    errors.push(`docs/upstream-lock.json must pin npm and package family to ${DEFAULT_VERSION}`)
  }
  errors.push(...patchProblems(patch))

  const packages = []
  for (const [packageName, rule] of Object.entries(REQUIRED_PACKAGES)) {
    const result = await inspectPackage(packageName, rule, root, options.resolvePackageJson)
    packages.push(result)
    for (const error of result.errors) errors.push(`${packageName} ${error}`)
  }

  const base = packages.find(item => item.packageName === '@deepseek-ai/dsh-base')?.manifest
  const web = packages.find(item => item.packageName === '@deepseek-ai/dsh-web-app')?.manifest
  const baseResult = packages.find(item => item.packageName === '@deepseek-ai/dsh-base')
  const webResult = packages.find(item => item.packageName === '@deepseek-ai/dsh-web-app')
  if (base && web) {
    if (base.dsh?.bundle?.patch !== './cordis.patch.yml') errors.push('@deepseek-ai/dsh-base patch declaration changed')
    if (web.dsh?.bundle?.patch !== './cordis.patch.yml') errors.push('@deepseek-ai/dsh-web-app patch declaration changed')
    errors.push(...await bundlePatchProblems(baseResult, ['session', 'agent-loop', 'settings', 'credentials']))
    errors.push(...await bundlePatchProblems(webResult, ['api-gateway', 'connection', 'client-runtime', 'ui-layout']))
  }

  return { root, expectedVersion: DEFAULT_VERSION, packages, errors }
}

export function formatUpstreamReport(report) {
  if (report.errors.length === 0) {
    return `upstream verification passed (${report.packages.length} packages at ${report.expectedVersion})`
  }
  return [
    `upstream verification failed with ${report.errors.length} problem(s):`,
    ...report.errors.map(error => `- ${error}`),
    'Install the locked dependencies before running the real upstream gate.',
  ].join('\n')
}

async function main() {
  const report = await verifyUpstream({ root: process.argv[2] ? resolve(process.argv[2]) : DEFAULT_ROOT })
  const output = formatUpstreamReport(report)
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

export { DEFAULT_VERSION, REQUIRED_PACKAGES }
