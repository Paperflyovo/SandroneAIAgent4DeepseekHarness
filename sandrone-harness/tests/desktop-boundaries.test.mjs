import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'

import ipcPolicy from '../apps/desktop/lib/ipc-policy.cjs'
import navigationPolicy from '../apps/desktop/lib/navigation-policy.cjs'
import quitModule from '../apps/desktop/lib/quit-coordinator.cjs'
import resolvePackage from '../apps/desktop/lib/resolve-package.cjs'

const { assertTrustedIpcSender, isTrustedIpcSender } = ipcPolicy
const { classifyNavigation, isExternalHttpUrl, isInternalHarnessUrl } = navigationPolicy
const { createQuitCoordinator } = quitModule
const { packageBin } = resolvePackage

function deferred() {
  let resolve
  let reject
  const promise = new Promise((accept, decline) => { resolve = accept; reject = decline })
  return { promise, resolve, reject }
}

test('navigation permits only the active Harness origin and exact loading file', () => {
  const internalOrigin = 'http://127.0.0.1:43123'
  const loading = pathToFileURL('C:/Sandrone/loading.html').href
  assert.equal(classifyNavigation(`${internalOrigin}/session/1?q=ok#turn`, { internalOrigin, trustedFileUrl: loading }), 'internal')
  assert.equal(classifyNavigation(loading, { internalOrigin, trustedFileUrl: loading }), 'trusted-file')
  assert.equal(classifyNavigation('https://deepseek.com/docs', { internalOrigin, trustedFileUrl: loading }), 'external')
  assert.equal(classifyNavigation('file:///C:/Windows/win.ini', { internalOrigin, trustedFileUrl: loading }), 'deny')
  assert.equal(classifyNavigation('javascript:alert(1)', { internalOrigin, trustedFileUrl: loading }), 'deny')
  assert.equal(classifyNavigation('http://127.0.0.1:59999/private', { internalOrigin, trustedFileUrl: loading }), 'deny')
  assert.equal(classifyNavigation('http://localhost:43123/', { internalOrigin, trustedFileUrl: loading }), 'deny')
  assert.equal(classifyNavigation('http://localhost.:43123/', { internalOrigin, trustedFileUrl: loading }), 'deny')
  assert.equal(classifyNavigation('http://[::ffff:127.0.0.1]:43123/', { internalOrigin, trustedFileUrl: loading }), 'deny')
  assert.equal(classifyNavigation('http://[::ffff:7f00:1]:43123/', { internalOrigin, trustedFileUrl: loading }), 'deny')
  assert.equal(classifyNavigation('http://[::ffff:7fff:ffff]:43123/', { internalOrigin, trustedFileUrl: loading }), 'deny')
  assert.equal(isInternalHarnessUrl(`http://user:pass@127.0.0.1:43123/`, internalOrigin), false)
  assert.equal(isExternalHttpUrl('https://user:pass@example.com/', internalOrigin), false)
})

test('IPC trust requires the current main frame, WebContents, and trusted URL', () => {
  const mainFrame = { url: 'http://127.0.0.1:43123/session/1' }
  const webContents = { mainFrame }
  const window = { webContents, isDestroyed: () => false }
  const options = {
    internalOrigin: 'http://127.0.0.1:43123',
    trustedFileUrl: 'file:///C:/Sandrone/loading.html',
  }
  assert.equal(isTrustedIpcSender({ sender: webContents, senderFrame: mainFrame }, window, options), true)
  assert.equal(isTrustedIpcSender({ sender: webContents, senderFrame: { url: mainFrame.url } }, window, options), false)
  assert.equal(isTrustedIpcSender({ sender: {}, senderFrame: mainFrame }, window, options), false)
  mainFrame.url = 'https://example.com/'
  assert.equal(isTrustedIpcSender({ sender: webContents, senderFrame: mainFrame }, window, options), false)
  assert.throws(() => assertTrustedIpcSender({ sender: webContents, senderFrame: mainFrame }, window, options), /Untrusted IPC sender/)
  mainFrame.url = options.trustedFileUrl
  assert.equal(isTrustedIpcSender({ sender: webContents, senderFrame: mainFrame }, window, options), true)
})

async function makePackageFixture(manifest, binSource = '') {
  const root = await mkdtemp(join(tmpdir(), 'sandrone-package-bin-'))
  const packageRoot = join(root, 'node_modules', '@deepseek-ai', 'dsh')
  await mkdir(join(packageRoot, 'lib'), { recursive: true })
  await writeFile(join(root, 'package.json'), '{}\n')
  await writeFile(join(packageRoot, 'package.json'), `${JSON.stringify(manifest)}\n`)
  await writeFile(join(packageRoot, 'lib', 'bin.js'), binSource)
  return { root, packageRoot, anchor: join(root, 'package.json') }
}

test('packageBin resolves the declared DSH executable from the anchored package', async t => {
  const fixture = await makePackageFixture({ name: '@deepseek-ai/dsh', bin: { dsh: 'lib/bin.js' } }, 'export {}\n')
  t.after(() => rm(fixture.root, { recursive: true, force: true }))
  assert.equal(await readFile(packageBin('@deepseek-ai/dsh', 'dsh', fixture.anchor), 'utf8'), 'export {}\n')
})

