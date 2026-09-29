'use strict'

const fs = require('node:fs')
const path = require('node:path')

const MAX_SPACES = 200
const MAX_DOCUMENTS = 2000
const MAX_MARKDOWN_BYTES = 4 * 1024 * 1024
const MAX_RESOURCE_BYTES = 32 * 1024 * 1024
const MAX_RESOURCES = 2000
const MAX_SEARCH_RESULTS = 500
const SPACE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/
const TRASH_ID_PATTERN = /^[0-9]+-[a-z0-9]{6,12}$/

function assertInside(root, target) {
  const relative = path.relative(root, target)
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Space path escapes the space directory')
  }
}

function safeRelative(value, label = 'Space path') {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512 || value.includes('\0')) {
    throw new Error(`${label} is invalid`)
  }
  if (path.isAbsolute(value) || path.win32.isAbsolute(value)) throw new Error(`${label} must be relative`)
  const normalized = path.normalize(value)
  if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) throw new Error(`${label} escapes its root`)
  return normalized.split(path.sep).join('/')
}

function safeSpaceId(value) {
  const id = String(value || '').trim().toLowerCase()
  if (!SPACE_ID_PATTERN.test(id)) throw new Error('Space name must use letters, numbers, hyphens, or underscores')
  return id
}

function spaceIdFromName(name) {
  const value = String(name || '').trim().toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
  const ascii = value.replace(/[^a-z0-9_-]/g, '').slice(0, 64)
  return safeSpaceId(ascii || 'space')
}

function atomicWrite(target, bytes) {
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(temporary, bytes)
  try {
    fs.renameSync(temporary, target)
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }) } catch {}
    throw error
  }
}

function metadataPath(root, id) {
  return path.join(root, id, 'space.json')
}

function defaultMetadata(id, name = id) {
  const now = new Date().toISOString()
  return { version: 1, id, name: String(name || id), createdAt: now, updatedAt: now }
}

function ensureLayout(root, id) {
  const directory = path.join(root, id)
  assertInside(root, directory)
  fs.mkdirSync(path.join(directory, 'md'), { recursive: true })
  fs.mkdirSync(path.join(directory, 'res'), { recursive: true })
  if (!fs.existsSync(metadataPath(root, id))) atomicWrite(metadataPath(root, id), `${JSON.stringify(defaultMetadata(id))}\n`)
  return directory
}

function readMetadata(root, id) {
  const safeId = safeSpaceId(id)
  const target = metadataPath(root, safeId)
  let value
  try {
    value = JSON.parse(fs.readFileSync(target, 'utf8'))
  } catch (error) {
    throw new Error(`Space metadata is invalid: ${error.message}`)
  }
  if (!value || value.id !== safeId || typeof value.name !== 'string') throw new Error('Space metadata is invalid')
  return { ...defaultMetadata(safeId), ...value, id: safeId }
}

function listFiles(root, directory, extension, limit, relative = '') {
  if (!fs.existsSync(directory)) return []
  const entries = fs.readdirSync(directory, { withFileTypes: true })
  const output = []
  for (const entry of entries) {
    if (output.length >= limit) break
    if (entry.name.startsWith('.')) continue
    const childRelative = relative ? path.join(relative, entry.name) : entry.name
    const child = path.join(directory, entry.name)
    if (entry.isDirectory()) output.push(...listFiles(root, child, extension, limit - output.length, childRelative))
    else if (entry.isFile() && (!extension || entry.name.toLowerCase().endsWith(extension))) output.push(childRelative.split(path.sep).join('/'))
  }
  return output.sort((left, right) => left.localeCompare(right))
}

function listDirectories(directory, limit, relative = '') {
  if (!fs.existsSync(directory)) return []
  const entries = fs.readdirSync(directory, { withFileTypes: true })
  const output = []
  for (const entry of entries) {
    if (output.length >= limit) break
    if (entry.name.startsWith('.')) continue
    if (!entry.isDirectory()) continue
    const childRelative = relative ? path.join(relative, entry.name) : entry.name
    output.push(childRelative.split(path.sep).join('/'))
    output.push(...listDirectories(path.join(directory, entry.name), limit - output.length, childRelative))
  }
  return output.sort((left, right) => left.localeCompare(right))
}

function createSpace(root, name) {
  fs.mkdirSync(root, { recursive: true })
  const displayName = String(name || '').trim()
  if (!displayName || displayName.length > 80) throw new Error('Space name is required')
  const base = spaceIdFromName(displayName)
  let id = base
  for (let index = 2; fs.existsSync(path.join(root, id)); index += 1) id = `${base}-${index}`
  if (id.length > 64) throw new Error('Space name is too long')
  ensureLayout(root, id)
  const metadata = { ...defaultMetadata(id, displayName) }
  atomicWrite(metadataPath(root, id), `${JSON.stringify(metadata, null, 2)}\n`)
  return metadata
}

