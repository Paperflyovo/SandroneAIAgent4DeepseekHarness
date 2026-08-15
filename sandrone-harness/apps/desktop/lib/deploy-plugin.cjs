'use strict'

const fs = require('node:fs')
const path = require('node:path')

const PLUGIN_NAME = '@sandrone/harness-ui'
const SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

function ensureDirectory(target) {
  fs.mkdirSync(target, { recursive: true })
}

function entryExists(target) {
  try {
    fs.lstatSync(target)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

function assertPluginSource(source) {
  for (const relative of ['package.json', path.join('lib', 'index.js'), path.join('lib', 'client.js')]) {
    if (!fs.existsSync(path.join(source, relative))) {
      throw new Error(`Sandrone UI plugin is not built: missing ${path.join(source, relative)}`)
    }
  }
}

function removeManagedLink(link) {
  if (!entryExists(link)) return
  const stat = fs.lstatSync(link)
  if (!stat.isSymbolicLink()) {
    throw new Error(`Refusing to replace non-link profile package: ${link}`)
  }
  fs.unlinkSync(link)
}

function copyBuildArtifacts(source, destination) {
  fs.copyFileSync(path.join(source, 'package.json'), path.join(destination, 'package.json'))
  fs.cpSync(path.join(source, 'lib'), path.join(destination, 'lib'), { recursive: true })
}

function sameTree(left, right) {
  if (!entryExists(right)) return false
  const leftStat = fs.lstatSync(left)
  const rightStat = fs.lstatSync(right)
  if (leftStat.isSymbolicLink() || rightStat.isSymbolicLink()) {
    return leftStat.isSymbolicLink()
      && rightStat.isSymbolicLink()
      && fs.readlinkSync(left) === fs.readlinkSync(right)
  }
  if (leftStat.isFile() || rightStat.isFile()) {
    return leftStat.isFile()
      && rightStat.isFile()
      && leftStat.size === rightStat.size
      && fs.readFileSync(left).equals(fs.readFileSync(right))
  }
  if (!leftStat.isDirectory() || !rightStat.isDirectory()) return false
  const leftEntries = fs.readdirSync(left).sort()
  const rightEntries = fs.readdirSync(right).sort()
  return leftEntries.length === rightEntries.length
    && leftEntries.every((entry, index) => (
      entry === rightEntries[index]
      && sameTree(path.join(left, entry), path.join(right, entry))
    ))
}

function installManagedTarget(temporary, target, extensionRoot) {
  if (!entryExists(target)) {
    fs.renameSync(temporary, target)
    return
  }
  if (sameTree(temporary, target)) {
    fs.rmSync(temporary, { recursive: true, force: true })
    return
  }

  const backup = path.join(
    extensionRoot,
    `.previous-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  )
  fs.renameSync(target, backup)
  try {
    fs.renameSync(temporary, target)
  } catch (error) {
    try {
      fs.renameSync(backup, target)
    } catch (rollbackError) {
      error.cause = rollbackError
    }
    throw error
  }
  fs.rmSync(backup, { recursive: true, force: true })
}

function deployPlugin({ source, dshHome }) {
  assertPluginSource(source)
  const manifest = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'))
  if (manifest.name !== PLUGIN_NAME) {
    throw new Error(`Refusing to deploy a package other than ${PLUGIN_NAME}`)
  }
  const version = manifest.version
  if (typeof version !== 'string' || !SEMVER.test(version)) {
    throw new Error(`Sandrone UI plugin has an invalid version: ${String(version)}`)
  }

  const home = path.resolve(dshHome)
  const extensionRoot = path.join(home, 'sandrone', 'extensions', 'harness-ui')
  const target = path.join(extensionRoot, version)
  if (path.dirname(target) !== extensionRoot) {
    throw new Error(`Sandrone UI version escapes its managed directory: ${version}`)
  }
  ensureDirectory(extensionRoot)
  const temporary = fs.mkdtempSync(path.join(extensionRoot, '.install-'))
  try {
    copyBuildArtifacts(source, temporary)
    installManagedTarget(temporary, target, extensionRoot)
  } catch (error) {
    fs.rmSync(temporary, { recursive: true, force: true })
    throw error
  }

  const profileModules = path.join(home, 'profiles', 'web', 'node_modules', '@sandrone')
  ensureDirectory(profileModules)
  const link = path.join(profileModules, 'harness-ui')
  let correct = false
  if (entryExists(link) && fs.lstatSync(link).isSymbolicLink()) {
    correct = path.resolve(path.dirname(link), fs.readlinkSync(link)) === path.resolve(target)
  }
  if (!correct) {
    removeManagedLink(link)
    fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir')
  }
  return { link, target, version }
}

module.exports = { deployPlugin, PLUGIN_NAME }
