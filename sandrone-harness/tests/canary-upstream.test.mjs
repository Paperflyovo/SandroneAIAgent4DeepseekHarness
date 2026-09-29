import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { formatCanaryReport, patchAppliesTo, recommendationFor } from '../scripts/canary-upstream.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const ZERO_CONTEXT_PATCH = [
  'diff --git a/lib/index.js b/lib/index.js',
  '--- a/lib/index.js',
  '+++ b/lib/index.js',
  '@@ -1,1 +1,1 @@',
  '-const label = "before";',
  '+const label = "after";',
  '',
].join('\n')

const CONTEXT_PATCH = [
  'diff --git a/lib/index.js b/lib/index.js',
  '--- a/lib/index.js',
  '+++ b/lib/index.js',
  '@@ -1,3 +1,3 @@',
  ' const head = 1;',
  '-const label = "before";',
  '+const label = "after";',
  ' const tail = 3;',
  '',
].join('\n')

async function packageFixture(t, contents) {
  const root = await mkdtemp(join(tmpdir(), 'sandrone-canary-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'package', 'lib'), { recursive: true })
  await writeFile(join(root, 'package', 'lib', 'index.js'), contents, 'utf8')
  const patch = join(root, 'candidate.patch')
  return { root, patch }
}

test('a zero-context patch is never reported as a false conflict', async t => {
  const { root, patch } = await packageFixture(t, 'const label = "before";\n')
  await writeFile(patch, ZERO_CONTEXT_PATCH, 'utf8')
  const outcome = await patchAppliesTo(join(root, 'package'), patch)
  assert.equal(outcome.status, 'applies')
  // Small files can satisfy plain mode; the fallback only decides the mode.
  assert.ok(['context', 'unidiff-zero'].includes(outcome.mode), `unexpected mode ${outcome.mode}`)
})

test('every shipped patch carries context lines, which pnpm requires', async () => {
  // Learned from a real failure: the 0.1.5-era patches were zero-context, and a
  // renamed copy of one still made `git apply --check --unidiff-zero` pass while
  // pnpm's stricter applier refused it mid-install (ERR_PNPM_PATCH_FAILED).
  // Regenerated patches must therefore keep normal context.
  const patches = (await readdir(join(ROOT, 'patches'))).filter(entry => entry.endsWith('.patch'))
  assert.ok(patches.length > 0)
  for (const name of patches) {
    const source = await readFile(join(ROOT, 'patches', name), 'utf8')
    const hunkLines = source.split('\n').filter(line => line.startsWith('@@'))
    assert.ok(hunkLines.length > 0, `${name} has no hunks`)
    const contextLines = source.split('\n').filter(line => line.startsWith(' '))
    assert.ok(contextLines.length > 0, `${name} is zero-context; regenerate it without -U0 so pnpm can apply it`)
  }
})

test('a context patch applies in the plain mode', async t => {
  const { root, patch } = await packageFixture(t, 'const head = 1;\nconst label = "before";\nconst tail = 3;\n')
  await writeFile(patch, CONTEXT_PATCH, 'utf8')
  const outcome = await patchAppliesTo(join(root, 'package'), patch)
  assert.equal(outcome.status, 'applies')
  assert.equal(outcome.mode, 'context')
})

test('a patch whose target moved is reported as a conflict with its location', async t => {
  const { root, patch } = await packageFixture(t, 'const head = 1;\nconst label = "rewritten upstream";\nconst tail = 3;\n')
  await writeFile(patch, CONTEXT_PATCH, 'utf8')
  const outcome = await patchAppliesTo(join(root, 'package'), patch)
  assert.equal(outcome.status, 'conflicts')
  assert.equal(outcome.file, 'lib/index.js')
})

test('a conflicting preference patch is advised to be deleted, not re-ported', async t => {
  const { root, patch } = await packageFixture(t, 'nothing matches here\n')
  await writeFile(patch, CONTEXT_PATCH, 'utf8')
  const outcome = await patchAppliesTo(join(root, 'package'), patch)
  assert.match(recommendationFor({ reason: 'preference' }, outcome), /delete this patch/)
  assert.match(recommendationFor({ reason: 'policy-disagreement' }, outcome), /delete this patch/)
})

test('each reason class produces its own decision, not a generic failure', () => {
  const outcome = { status: 'conflicts' }
  const reported = recommendationFor({ reason: 'upstream-bug', upstreamReport: 'docs/x.md' }, outcome)
  assert.match(reported, /upstream report exists/)
  assert.match(recommendationFor({ reason: 'upstream-bug' }, outcome), /file an upstream report/)
  assert.match(recommendationFor({ reason: 'historical-data' }, outcome), /decide deliberately/)
  assert.match(recommendationFor({ reason: 'capability' }, outcome), /profile or your own preset/)
  assert.match(recommendationFor({ reason: undefined }, outcome), /no manifest reason recorded/)
  assert.equal(recommendationFor({ reason: 'preference' }, { status: 'applies' }), 'nothing to do')
})

test('a missing upstream package is called out as retarget-or-drop', () => {
  assert.match(recommendationFor({ reason: 'capability' }, { status: 'missing' }), /retargeted or dropped/)
})

test('the report surfaces deletable conflicts before portable ones', () => {
  const report = {
    currentVersion: '1.0.0',
    target: '2.0.0',
    rows: [
      { packageName: '@deepseek-ai/dsh-a', status: 'conflicts', reason: 'upstream-bug', upstreamReport: null, file: 'lib/a.js', line: 10 },
      { packageName: '@deepseek-ai/dsh-b', status: 'conflicts', reason: 'preference', removeWhen: 'upstream exposes the state publicly', file: 'lib/b.js', line: 2 },
      { packageName: '@deepseek-ai/dsh-c', status: 'applies', reason: 'historical-data' },
    ],
  }
  const text = formatCanaryReport(report)
  assert.match(text, /1\.0\.0 -> candidate 2\.0\.0/)
  assert.match(text, /deleting them is cheaper than re-porting/)
  assert.match(text, /@deepseek-ai\/dsh-b: upstream exposes the state publicly/)
  assert.doesNotMatch(text, /@deepseek-ai\/dsh-c.*delete/)
  assert.match(text, /conflicts=2/)
})

test('a clean sweep says the bump is mechanical', () => {
  const text = formatCanaryReport({
    currentVersion: '1.0.0',
    target: '2.0.0',
    rows: [{ packageName: '@deepseek-ai/dsh-a', status: 'applies', reason: 'upstream-bug' }],
  })
  assert.match(text, /every patch still applies/)
})
