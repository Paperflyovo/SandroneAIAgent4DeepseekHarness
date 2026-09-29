import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'

import { DEFAULT_VERSION, REQUIRED_PACKAGES, REQUIRED_PATCHES, verifyUpstream, installedFamilyProblems } from '../scripts/verify-upstream.mjs'

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
  await writeFile(join(root, 'pnpm-workspace.yaml'), [
    'packages: []',
    'patchedDependencies:',
    ...Object.entries(REQUIRED_PATCHES).map(([dependency, rule]) => `  '${dependency}': ${rule.file}`),
    '',
  ].join('\n'))
  for (const rule of Object.values(REQUIRED_PATCHES)) {
    const patchPath = join(root, ...rule.file.split('/'))
    await mkdir(dirname(patchPath), { recursive: true })
    await writeFile(patchPath, [
      ...(rule.removes ?? []).map(removed => `-${removed}`),
      ...(rule.adds ?? []).map(added => `+${added}`),
    ].join('\n'))
  }
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
        : ['session-controller', 'connection', 'ui-session', 'ui-layout']
      await writeFile(join(packageRoot, 'cordis.patch.yml'), `- insert:\n${rows.map(id => `    - id: ${id}\n      name: example`).join('\n')}\n`)
    }
    Object.assign(manifest, overrides[name] ?? {})
    const manifestPath = join(packageRoot, 'package.json')
    await writeJson(manifestPath, manifest)
    packagePaths.set(name, manifestPath)
  }
  return { root, packagePaths }
}

test('upstream gate accepts one exact package family with required public entries and bundle patches', async t => {
  const fixture = await makeFixture()
  t.after(() => rm(fixture.root, { recursive: true, force: true }))
  const report = await verifyUpstream({
    root: fixture.root,
    resolvePackageJson: name => fixture.packagePaths.get(name),
  })
  assert.deepEqual(report.errors, [])
})

test('upstream gate detects stale nested runtime packages and repeated preset patches', async t => {
  const root = await mkdtemp(join(tmpdir(), 'sandrone-installed-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeJson(join(root, 'node_modules/consumer/node_modules/@deepseek-ai/dsh-session/package.json'), { name: '@deepseek-ai/dsh-session', version: '0.1.1-rc.1' })
  const presets = join(root, 'node_modules/@deepseek-ai/dsh-agent-presets')
  await writeJson(join(presets, 'package.json'), { name: '@deepseek-ai/dsh-agent-presets', version: DEFAULT_VERSION })
  for (const preset of ['standard', 'cordis', 'ptc']) {
    const file = join(presets, 'presets', preset, 'agent.cordis.yml')
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, '- id: sandrone-image-tools\n- id: sandrone-image-tools\n')
  }
  const errors = await installedFamilyProblems(root)
  assert.equal(errors.length, 4)
  assert.ok(errors.some(error => error.includes('dsh-session@0.1.1-rc.1')))
})

test('upstream gate rejects a mixed package family', async t => {
  const fixture = await makeFixture({
    '@deepseek-ai/dsh-client-ui-session': { version: '0.1.0-rc.5' },
  })
  t.after(() => rm(fixture.root, { recursive: true, force: true }))
  const report = await verifyUpstream({
    root: fixture.root,
    resolvePackageJson: name => fixture.packagePaths.get(name),
  })
  assert.ok(report.errors.some(error => error.includes('@deepseek-ai/dsh-client-ui-session resolved version is 0.1.0-rc.5')))
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
