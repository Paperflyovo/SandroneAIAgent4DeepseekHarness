import assert from 'node:assert/strict'
import { lstat, mkdir, mkdtemp, readlink, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'

import deployment from '../apps/desktop/lib/deploy-runtime-package.cjs'

const { deployRuntimePackage } = deployment

async function makeSource(root, name = '@sandrone/harness-image-tools') {
  const source = join(root, 'source')
  await mkdir(join(source, 'src'), { recursive: true })
  await writeFile(join(source, 'package.json'), JSON.stringify({ name, version: '0.1.0', main: 'src/index.js' }))
  await writeFile(join(source, 'src/index.js'), 'export function apply() {}\n')
  return source
}

test('desktop links a bundled runtime package into the DSH Web profile', async t => {
  const root = await mkdtemp(join(tmpdir(), 'sandrone-runtime-package-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = await makeSource(root)
  const deployed = deployRuntimePackage({
    source,
    dshHome: join(root, 'dsh-home'),
    packageName: '@sandrone/harness-image-tools',
  })

  assert.equal((await lstat(deployed.link)).isSymbolicLink(), true)
  assert.equal(resolve(dirname(deployed.link), await readlink(deployed.link)), resolve(source))
  assert.deepEqual(deployRuntimePackage({
    source,
    dshHome: join(root, 'dsh-home'),
    packageName: '@sandrone/harness-image-tools',
  }), deployed)
})

test('desktop refuses runtime package identity mismatches and user-owned profile entries', async t => {
  const root = await mkdtemp(join(tmpdir(), 'sandrone-runtime-package-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = await makeSource(root, '@attacker/lookalike')
  assert.throws(() => deployRuntimePackage({
    source,
    dshHome: join(root, 'dsh-home'),
    packageName: '@sandrone/harness-image-tools',
  }), /Refusing to deploy/)

  const validSource = await makeSource(join(root, 'valid'))
  const occupied = join(root, 'dsh-home', 'profiles', 'web', 'node_modules', '@sandrone', 'harness-image-tools')
  await mkdir(occupied, { recursive: true })
  assert.throws(() => deployRuntimePackage({
    source: validSource,
    dshHome: join(root, 'dsh-home'),
    packageName: '@sandrone/harness-image-tools',
  }), /Refusing to replace non-link/)
})