function listSpaces(root) {
  fs.mkdirSync(root, { recursive: true })
  return fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && SPACE_ID_PATTERN.test(entry.name))
    .slice(0, MAX_SPACES)
    .map(entry => readMetadata(root, entry.name))
    .sort((left, right) => left.name.localeCompare(right.name))
}

function getSpace(root, id) {
  const safeId = safeSpaceId(id)
  const directory = ensureLayout(root, safeId)
  const metadata = readMetadata(root, safeId)
  return { ...metadata, directory }
}

function renameSpace(root, id, name) {
  const space = getSpace(root, id)
  const displayName = String(name || '').trim()
  if (!displayName || displayName.length > 80) throw new Error('Space name is required')
  const metadata = { ...space, directory: undefined, name: displayName, updatedAt: new Date().toISOString() }
  delete metadata.directory
  atomicWrite(metadataPath(root, space.id), `${JSON.stringify(metadata, null, 2)}\n`)
  return metadata
}

function listDocuments(root, id) {
  const space = getSpace(root, id)
  return listFiles(space.directory, path.join(space.directory, 'md'), '.md', MAX_DOCUMENTS)
}

function listFolders(root, id) {
  const space = getSpace(root, id)
  return listDirectories(path.join(space.directory, 'md'), MAX_DOCUMENTS)
}

function createDirectory(root, id, relativePath) {
  const space = getSpace(root, id)
  const relative = safeRelative(relativePath, 'Folder path')
  if (!relative || relative === '.') throw new Error('Folder path is required')
  const target = path.resolve(space.directory, 'md', relative)
  assertInside(path.resolve(space.directory, 'md'), target)
  fs.mkdirSync(target, { recursive: true })
  return { path: relative }
}

function listResources(root, id) {
  const space = getSpace(root, id)
  return listFiles(space.directory, path.join(space.directory, 'res'), '', MAX_RESOURCES).map(relative => {
    const target = path.join(space.directory, 'res', relative)
    const stat = fs.statSync(target)
    return { path: relative, size: stat.size, updatedAt: stat.mtime.toISOString() }
  })
}

function searchSpaces(root, query) {
  const needle = String(query || '').trim().toLocaleLowerCase()
  if (!needle) return []
  const results = []
  for (const space of listSpaces(root)) {
    for (const relative of listDocuments(root, space.id)) {
      if (results.length >= MAX_SEARCH_RESULTS) return results
      const document = readMarkdown(root, space.id, relative)
      const relativeIndex = relative.toLocaleLowerCase().indexOf(needle)
      const contentIndex = document.content.toLocaleLowerCase().indexOf(needle)
      if (relativeIndex < 0 && contentIndex < 0) continue
      const source = contentIndex >= 0 ? document.content : relative
      const matchIndex = contentIndex >= 0 ? contentIndex : relativeIndex
      const start = Math.max(0, matchIndex - 72)
      const end = Math.min(source.length, matchIndex + needle.length + 120)
      const snippet = source.slice(start, end).replace(/\s+/g, ' ').trim()
      results.push({
        spaceId: space.id,
        spaceName: space.name,
        path: relative,
        snippet: `${start > 0 ? '…' : ''}${snippet}${end < source.length ? '…' : ''}`,
      })
    }
  }
  return results
}

function resolveDocument(root, id, relativePath) {
  const space = getSpace(root, id)
  const relative = safeRelative(relativePath, 'Markdown path')
  if (!relative.toLowerCase().endsWith('.md')) throw new Error('Markdown path must end with .md')
  const target = path.resolve(space.directory, 'md', relative)
  assertInside(path.resolve(space.directory, 'md'), target)
  return { space, relative, target }
}

function readMarkdown(root, id, relativePath) {
  const resolved = resolveDocument(root, id, relativePath)
  if (!fs.existsSync(resolved.target)) return { path: resolved.relative, content: '' }
  const stat = fs.statSync(resolved.target)
  if (!stat.isFile() || stat.size > MAX_MARKDOWN_BYTES) throw new Error('Markdown document is too large')
  return { path: resolved.relative, content: fs.readFileSync(resolved.target, 'utf8'), updatedAt: stat.mtime.toISOString() }
}

function writeMarkdown(root, id, relativePath, content) {
  const resolved = resolveDocument(root, id, relativePath)
  if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > MAX_MARKDOWN_BYTES) throw new Error('Markdown document is too large')
  atomicWrite(resolved.target, content)
  const metadata = readMetadata(root, id)
  metadata.updatedAt = new Date().toISOString()
  atomicWrite(metadataPath(root, id), `${JSON.stringify(metadata, null, 2)}\n`)
  return { path: resolved.relative, content, updatedAt: metadata.updatedAt }
}

