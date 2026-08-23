'use strict'

const fs = require('node:fs')
const path = require('node:path')

function entryExists(target) {
  try {
    fs.lstatSync(target)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

function deployRuntimePackage({ source, dshHome, packageName }) {
  const packageRoot = path.resolve(source)
  const manifestPath = path.join(packageRoot, 'package.json')
  if (!fs.existsSync(manifestPath)) throw new Error(`Bundled runtime package is missing: ${manifestPath}`)
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  if (manifest.name !== packageName) {
    throw new Error(`Refusing to deploy ${String(manifest.name)} as ${packageName}`)
  }
  const [scope, name, extra] = packageName.split('/')
  if (!scope?.startsWith('@') || !name || extra) throw new Error(`Runtime package must use a scoped name: ${packageName}`)

  const profileScope = path.join(path.resolve(dshHome), 'profiles', 'web', 'node_modules', scope)
  fs.mkdirSync(profileScope, { recursive: true })
  const link = path.join(profileScope, name)
  if (entryExists(link)) {
    const stat = fs.lstatSync(link)
    if (!stat.isSymbolicLink()) throw new Error(`Refusing to replace non-link profile package: ${link}`)
    const current = path.resolve(path.dirname(link), fs.readlinkSync(link))
    if (current === packageRoot) return { link, target: packageRoot }
    fs.unlinkSync(link)
  }
  fs.symlinkSync(packageRoot, link, process.platform === 'win32' ? 'junction' : 'dir')
  return { link, target: packageRoot }
}

module.exports = { deployRuntimePackage }