test('packageBin rejects manifest identity, traversal, and symlink escapes', async t => {
  const wrongName = await makePackageFixture({ name: '@attacker/dsh', bin: { dsh: 'lib/bin.js' } })
  t.after(() => rm(wrongName.root, { recursive: true, force: true }))
  assert.throws(() => packageBin('@deepseek-ai/dsh', 'dsh', wrongName.anchor), /manifest|expected/i)

  const traversal = await makePackageFixture({ name: '@deepseek-ai/dsh', bin: { dsh: '../../../outside.js' } })
  t.after(() => rm(traversal.root, { recursive: true, force: true }))
  await writeFile(join(traversal.root, 'node_modules', 'outside.js'), '')
  assert.throws(() => packageBin('@deepseek-ai/dsh', 'dsh', traversal.anchor), /invalid.*executable/i)

  const escaped = await makePackageFixture({ name: '@deepseek-ai/dsh', bin: { dsh: 'lib/bin.js' } })
  t.after(() => rm(escaped.root, { recursive: true, force: true }))
  const outside = join(escaped.root, 'outside.js')
  await writeFile(outside, '')
  await rm(join(escaped.packageRoot, 'lib', 'bin.js'))
  try {
    await symlink(outside, join(escaped.packageRoot, 'lib', 'bin.js'), 'file')
    assert.throws(() => packageBin('@deepseek-ai/dsh', 'dsh', escaped.anchor), /invalid.*executable/i)
  } catch (error) {
    if (error.code !== 'EPERM') throw error
  }
})

test('quit coordinator blocks repeated quit events until one bounded shutdown finishes', async () => {
  const gate = deferred()
  let shutdowns = 0
  let finishes = 0
  const coordinator = createQuitCoordinator({
    shutdown: async () => { shutdowns += 1; await gate.promise },
    finish: () => { finishes += 1 },
  })
  const first = { prevented: 0, preventDefault() { this.prevented += 1 } }
  const second = { prevented: 0, preventDefault() { this.prevented += 1 } }
  const firstPromise = coordinator.handle(first)
  const secondPromise = coordinator.handle(second)
  assert.equal(firstPromise, secondPromise)
  assert.equal(first.prevented, 1)
  assert.equal(second.prevented, 1)
  assert.equal(finishes, 0)
  gate.resolve()
  await firstPromise
  assert.equal(shutdowns, 1)
  assert.equal(finishes, 1)
  const finalEvent = { prevented: 0, preventDefault() { this.prevented += 1 } }
  await coordinator.handle(finalEvent)
  assert.equal(finalEvent.prevented, 0)
  assert.equal(finishes, 1)
})

test('preload exposes only the narrow invoke surface and a removable status listener', async () => {
  const source = await readFile(new URL('../apps/desktop/preload.cjs', import.meta.url), 'utf8')
  assert.match(source, /ipcRenderer\.invoke\(['"]desktop:get-status['"]\)/)
  assert.match(source, /ipcRenderer\.invoke\(['"]desktop:restart-harness['"]\)/)
  assert.match(source, /return\s+\(\)\s*=>\s*ipcRenderer\.removeListener/)
  assert.doesNotMatch(source, /ipcRenderer\.send\s*\(/)
  assert.doesNotMatch(source, /sendSync|invoke\([^'"`]/)
})

test('desktop cold start stays bounded without killing a slow official Harness boot', async () => {
  const source = await readFile(new URL('../apps/desktop/main.cjs', import.meta.url), 'utf8')
  assert.match(source, /HARNESS_READINESS_TIMEOUT_MS\s*=\s*10\s*\*\s*60_000/)
  assert.match(source, /readinessTimeoutMs:\s*HARNESS_READINESS_TIMEOUT_MS/)
})

test('desktop launches the official Web profile with Node internals exposed for HMR', async () => {
  const source = await readFile(new URL('../apps/desktop/main.cjs', import.meta.url), 'utf8')
  assert.match(source, /fork\(RUNNER,[\s\S]*?execPath:\s*process\.execPath/)
  assert.match(source, /execArgv:\s*\[['"]--expose-internals['"]\]/)
  assert.match(source, /ELECTRON_RUN_AS_NODE:\s*['"]1['"]/)
  assert.match(source, /stdio:\s*\[['"]ignore['"],\s*['"]pipe['"],\s*['"]pipe['"],\s*['"]ipc['"]\]/)
})

test('manual restart revokes the old origin before stopping Harness', async () => {
  const source = await readFile(new URL('../apps/desktop/main.cjs', import.meta.url), 'utf8')
  const handler = source.match(/ipcMain\.handle\('desktop:restart-harness',[\s\S]*?\n  \}\)/)?.[0] ?? ''
  const revoke = handler.indexOf('activeOrigin = null')
  const loading = handler.indexOf('await showLoadingPage()')
  const restart = handler.indexOf('await supervisor.restart()')
  assert.ok(revoke >= 0 && loading > revoke && restart > loading)
})