function createMarkdown(root, id, relativePath) {
  const resolved = resolveDocument(root, id, relativePath)
  if (fs.existsSync(resolved.target)) throw new Error('Markdown document already exists')
  atomicWrite(resolved.target, '# 新文档\n\n')
  return readMarkdown(root, id, resolved.relative)
}

function renameMarkdown(root, id, relativePath, nextRelativePath) {
  const source = resolveDocument(root, id, relativePath)
  const target = resolveDocument(root, id, nextRelativePath)
  if (!fs.existsSync(source.target)) throw new Error('Markdown document does not exist')
  if (source.target === target.target) return readMarkdown(root, id, source.relative)
  if (fs.existsSync(target.target)) throw new Error('Markdown document already exists')
  fs.mkdirSync(path.dirname(target.target), { recursive: true })
  fs.renameSync(source.target, target.target)
  const metadata = readMetadata(root, id)
  metadata.updatedAt = new Date().toISOString()
  atomicWrite(metadataPath(root, id), `${JSON.stringify(metadata, null, 2)}\n`)
  return readMarkdown(root, id, target.relative)
}

function deleteMarkdown(root, id, relativePath) {
  const resolved = resolveDocument(root, id, relativePath)
  if (!fs.existsSync(resolved.target)) return { ok: true, trashId: null }
  const trashId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  const trashRoot = path.join(resolved.space.directory, '.trash')
  const trashTarget = path.join(trashRoot, `${trashId}.md`)
  const manifestTarget = path.join(trashRoot, `${trashId}.json`)
  assertInside(resolved.space.directory, trashTarget)
  assertInside(resolved.space.directory, manifestTarget)
  fs.mkdirSync(trashRoot, { recursive: true })
  fs.renameSync(resolved.target, trashTarget)
  atomicWrite(manifestTarget, `${JSON.stringify({ id: trashId, spaceId: resolved.space.id, path: resolved.relative, deletedAt: new Date().toISOString() })}\n`)
  return { ok: true, trashId }
}

function restoreMarkdown(root, id, relativePath, trashId) {
  const space = getSpace(root, id)
  if (typeof trashId !== 'string' || !TRASH_ID_PATTERN.test(trashId)) throw new Error('Trash entry is invalid')
  const relative = safeRelative(relativePath, 'Markdown path')
  if (!relative.toLowerCase().endsWith('.md')) throw new Error('Markdown path must end with .md')
  const trashRoot = path.resolve(space.directory, '.trash')
  const manifestTarget = path.join(trashRoot, `${trashId}.json`)
  const trashTarget = path.join(trashRoot, `${trashId}.md`)
  assertInside(trashRoot, manifestTarget)
  assertInside(trashRoot, trashTarget)
  const manifest = JSON.parse(fs.readFileSync(manifestTarget, 'utf8'))
  if (manifest.spaceId !== space.id || manifest.path !== relative) throw new Error('Trash entry does not match the document')
  const target = path.resolve(space.directory, 'md', relative)
  assertInside(path.resolve(space.directory, 'md'), target)
  if (fs.existsSync(target)) throw new Error('A Markdown document already exists at this path')
  if (!fs.existsSync(trashTarget)) throw new Error('Trash entry is missing')
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.renameSync(trashTarget, target)
  fs.rmSync(manifestTarget, { force: true })
  return readMarkdown(root, space.id, relative)
}

function deleteSpace(root, id) {
  const safeId = safeSpaceId(id)
  const target = path.join(root, safeId)
  assertInside(path.resolve(root), path.resolve(target))
  if (!fs.existsSync(target)) return { ok: true }
  fs.rmSync(target, { recursive: true, force: true })
  return { ok: true }
}

function resolveResource(root, id, relativePath) {
  const space = getSpace(root, id)
  const relative = safeRelative(relativePath, 'Resource path')
  const target = path.resolve(space.directory, 'res', relative)
  assertInside(path.resolve(space.directory, 'res'), target)
  return { relative, target }
}

function readResource(root, id, relativePath) {
  const resolved = resolveResource(root, id, relativePath)
  const stat = fs.statSync(resolved.target)
  if (!stat.isFile() || stat.size > MAX_RESOURCE_BYTES) throw new Error('Resource is invalid or too large')
  return { path: resolved.relative, bytes: Uint8Array.from(fs.readFileSync(resolved.target)) }
}

function resolveComparableRoot(value) {
  const absolute = path.resolve(value)
  try { return fs.realpathSync(absolute) } catch { return absolute }
}

