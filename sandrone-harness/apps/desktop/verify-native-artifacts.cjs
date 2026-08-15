'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { Arch } = require('builder-util')

function requiredNodePtyArtifacts(platform, architecture) {
  if (platform === 'win32') {
    return [`prebuilds/win32-${architecture}/pty.node`]
  }
  if (platform === 'darwin') {
    return [
      `prebuilds/darwin-${architecture}/pty.node`,
      `prebuilds/darwin-${architecture}/spawn-helper`,
    ]
  }
  if (platform === 'linux') {
    return ['build/Release/pty.node']
  }
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
}

module.exports = verifyNativeArtifacts
module.exports.requiredNodePtyArtifacts = requiredNodePtyArtifacts
