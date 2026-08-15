import assert from 'node:assert/strict'
import test from 'node:test'

import { verifySkill } from '../scripts/verify-skill.mjs'

test('lifecycle Skill has valid metadata and progressive-disclosure links', async () => {
  const report = await verifySkill()
  assert.deepEqual(report.errors, [])
  assert.equal(report.links.length, 3)
  assert.ok(report.lines < 500)
})
