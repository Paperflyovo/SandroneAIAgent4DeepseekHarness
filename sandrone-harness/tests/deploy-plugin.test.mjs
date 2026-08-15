import assert from 'node:assert/strict'
import { lstat, mkdir, mkdtemp, readFile, readlink, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'

import deployModule from '../apps/desktop/lib/deploy-plugin.cjs'

const { deployPlugin } = deployModule

async function makeSource(root, manifest = {}) {
  const source = join(root, 'source')
  await mkdir(join(source, 'lib'), { recursive: true })
  await mkdir(join(source, 'src'), { recursive: true })
  await writeFile(join(source, 'package.json'), JSON.stringify({
    name: '@sandrone/harness-ui',
    version: '1.2.3',
    ...manifest,
  }))
  await writeFile(join(source, 'lib/index.js'), 'export function apply() {}\n')
  await writeFile(join(source, 'lib/client.js'), 'export function apply() {}\n')
  await writeFile(join(source, 'src/private.jsx'), 'not deployed\n')
  await writeFile(join(source, 'development-only.txt'), 'not deployed\n')
  return source
}

test('deployPlugin copies built files atomically, omits source, and installs a managed link', async t => {
  const root = await mkdtemp(join(tmpdir(), 'sandrone-deploy-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = await makeSource(root)
  const dshHome = join(root, 'dsh-home')
  const deployed = deployPlugin({ source, dshHome })

  assert.equal(deployed.version, '1.2.3')
  assert.equal(JSON.parse(await readFile(join(deployed.target, 'package.json'), 'utf8')).name, '@sandrone/harness-ui')
  await assert.rejects(lstat(join(deployed.target, 'src')), /ENOENT/)
  await assert.rejects(lstat(join(deployed.target, 'development-only.txt')), /ENOENT/)
  assert.equal((await lstat(deployed.link)).isSymbolicLink(), true)
  assert.equal(resolve(dirname(deployed.link), await readlink(deployed.link)), resolve(deployed.target))

  const again = deployPlugin({ source, dshHome })
  assert.deepEqual(again, deployed)
})

test('deployPlugin refreshes changed build output without changing the package version', async t => {
  const root = await mkdtemp(join(tmpdir(), 'sandrone-deploy-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = await makeSource(root)
  const dshHome = join(root, 'dsh-home')
  const first = deployPlugin({ source, dshHome })

  await writeFile(join(source, 'lib/client.js'), 'export const revision = 2\n')
  const refreshed = deployPlugin({ source, dshHome })

  assert.deepEqual(refreshed, first)
  assert.equal(await readFile(join(refreshed.target, 'lib/client.js'), 'utf8'), 'export const revision = 2\n')
  assert.equal((await lstat(refreshed.link)).isSymbolicLink(), true)
  assert.equal(resolve(dirname(refreshed.link), await readlink(refreshed.link)), resolve(refreshed.target))

  const repeated = deployPlugin({ source, dshHome })
  assert.deepEqual(repeated, first)
  assert.equal(await readFile(join(repeated.target, 'lib/client.js'), 'utf8'), 'export const revision = 2\n')
  await assert.rejects(lstat(join(repeated.target, 'src')), /ENOENT/)
  await assert.rejects(lstat(join(repeated.target, 'development-only.txt')), /ENOENT/)
})

test('deployPlugin refuses to replace a profile package not managed as a link', async t => {
  const root = await mkdtemp(join(tmpdir(), 'sandrone-deploy-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = await makeSource(root)
  const dshHome = join(root, 'dsh-home')
  const link = join(dshHome, 'profiles/web/node_modules/@sandrone/harness-ui')
  await mkdir(link, { recursive: true })
  await assert.rejects(
    Promise.resolve().then(() => deployPlugin({ source, dshHome })),
    /Refusing to replace non-link profile package/,
  )
})

test('deployPlugin rejects versions that could escape the managed extension root', async t => {
  const root = await mkdtemp(join(tmpdir(), 'sandrone-deploy-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = await makeSource(root, { version: '../../../outside' })
  assert.throws(
    () => deployPlugin({ source, dshHome: join(root, 'dsh-home') }),
    /invalid|version|outside|escape/i,
  )
})

test('deployPlugin rejects a package that is not the Sandrone Harness UI', async t => {
  const root = await mkdtemp(join(tmpdir(), 'sandrone-deploy-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = await makeSource(root, { name: '@attacker/lookalike' })
  assert.throws(
    () => deployPlugin({ source, dshHome: join(root, 'dsh-home') }),
    /package|name|Sandrone/i,
  )
})
