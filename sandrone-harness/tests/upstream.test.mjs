import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'

import { DEFAULT_VERSION, REQUIRED_PACKAGES, verifyUpstream } from '../scripts/verify-upstream.mjs'

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

async function makeFixture(overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), 'sandrone-upstream-'))
  const dependencies = Object.fromEntries(Object.keys(REQUIRED_PACKAGES).map(name => [name, DEFAULT_VERSION]))
  await writeJson(join(root, 'package.json'), { dependencies })
  await writeJson(join(root, 'docs/upstream-lock.json'), {
    npmVersion: DEFAULT_VERSION,
    packageFamilyVersion: DEFAULT_VERSION,
  })
  await mkdir(join(root, 'profiles'), { recursive: true })
  await writeFile(join(root, 'profiles/sandrone-web.patch.yml'), [
    '- insert:',
    '    - id: sandrone-ui',
    "      name: '@sandrone/harness-ui'",
    '    - id: directory-picker-ui',
    "      name: '@deepseek-ai/dsh-client-ui-directory-picker-browse'",
    '    - id: directory-picker-host',
    "      name: '@deepseek-ai/dsh-host-directory-picker-browse'",
    '- id: directory-picker',
    '  disabled: true',
    '- id: session-query-sqlite',
    '  config:',
    '    path: :memory:',
    '    openAt: first-search',
  ].join('\n'))

  const packagePaths = new Map()
  for (const [name, rule] of Object.entries(REQUIRED_PACKAGES)) {
    const packageRoot = join(root, 'fake-packages', name.replace('/', '__'))
    const manifest = { name, version: DEFAULT_VERSION, exports: { './package.json': './package.json' } }
    if (rule.bin) {
      manifest.bin = { [rule.bin]: 'lib/bin.js' }
      await mkdir(join(packageRoot, 'lib'), { recursive: true })
      await writeFile(join(packageRoot, 'lib/bin.js'), '')
    }
    if (rule.export) {
      const target = rule.export === '.' ? './lib/index.js' : `./lib/${rule.export.slice(2)}.js`
      manifest.exports[rule.export] = target
      await mkdir(dirname(join(packageRoot, target)), { recursive: true })
      await writeFile(join(packageRoot, target), '')
    }
    if (rule.bundlePatch) {
      manifest.dsh = { bundle: { patch: './cordis.patch.yml' } }
      manifest.exports['./cordis.patch.yml'] = './cordis.patch.yml'
      await mkdir(packageRoot, { recursive: true })
      const rows = name === '@deepseek-ai/dsh-base'
        ? ['session', 'agent-loop', 'settings', 'credentials']
        : ['api-gateway', 'connection', 'client-runtime', 'ui-layout']
      await writeFile(join(packageRoot, 'cordis.patch.yml'), `- insert:\n${rows.map(id => `    - id: ${id}\n      name: example`).join('\n')}\n`)
    }
    Object.assign(manifest, overrides[name] ?? {})
    const manifestPath = join(packageRoot, 'package.json')
    await writeJson(manifestPath, manifest)
    packagePaths.set(name, manifestPath)
  }
  return { root, packagePaths }
}

test('upstream gate accepts one exact rc.6 family with required public entries and bundle patches', async t => {
  const fixture = await makeFixture()
  t.after(() => rm(fixture.root, { recursive: true, force: true }))
  const report = await verifyUpstream({
    root: fixture.root,
    resolvePackageJson: name => fixture.packagePaths.get(name),
  })
  assert.deepEqual(report.errors, [])
})

test('upstream gate rejects a mixed package family', async t => {
  const fixture = await makeFixture({
    '@deepseek-ai/dsh-client-runtime': { version: '0.1.0-rc.5' },
  })
  t.after(() => rm(fixture.root, { recursive: true, force: true }))
  const report = await verifyUpstream({
    root: fixture.root,
    resolvePackageJson: name => fixture.packagePaths.get(name),
  })
  assert.ok(report.errors.some(error => error.includes('@deepseek-ai/dsh-client-runtime resolved version is 0.1.0-rc.5')))
})

test('upstream gate rejects a mismatched DSH peer in a workspace package', async t => {
  const fixture = await makeFixture()
  t.after(() => rm(fixture.root, { recursive: true, force: true }))
  await writeJson(join(fixture.root, 'packages/ui/package.json'), {
    name: '@fixture/ui',
    peerDependencies: { '@deepseek-ai/dsh-client-ui-slots': '0.1.0-rc.5' },
  })
  const report = await verifyUpstream({
    root: fixture.root,
    resolvePackageJson: name => fixture.packagePaths.get(name),
  })
  assert.ok(report.errors.some(error => error.includes('packages/ui/package.json: @deepseek-ai/dsh-client-ui-slots is 0.1.0-rc.5')))
})

test('upstream gate rejects missing public entries and backend overrides in the Sandrone patch', async t => {
  const fixture = await makeFixture({
    '@deepseek-ai/dsh-client-ui-theme': { exports: { './package.json': './package.json' } },
  })
  t.after(() => rm(fixture.root, { recursive: true, force: true }))
  await writeFile(join(fixture.root, 'profiles/sandrone-web.patch.yml'), [
    '- insert:',
    '    - id: sandrone-ui',
    "      name: '@sandrone/harness-ui'",
    '    - id: directory-picker-ui',
    "      name: '@deepseek-ai/dsh-client-ui-directory-picker-browse'",
    '    - id: directory-picker-host',
    "      name: '@deepseek-ai/dsh-host-directory-picker-browse'",
    '- id: directory-picker',
    '  disabled: true',
    '- id: session-query-sqlite',
    '  config:',
    '    openAt: first-search',
    '- id: agent-loop',
    '  disabled: true',
  ].join('\n'))
  const report = await verifyUpstream({
    root: fixture.root,
    resolvePackageJson: name => fixture.packagePaths.get(name),
  })
  assert.ok(report.errors.some(error => error.includes('does not expose public entry ./client')))
  assert.ok(report.errors.some(error => error.includes('overrides an official backend owner')))
})
