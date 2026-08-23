'use strict'

const fs = require('node:fs')
const path = require('node:path')

const MAX_LOCAL_IMAGE_BYTES = 50 * 1024 * 1024
const IMAGE_MIME_TYPES = Object.freeze({
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
})

function isUncPath(value) {
  return /^\\\\/.test(value) || /^\/\//.test(value) || /^\\\\\?\\/.test(value)
}

function isAbsolutePath(value) {
  return path.isAbsolute(value) || path.win32.isAbsolute(value)
}

function isInside(root, target) {
  const relative = path.relative(root, target)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

function workspaceRootsFromStorage(value) {
  const records = value?.tables?.workspaces
  if (!records || typeof records !== 'object') return []
  return Object.values(records)
    .map(record => typeof record?.path === 'string' ? record.path.trim() : '')
    .filter(Boolean)
}

function readWorkspaceRoots(storagePath) {
  try {
    return workspaceRootsFromStorage(JSON.parse(fs.readFileSync(storagePath, 'utf8')))
  } catch {
    return []
  }
}

function readSupplementaryRoots(storagePath) {
  try {
    const value = JSON.parse(fs.readFileSync(storagePath, 'utf8'))
    return Array.isArray(value?.roots) ? value.roots.filter(root => typeof root === 'string' && root.trim()) : []
  } catch {
    return []
  }
}

function writeSupplementaryRoot(storagePath, root) {
  if (typeof root !== 'string' || !root.trim() || !isAbsolutePath(root) || isUncPath(root)) return
  const roots = [...new Set([...readSupplementaryRoots(storagePath), path.resolve(root)])]
  const temporary = `${storagePath}.${process.pid}.tmp`
  fs.mkdirSync(path.dirname(storagePath), { recursive: true })
  fs.writeFileSync(temporary, `${JSON.stringify({ roots }, null, 2)}\n`)
  fs.renameSync(temporary, storagePath)
}

function resolveAuthorizedLocalImage(requestedPath, roots, options = {}) {
  if (typeof requestedPath !== 'string' || requestedPath.length === 0 || requestedPath.length > 32_768) {
    throw new Error('Invalid local image path')
  }
  if (!isAbsolutePath(requestedPath) || isUncPath(requestedPath)) throw new Error('Local image path must be absolute')
  const extension = path.extname(requestedPath).toLowerCase()
  const mimeType = IMAGE_MIME_TYPES[extension]
  if (!mimeType) throw new Error('Unsupported local image type')

  const fsApi = options.fs ?? fs
  const realpath = fsApi.realpathSync.native ?? fsApi.realpathSync
  const target = realpath(requestedPath)
  const authorized = roots.some(root => {
    if (typeof root !== 'string' || !root.trim() || !isAbsolutePath(root) || isUncPath(root)) return false
    try {
      return isInside(realpath(root), target)
    } catch {
      return false
    }
  })
  if (!authorized) throw new Error('Local image is outside the authorized workspaces')

  const stat = fsApi.statSync(target)
  if (!stat.isFile()) throw new Error('Local image is not a file')
  if (stat.size > (options.maxBytes ?? MAX_LOCAL_IMAGE_BYTES)) throw new Error('Local image exceeds the size limit')
  return { path: target, name: path.basename(target), mimeType, size: stat.size }
}

module.exports = {
  IMAGE_MIME_TYPES,
  MAX_LOCAL_IMAGE_BYTES,
  readSupplementaryRoots,
  readWorkspaceRoots,
  resolveAuthorizedLocalImage,
  workspaceRootsFromStorage,
  writeSupplementaryRoot,
}
