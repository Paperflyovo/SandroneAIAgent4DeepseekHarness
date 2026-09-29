import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { parsePatchedDependencies, verifyPatches } from '../scripts/verify-patches.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// The gate reads these files by relative path; the fixture mirrors that layout.
const PINNED_FILES = [
  'docs/upstream-lock.json',
  '.pnpmfile.cjs',
  'scripts/verify-upstream.mjs',
  'apps/desktop/lib/upgrade-backup.cjs',
  'package.json',
  'pnpm-workspace.yaml',
]

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'sandrone-patches-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  for (const relative of PINNED_FILES) {
    const target = join(root, ...relative.split('/'))
    await mkdir(dirname(target), { recursive: true })
    await cp(join(ROOT, ...relative.split('/')), target)
  }
  await cp(join(ROOT, 'patches'), join(root, 'patches'), { recursive: true })
  return root
}

async function rewrite(root, relative, transform) {
  const path = join(root, ...relative.split('/'))
  await writeFile(path, transform(await readFile(path, 'utf8')))
}

async function problemsAfter(root, relative, transform) {
  await rewrite(root, relative, transform)
  return (await verifyPatches(root)).errors
}

test('the shipped patch inventory and every version pin agree', async () => {
  const lock = JSON.parse(await readFile(join(ROOT, 'docs', 'upstream-lock.json'), 'utf8'))
  const report = await verifyPatches(ROOT)
  assert.deepEqual(report.errors, [])
  assert.equal(report.expectedVersion, lock.packageFamilyVersion)
  assert.ok(Object.keys(report.entries).length > 0)
})

test('every carried patch states why it exists and what would let it go', async () => {
  const report = await verifyPatches(ROOT)
  for (const [file, entry] of Object.entries(report.entries)) {
    assert.ok(entry.summary.trim().length > 20, `${file} needs a real summary`)
    assert.ok(entry.removeWhen.trim().length > 20, `${file} needs a concrete removal condition, not a placeholder`)
    assert.ok(entry.package.startsWith('@deepseek-ai/'), `${file} must name the upstream package it patches`)
  }
})

test('the preference budget is a ceiling, not a description', async () => {
  const report = await verifyPatches(ROOT)
  const preferenceClass = Object.values(report.entries).filter(entry => ['preference', 'policy-disagreement'].includes(entry.reason))
  assert.ok(preferenceClass.length <= 4, 'the reviewed budget is 4; lower preferenceBudget when a patch is deleted')
})

test('a patch without a manifest entry is refused', async t => {
  const root = await fixture(t)
  const errors = await problemsAfter(root, 'patches/manifest.json', source => {
    const manifest = JSON.parse(source)
    delete manifest.patches[Object.keys(manifest.patches)[0]]
    return JSON.stringify(manifest, null, 2)
  })
  assert.ok(errors.some(error => /has no patches\/manifest\.json entry/.test(error)), errors.join('\n'))
})

test('an unrecognised reason is refused', async t => {
  const root = await fixture(t)
  const errors = await problemsAfter(root, 'patches/manifest.json', source => {
    const manifest = JSON.parse(source)
    manifest.patches[Object.keys(manifest.patches)[0]].reason = 'because-i-said-so'
    return JSON.stringify(manifest, null, 2)
  })
  assert.ok(errors.some(error => /is not one of/.test(error)), errors.join('\n'))
})

test('a patch not re-verified against the pinned version is refused', async t => {
  const root = await fixture(t)
  const errors = await problemsAfter(root, 'patches/manifest.json', source => {
    const manifest = JSON.parse(source)
    manifest.patches[Object.keys(manifest.patches)[0]].lastVerified = '0.0.0-old'
    return JSON.stringify(manifest, null, 2)
  })
  assert.ok(errors.some(error => /re-check it against/.test(error)), errors.join('\n'))
})

test('adding a preference patch past the budget is refused', async t => {
  const root = await fixture(t)
  const errors = await problemsAfter(root, 'patches/manifest.json', source => {
    const manifest = JSON.parse(source)
    manifest.preferenceBudget = 0
    return JSON.stringify(manifest, null, 2)
  })
  assert.ok(errors.some(error => /preferenceBudget is 0/.test(error)), errors.join('\n'))
})

test('a drifting version pin is reported by name', async t => {
  const cases = [
    ['.pnpmfile.cjs', source => source.replace(/const version = '[^']+'/, "const version = '9.9.9-nope'"), /\.pnpmfile\.cjs version constant is 9\.9\.9-nope/],
    ['apps/desktop/lib/upgrade-backup.cjs', source => source.replace(/TARGET_VERSION = '[^']+'/, "TARGET_VERSION = '9.9.9-nope'"), /upgrade-backup TARGET_VERSION is 9\.9\.9-nope/],
    ['scripts/verify-upstream.mjs', source => source.replace(/const DEFAULT_VERSION = '[^']+'/, "const DEFAULT_VERSION = '9.9.9-nope'"), /verify-upstream DEFAULT_VERSION is 9\.9\.9-nope/],
  ]
  for (const [relative, transform, expected] of cases) {
    const root = await fixture(t)
    const errors = await problemsAfter(root, relative, transform)
    assert.ok(errors.some(error => expected.test(error)), `${relative}: ${errors.join('\n')}`)
  }
})

test('a dependency or workspace row left on the old version is reported', async t => {
  const root = await fixture(t)
  const dependencyErrors = await problemsAfter(root, 'package.json', source => {
    const manifest = JSON.parse(source)
    const name = Object.keys(manifest.dependencies).find(entry => entry.startsWith('@deepseek-ai/dsh'))
    manifest.dependencies[name] = '9.9.9-nope'
    return JSON.stringify(manifest, null, 2)
  })
  assert.ok(dependencyErrors.some(error => /package\.json dependencies: .* is 9\.9\.9-nope/.test(error)), dependencyErrors.join('\n'))

  const other = await fixture(t)
  const workspaceErrors = await problemsAfter(other, 'pnpm-workspace.yaml', source => source.replace(/@\d[^'"]*':/, "@9.9.9-nope':"))
  assert.ok(workspaceErrors.some(error => /is pinned to 9\.9\.9-nope/.test(error)), workspaceErrors.join('\n'))
})

test('a patch file with no pnpm-workspace declaration is reported', async t => {
  const root = await fixture(t)
  const errors = await problemsAfter(root, 'pnpm-workspace.yaml', source => source.split('\n').slice(0, -3).join('\n'))
  assert.ok(errors.some(error => /does not declare/.test(error)), errors.join('\n'))
})

test('patchedDependencies parsing reads the declared rows', () => {
  const declared = parsePatchedDependencies([
    'patchedDependencies:',
    "  '@deepseek-ai/dsh-llm-deepseek@1.2.3': patches/@deepseek-ai__dsh-llm-deepseek@1.2.3.patch",
    "  '@deepseek-ai/dsh-tool-fs@1.2.3': patches/@deepseek-ai__dsh-tool-fs@1.2.3.patch",
    'allowBuilds:',
    '  esbuild: true',
  ].join('\n'))
  assert.deepEqual([...declared], [
    ['patches/@deepseek-ai__dsh-llm-deepseek@1.2.3.patch', '@deepseek-ai/dsh-llm-deepseek@1.2.3'],
    ['patches/@deepseek-ai__dsh-tool-fs@1.2.3.patch', '@deepseek-ai/dsh-tool-fs@1.2.3'],
  ])
})
