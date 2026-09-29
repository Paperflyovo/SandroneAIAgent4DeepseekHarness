import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import backup from '../apps/desktop/lib/upgrade-backup.cjs'

test('upgrade snapshots data once and excludes external package junctions', t => {
  const root = mkdtempSync(join(tmpdir(), 'sandrone-upgrade-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const home = join(root, 'data')
  mkdirSync(join(home, 'storages'), { recursive: true })
  writeFileSync(join(home, 'storages', 'session.jsonl'), 'original history')
  const external = join(root, 'external')
  mkdirSync(external)
  symlinkSync(external, join(home, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
  const first = backup.prepareUpgradeBackup(home)
  assert.equal(readFileSync(join(first.backup, 'data', 'storages', 'session.jsonl'), 'utf8'), 'original history')
  assert.equal(existsSync(join(first.backup, 'data', 'linked')), false)
  writeFileSync(join(home, 'storages', 'session.jsonl'), 'new history')
  assert.deepEqual(backup.prepareUpgradeBackup(home), first)
  assert.equal(readFileSync(join(first.backup, 'data', 'storages', 'session.jsonl'), 'utf8'), 'original history')
})

test('failed backup prevents version promotion and preserves original history', t => {
  const root = mkdtempSync(join(tmpdir(), 'sandrone-upgrade-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const home = join(root, 'data')
  mkdirSync(home)
  writeFileSync(join(home, 'session.jsonl'), 'old history')
  assert.throws(() => backup.prepareUpgradeBackup(home, { copy() { throw new Error('disk full') } }), /备份未完成/)
  assert.equal(existsSync(join(home, backup.MARKER)), false)
  assert.equal(readFileSync(join(home, 'session.jsonl'), 'utf8'), 'old history')
})
