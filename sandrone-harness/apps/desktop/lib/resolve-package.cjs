'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')

const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/

function isContained(root, target) {
  const relative = path.relative(root, target)
  return relative !== '' && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`)
}

function packageDirectory(packageName, anchor) {
  if (typeof packageName !== 'string' || !PACKAGE_NAME.test(packageName)) {
    throw new TypeError(`Invalid package name: ${String(packageName)}`)
  }
  const requireFromAnchor = createRequire(path.resolve(anchor))
  for (const modulesRoot of requireFromAnchor.resolve.paths(packageName) ?? []) {
    const candidate = path.join(modulesRoot, ...packageName.split('/'))
    const manifestPath = path.join(candidate, 'package.json')
    if (!fs.existsSync(manifestPath)) continue
    const directory = fs.realpathSync(candidate)
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'))
    if (manifest.name !== packageName) {
      throw new Error(`Resolved package manifest is ${String(manifest.name)}, expected ${packageName}`)
    }
    return directory
  }
  throw new Error(`Cannot resolve ${packageName} from ${anchor}`)
}

function packageBin(packageName, binName, anchor) {
  const directory = packageDirectory(packageName, anchor)
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'))
  const relative = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[binName]
  if (typeof relative !== 'string' || !relative) {
    throw new Error(`${packageName} does not expose the ${binName} executable`)
  }
  if (path.isAbsolute(relative)) {
    throw new Error(`${packageName} exposes an invalid ${binName} executable`)
  }
  const target = path.resolve(directory, relative)
  if (!isContained(directory, target)) {
    throw new Error(`${packageName} exposes an invalid ${binName} executable`)
  }
  let realTarget
  try {
    realTarget = fs.realpathSync(target)
  } catch {
    throw new Error(`${packageName} exposes an invalid ${binName} executable`)
  }
  if (!isContained(directory, realTarget) || !fs.statSync(realTarget).isFile()) {
    throw new Error(`${packageName} exposes an invalid ${binName} executable`)
  }
  return realTarget
}

module.exports = { isContained, packageBin, packageDirectory }
