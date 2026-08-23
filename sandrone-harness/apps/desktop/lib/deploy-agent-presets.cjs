'use strict'

const fs = require('node:fs')
const path = require('node:path')

const MANAGED_MARKER = '.sandrone-managed-preset'
const PRESET_NAME = /^[a-z0-9][a-z0-9-]*$/

function exists(target) {
  try { fs.lstatSync(target); return true } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

function assertPresetSource(source, name) {
  if (!PRESET_NAME.test(name)) throw new Error(`Invalid bundled Agent preset name: ${name}`)
  for (const file of ['preset.yml', 'agent.cordis.yml']) {
    const target = path.join(source, name, file)
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      throw new Error(`Bundled Agent preset is missing ${name}/${file}`)
    }
  }
}

function deployAgentPresets({ sourceRoot, dshHome, presetNames }) {
  const source = path.resolve(sourceRoot)
  const destinationRoot = path.join(path.resolve(dshHome), '.agent-presets')
  fs.mkdirSync(destinationRoot, { recursive: true })
  const deployed = []

  for (const name of presetNames) {
    assertPresetSource(source, name)
    const target = path.join(destinationRoot, name)
    if (path.dirname(target) !== destinationRoot) throw new Error(`Agent preset name escapes destination: ${name}`)
    if (exists(target) && !fs.existsSync(path.join(target, MANAGED_MARKER))) {
      throw new Error(`Refusing to replace user-owned Agent preset: ${target}`)
    }
    const temporary = fs.mkdtempSync(path.join(destinationRoot, `.install-${name}-`))
    const backup = path.join(destinationRoot, `.previous-${name}-${process.pid}-${Date.now()}`)
    try {
      fs.copyFileSync(path.join(source, name, 'preset.yml'), path.join(temporary, 'preset.yml'))
      fs.copyFileSync(path.join(source, name, 'agent.cordis.yml'), path.join(temporary, 'agent.cordis.yml'))
      fs.writeFileSync(path.join(temporary, MANAGED_MARKER), 'managed by Sandrone\n')
      if (exists(target)) fs.renameSync(target, backup)
      fs.renameSync(temporary, target)
      fs.rmSync(backup, { recursive: true, force: true })
      deployed.push(target)
    } catch (error) {
      fs.rmSync(temporary, { recursive: true, force: true })
      if (!exists(target) && exists(backup)) fs.renameSync(backup, target)
      throw error
    }
  }
  return deployed
}

module.exports = { deployAgentPresets, MANAGED_MARKER }
