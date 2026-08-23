'use strict'

const fs = require('node:fs')
const path = require('node:path')

function deploySkills({ sourceRoot, dshHome, skillNames, disabledNames = [] }) {
  const source = path.resolve(sourceRoot)
  const home = path.resolve(dshHome)
  const destinationRoot = path.join(home, 'skills')
  if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) {
    throw new Error(`Bundled Skill directory is missing: ${source}`)
  }
  fs.mkdirSync(destinationRoot, { recursive: true })
  const deployed = []
  const selected = skillNames === undefined ? null : new Set(skillNames)
  const disabled = new Set(disabledNames)
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (selected !== null && !selected.has(entry.name)) continue
    const skillSource = path.join(source, entry.name)
    const skillFile = path.join(skillSource, 'SKILL.md')
    if (!fs.existsSync(skillFile)) continue
    const target = path.join(destinationRoot, entry.name)
    if (path.dirname(target) !== destinationRoot) throw new Error(`Skill name escapes destination: ${entry.name}`)
    if (disabled.has(entry.name)) {
      fs.rmSync(target, { recursive: true, force: true })
      continue
    }
    fs.cpSync(skillSource, target, { recursive: true, force: true })
    deployed.push(target)
  }
  return deployed
}

module.exports = { deploySkills }
