'use strict'

const fs = require('node:fs')
const path = require('node:path')

const TARGET_VERSION = '0.1.5-rc.1'
const MARKER = '.sandrone-runtime-version.json'

function prepareUpgradeBackup(dshHome, options = {}) {
  const source = path.resolve(dshHome)
  const marker = path.join(source, MARKER)
  if (fs.existsSync(source) && fs.lstatSync(source).isSymbolicLink()) throw new Error('Harness data directory must not be a symbolic link')
  fs.mkdirSync(source, { recursive: true })
  const previous = fs.existsSync(marker) ? JSON.parse(fs.readFileSync(marker, 'utf8')) : null
  if (previous?.version === TARGET_VERSION) return previous
  const entries = fs.readdirSync(source).filter(name => name !== MARKER)
  let backup = null
  if (entries.length > 0) {
    const backupRoot = path.join(path.dirname(source), `${path.basename(source)}-backups`)
    fs.mkdirSync(backupRoot, { recursive: true })
    backup = fs.mkdtempSync(path.join(backupRoot, `before-${TARGET_VERSION}-`))
    try {
      const copy = options.copy ?? fs.cpSync
      copy(source, path.join(backup, 'data'), {
        recursive: true,
        errorOnExist: true,
        force: false,
        filter: candidate => !fs.lstatSync(candidate).isSymbolicLink() && path.basename(candidate) !== 'node_modules',
      })
      fs.writeFileSync(path.join(backup, 'backup.json'), JSON.stringify({ from: previous?.version ?? '0.1.1-rc.1', to: TARGET_VERSION, source, createdAt: new Date().toISOString(), complete: true }, null, 2), { flag: 'wx' })
    } catch (error) {
      throw new Error(`升级前备份未完成，已停止启动。备份目录：${backup}`, { cause: error })
    }
  }
  const record = { version: TARGET_VERSION, backup }
  const temporary = `${marker}.${process.pid}.tmp`
  fs.writeFileSync(temporary, JSON.stringify(record), { flag: 'wx' })
  fs.renameSync(temporary, marker)
  return record
}

module.exports = { prepareUpgradeBackup, TARGET_VERSION, MARKER }
