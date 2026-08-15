import { readdir, readFile, stat } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE_EXTENSIONS = new Set(['.cjs', '.css', '.html', '.js', '.jsx', '.mjs', '.ts', '.tsx', '.vue'])
const SKIPPED_DIRECTORIES = new Set([
  '.git',
  '.codex-npm-cache',
  '.codex-npm-packs',
  'dist',
  'node_modules',
  'release',
  'runtime',
])

const FORBIDDEN_PATH_SEGMENTS = [
  /(^|\/)src\/server(?:\/|$)/i,
  /(^|\/)server\/ws(?:\/|$)/i,
  /(^|\/)agent\/eventstream\.[cm]?[jt]sx?$/i,
  /(^|\/)agent\/gateway\.[cm]?[jt]sx?$/i,
  /(^|\/)agent\/transcriptprojector\.[cm]?[jt]sx?$/i,
]

const FORBIDDEN_IMPORTS = [
  {
    name: 'DeepSeek private source import',
    pattern: /(?:from\s*|import\s*(?:\(\s*)?|require\s*\(\s*)['"]@deepseek-ai\/[^'"]+\/src(?:\/[^'"]*)?['"]/g,
  },
  {
    name: 'legacy Sandrone server import',
    pattern: /(?:from\s*|import\s*(?:\(\s*)?|require\s*\(\s*)['"][^'"]*(?:src\/server|server\/ws)(?:\/[^'"]*)?['"]/gi,
  },
]

const FORBIDDEN_IMPLEMENTATIONS = [
  {
    name: 'parallel WebSocket transport',
    pattern: /\b(?:new\s+WebSocket|WebSocketServer|(?:from\s*|require\s*\()[^\n]*['"](?:ws|isomorphic-ws)['"])/g,
  },
  {
    name: 'parallel provider proxy',
    pattern: /\b(?:providerProxy|proxyProvider|ProviderProxy|provider[_-]?proxy)\b/g,
  },
]

function extensionOf(path) {
  const index = path.lastIndexOf('.')
  return index < 0 ? '' : path.slice(index).toLowerCase()
}

async function collectFiles(root, directory = root, output = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIPPED_DIRECTORIES.has(entry.name)) continue
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) await collectFiles(root, path, output)
    else if (entry.isFile() && SOURCE_EXTENSIONS.has(extensionOf(entry.name))) output.push(path)
  }
  return output
}

function normalizeRelative(root, path) {
  return relative(root, path).split(sep).join('/')
}

function lineNumber(source, index) {
  let line = 1
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (source.charCodeAt(cursor) === 10) line += 1
  }
  return line
}

function scanPattern(violations, file, source, rule) {
  rule.pattern.lastIndex = 0
  for (let match = rule.pattern.exec(source); match; match = rule.pattern.exec(source)) {
    violations.push({ file, line: lineNumber(source, match.index), rule: rule.name, match: match[0] })
    if (match[0].length === 0) rule.pattern.lastIndex += 1
  }
}

/**
 * Inspect production sources for architecture violations.
 *
 * Tests and verification scripts are excluded because they must name the rejected
 * patterns in fixtures and assertions. Production code remains the enforced surface.
 */
export async function verifyArchitecture(options = {}) {
  const root = resolve(options.root ?? DEFAULT_ROOT)
  const files = await collectFiles(root)
  const violations = []

  for (const absolute of files) {
    const file = normalizeRelative(root, absolute)
    if (file.startsWith('tests/') || file.startsWith('scripts/verify-')) continue
    for (const pattern of FORBIDDEN_PATH_SEGMENTS) {
      if (pattern.test(file)) violations.push({ file, line: 1, rule: 'legacy backend path', match: file })
    }
    const source = await readFile(absolute, 'utf8')
    for (const rule of FORBIDDEN_IMPORTS) scanPattern(violations, file, source, rule)
    for (const rule of FORBIDDEN_IMPLEMENTATIONS) scanPattern(violations, file, source, rule)
  }

  return { root, filesScanned: files.length, violations }
}

export function formatArchitectureReport(report) {
  if (report.violations.length === 0) {
    return `architecture verification passed (${report.filesScanned} source files scanned)`
  }
  return [
    `architecture verification failed with ${report.violations.length} violation(s):`,
    ...report.violations.map(item => `- ${item.file}:${item.line} [${item.rule}] ${item.match}`),
  ].join('\n')
}

async function main() {
  const root = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_ROOT
  const rootStat = await stat(root).catch(() => null)
  if (!rootStat?.isDirectory()) throw new Error(`Architecture root is not a directory: ${root}`)
  const report = await verifyArchitecture({ root })
  const output = formatArchitectureReport(report)
  if (report.violations.length > 0) {
    console.error(output)
    process.exitCode = 1
  } else {
    console.log(output)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main()
}
