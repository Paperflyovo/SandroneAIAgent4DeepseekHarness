'use strict'

const fs = require('node:fs')
const path = require('node:path')

const MAX_ENTRIES = 800
const MAX_TEXT_BYTES = 1024 * 1024

function isInside(root, target) {
  const relative = path.relative(root, target)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

function normalizedRelativePath(value) {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value !== 'string' || value.length > 32_768 || value.includes('\0') || path.isAbsolute(value) || path.win32.isAbsolute(value)) {
    throw new Error('Invalid workspace-relative path')
  }
  const normalized = path.normalize(value)
  if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) throw new Error('Workspace path escapes its root')
  return normalized === '.' ? '' : normalized
}

function resolveWorkspaceTarget(root, relativePath, allowedRoots, fsApi = fs) {
  if (typeof root !== 'string' || !root.trim()) throw new Error('Workspace root is required')
  const realpath = fsApi.realpathSync.native ?? fsApi.realpathSync
  const requestedRoot = realpath(path.resolve(root))
  const allowed = allowedRoots.some(candidate => {
    if (typeof candidate !== 'string' || !candidate.trim()) return false
    try { return realpath(path.resolve(candidate)) === requestedRoot } catch { return false }
  })
  if (!allowed) throw new Error('Workspace is not registered by DeepSeek Harness')
  const relative = normalizedRelativePath(relativePath)
  const requested = path.resolve(requestedRoot, relative)
  if (!isInside(requestedRoot, requested)) throw new Error('Workspace path escapes its root')
  const target = realpath(requested)
  if (!isInside(requestedRoot, target)) throw new Error('Workspace symlink escapes its root')
  return { root: requestedRoot, target, relative }
}

function listWorkspaceDirectory(root, relativePath, allowedRoots, options = {}) {
  const fsApi = options.fs ?? fs
  const resolved = resolveWorkspaceTarget(root, relativePath, allowedRoots, fsApi)
  if (!fsApi.statSync(resolved.target).isDirectory()) throw new Error('Workspace target is not a directory')
  const entries = fsApi.readdirSync(resolved.target, { withFileTypes: true })
    .filter(entry => !entry.isSymbolicLink())
    .map(entry => ({
      name: entry.name,
      path: resolved.relative ? path.join(resolved.relative, entry.name) : entry.name,
      directory: entry.isDirectory(),
      hidden: entry.name.startsWith('.'),
    }))
    .sort((left, right) => Number(right.directory) - Number(left.directory) || left.name.localeCompare(right.name))
  return {
    root: resolved.root,
    path: resolved.relative,
    parent: resolved.relative ? path.dirname(resolved.relative) === '.' ? '' : path.dirname(resolved.relative) : null,
    entries: entries.slice(0, options.maxEntries ?? MAX_ENTRIES),
    truncated: entries.length > (options.maxEntries ?? MAX_ENTRIES),
  }
}

function readWorkspaceFile(root, relativePath, allowedRoots, options = {}) {
  const fsApi = options.fs ?? fs
  const resolved = resolveWorkspaceTarget(root, relativePath, allowedRoots, fsApi)
  const stat = fsApi.statSync(resolved.target)
  if (!stat.isFile()) throw new Error('Workspace target is not a file')
  const maxBytes = options.maxBytes ?? MAX_TEXT_BYTES
  if (stat.size > maxBytes) return { path: resolved.relative, name: path.basename(resolved.target), size: stat.size, kind: 'large' }
  const bytes = fsApi.readFileSync(resolved.target)
  if (bytes.includes(0)) return { path: resolved.relative, name: path.basename(resolved.target), size: stat.size, kind: 'binary' }
  return {
    path: resolved.relative,
    name: path.basename(resolved.target),
    size: stat.size,
    kind: 'text',
    text: bytes.toString('utf8'),
  }
}

module.exports = {
  MAX_ENTRIES,
  MAX_TEXT_BYTES,
  listWorkspaceDirectory,
  readWorkspaceFile,
  resolveWorkspaceTarget,
}