function isInsideRoot(root, target) {
  const relative = path.relative(root, target)
  return relative === ''
    || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

/**
 * Refuse resource sources that live inside the application's own data.
 * Drag-and-drop legitimately reaches anywhere the user keeps files, so the
 * import path cannot be restricted to a root allow-list; it can, and must,
 * refuse the credentials and settings the application itself owns.
 */
function assertSourceOutsideProtectedRoots(source, protectedRoots) {
  for (const candidate of protectedRoots) {
    if (typeof candidate !== 'string' || !candidate.trim()) continue
    if (isInsideRoot(resolveComparableRoot(candidate), source)) {
      throw new Error('Resource source is inside application data')
    }
  }
}

function copyResource(root, id, sourcePath, options = {}) {
  if (typeof sourcePath !== 'string' || !path.isAbsolute(sourcePath)) throw new Error('Resource source must be absolute')
  const source = fs.realpathSync(sourcePath)
  const stat = fs.statSync(source)
  if (!stat.isFile() || stat.size > MAX_RESOURCE_BYTES) throw new Error('Resource is invalid or too large')
  assertSourceOutsideProtectedRoots(source, options.protectedRoots ?? [])
  const space = getSpace(root, id)
  const originalName = path.basename(source).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim()
  const name = originalName || `resource-${Date.now()}`
  const target = path.resolve(space.directory, 'res', name)
  assertInside(path.resolve(space.directory, 'res'), target)
  atomicWrite(target, fs.readFileSync(source))
  return { path: name, size: stat.size }
}

function renameResource(root, id, relativePath, nextRelativePath) {
  const source = resolveResource(root, id, relativePath)
  const target = resolveResource(root, id, nextRelativePath)
  if (!fs.existsSync(source.target) || !fs.statSync(source.target).isFile()) throw new Error('Resource does not exist')
  if (source.target === target.target) return { path: source.relative }
  if (fs.existsSync(target.target)) throw new Error('Resource already exists')
  fs.mkdirSync(path.dirname(target.target), { recursive: true })
  fs.renameSync(source.target, target.target)
  const oldReference = `res/${source.relative}`
  const newReference = `res/${target.relative}`
  for (const documentPath of listDocuments(root, id)) {
    const document = readMarkdown(root, id, documentPath)
    if (document.content.includes(oldReference)) writeMarkdown(root, id, documentPath, document.content.split(oldReference).join(newReference))
  }
  return { path: target.relative }
}

function deleteResource(root, id, relativePath) {
  const resolved = resolveResource(root, id, relativePath)
  if (!fs.existsSync(resolved.target)) return { ok: true }
  const stat = fs.statSync(resolved.target)
  if (!stat.isFile()) throw new Error('Resource does not exist')
  fs.rmSync(resolved.target, { force: true })
  return { ok: true }
}

function listSpaceIds(root) {
  if (!fs.existsSync(root)) return []
  return fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && SPACE_ID_PATTERN.test(entry.name))
    .map(entry => entry.name)
    .sort()
}

/**
 * Copy spaces from a previous location into the current one, once.
 *
 * Idempotent, and it never deletes anything: the source directory is left in
 * place so a user who downgrades can still find their notes. A non-empty target
 * means the migration already ran (or the user already has data there), so the
 * call becomes a no-op.
 */
function migrateSpaceRoot(fromRoot, toRoot) {
  if (typeof fromRoot !== 'string' || typeof toRoot !== 'string') throw new TypeError('Space roots must be strings')
  const from = path.resolve(fromRoot)
  const to = path.resolve(toRoot)
  if (from === to) return { migrated: false, reason: 'same-root', spaces: 0 }
  if (listSpaceIds(to).length > 0) return { migrated: false, reason: 'target-not-empty', spaces: 0 }
  const ids = listSpaceIds(from)
  if (ids.length === 0) return { migrated: false, reason: 'nothing-to-migrate', spaces: 0 }
  fs.mkdirSync(to, { recursive: true })
  for (const id of ids) {
    const target = path.join(to, id)
    assertInside(to, target)
    fs.cpSync(path.join(from, id), target, { recursive: true, force: true, errorOnExist: false })
  }
  return { migrated: true, reason: 'copied', spaces: ids.length }
}

module.exports = {
  MAX_MARKDOWN_BYTES,
  MAX_SPACES,
  MAX_DOCUMENTS,
  createSpace,
  renameSpace,
  listSpaces,
  getSpace,
  listDocuments,
  listFolders,
  createDirectory,
  listResources,
  searchSpaces,
  readMarkdown,
  writeMarkdown,
  createMarkdown,
  renameMarkdown,
  deleteMarkdown,
  restoreMarkdown,
  deleteSpace,
  readResource,
  copyResource,
  renameResource,
  deleteResource,
  listSpaceIds,
  migrateSpaceRoot,
  safeRelative,
  safeSpaceId,
}
