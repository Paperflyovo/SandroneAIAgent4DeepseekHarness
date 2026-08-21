'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { Arch } = require('builder-util')

function packageDirectories(nodeModules) {
  const directories = []
  for (const entry of fs.readdirSync(nodeModules, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === '.bin' || entry.name === '.pnpm') continue
    const entryPath = path.join(nodeModules, entry.name)
    if (!entry.name.startsWith('@')) {
      directories.push(entryPath)
      continue
    }
    for (const scoped of fs.readdirSync(entryPath, { withFileTypes: true })) {
      if (scoped.isDirectory()) directories.push(path.join(entryPath, scoped.name))
    }
  }
  return directories
}

function resolvePeerManifest(packageDirectory, packageName) {
  let current = packageDirectory
  while (true) {
    const candidate = path.join(current, 'node_modules', ...packageName.split('/'), 'package.json')
    if (fs.existsSync(candidate)) return candidate
    const parent = path.dirname(current)
    if (parent === current) return null
    current = parent
  }
}

function missingRequiredPeerDependencies(nodeModules) {
  const pending = [nodeModules]
  const visited = new Set()
  const missing = new Map()
  while (pending.length > 0) {
    const currentModules = pending.pop()
    const realModules = fs.realpathSync(currentModules)
    if (visited.has(realModules)) continue
    visited.add(realModules)
    for (const packageDirectory of packageDirectories(currentModules)) {
      const manifestPath = path.join(packageDirectory, 'package.json')
      if (!fs.existsSync(manifestPath)) continue
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
      for (const packageName of Object.keys(manifest.peerDependencies ?? {})) {
        if (manifest.peerDependenciesMeta?.[packageName]?.optional === true) continue
        if (resolvePeerManifest(packageDirectory, packageName)) continue
        const consumers = missing.get(packageName) ?? new Set()
        consumers.add(`${manifest.name ?? path.basename(packageDirectory)}@${manifest.version ?? 'unknown'}`)
        missing.set(packageName, consumers)
      }
      const nested = path.join(packageDirectory, 'node_modules')
      if (fs.existsSync(nested)) pending.push(nested)
    }
  }
  return [...missing]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([packageName, consumers]) => ({ packageName, consumers: [...consumers].sort() }))
}

function requiredNodePtyArtifacts(platform, architecture) {
  if (platform === 'win32') {
    return [
      `prebuilds/win32-${architecture}/conpty.node`,
      `prebuilds/win32-${architecture}/conpty_console_list.node`,
      `prebuilds/win32-${architecture}/conpty/conpty.dll`,
      `prebuilds/win32-${architecture}/conpty/OpenConsole.exe`,
    ]
  }
  if (platform === 'darwin') {
    return [
      `prebuilds/darwin-${architecture}/pty.node`,
      `prebuilds/darwin-${architecture}/spawn-helper`,
    ]
  }
  if (platform === 'linux') return [`prebuilds/linux-${architecture}/pty.node`]
  throw new Error(`Unsupported packaged platform: ${platform}`)
}

async function verifyNativeArtifacts(context) {
  const platform = context.packager.platform.nodeName
  const architecture = Arch[context.arch]
  if (typeof architecture !== 'string') throw new Error(`Unsupported packaged architecture: ${context.arch}`)
  const nodePty = path.join(context.appOutDir, 'resources', 'app', 'node_modules', 'node-pty')
  const missing = requiredNodePtyArtifacts(platform, architecture)
    .filter(relative => !fs.existsSync(path.join(nodePty, ...relative.split('/'))))
  if (missing.length > 0) {
    throw new Error(`Packaged node-pty is missing ${platform}-${architecture} artifacts: ${missing.join(', ')}`)
  }
  const nodeModules = path.join(context.appOutDir, 'resources', 'app', 'node_modules')
  const missingPeers = missingRequiredPeerDependencies(nodeModules)
  if (missingPeers.length > 0) {
    const detail = missingPeers
      .map(({ packageName, consumers }) => `${packageName} (required by ${consumers.join(', ')})`)
      .join('; ')
    throw new Error(`Packaged application is missing required peer dependencies: ${detail}`)
  }
}

module.exports = verifyNativeArtifacts
module.exports.missingRequiredPeerDependencies = missingRequiredPeerDependencies
module.exports.requiredNodePtyArtifacts = requiredNodePtyArtifacts
