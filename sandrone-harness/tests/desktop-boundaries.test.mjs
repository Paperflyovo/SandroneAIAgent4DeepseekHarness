import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'

import ipcPolicy from '../apps/desktop/lib/ipc-policy.cjs'
import navigationPolicy from '../apps/desktop/lib/navigation-policy.cjs'
import quitModule from '../apps/desktop/lib/quit-coordinator.cjs'
import resolvePackage from '../apps/desktop/lib/resolve-package.cjs'
import localImagePolicy from '../apps/desktop/lib/local-image-policy.cjs'
import skillDeployment from '../apps/desktop/lib/deploy-skills.cjs'
import presetDeployment from '../apps/desktop/lib/deploy-agent-presets.cjs'

const { assertTrustedIpcSender, isTrustedIpcSender } = ipcPolicy
const { classifyNavigation, isExternalHttpUrl, isInternalHarnessUrl } = navigationPolicy
const { createQuitCoordinator } = quitModule
const { packageBin } = resolvePackage
const { resolveAuthorizedLocalImage, workspaceRootsFromStorage } = localImagePolicy
const { deploySkills } = skillDeployment
const { deployAgentPresets, MANAGED_MARKER } = presetDeployment

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
  assert.match(source, /ipcRenderer\.invoke\(['"]desktop:get-screenshot-directory['"]\)/)
  assert.match(source, /ipcRenderer\.invoke\(['"]desktop:choose-screenshot-directory['"]\)/)
  assert.match(source, /ipcRenderer\.invoke\(['"]desktop:read-local-image['"],\s*String\(path\)\)/)
  assert.match(source, /ipcRenderer\.invoke\(['"]desktop:reveal-local-image['"],\s*String\(path\)\)/)
  assert.match(source, /captureSession:\s*\(options\)\s*=>\s*ipcRenderer\.invoke\(['"]desktop:capture-session-screenshot['"],\s*options\)/)
  assert.match(source, /desktop:show-application-menu['"],\s*menuId,\s*position,\s*state/)
  assert.match(source, /return\s+\(\)\s*=>\s*ipcRenderer\.removeListener/)
  assert.doesNotMatch(source, /ipcRenderer\.send\s*\(/)
  assert.doesNotMatch(source, /sendSync|invoke\([^'"`]/)
})

test('desktop screenshot capture remains main-process owned and bounded', async () => {
  const source = await readFile(new URL('../apps/desktop/main.cjs', import.meta.url), 'utf8')
  assert.match(source, /ipcMain\.handle\(['"]desktop:capture-session-screenshot['"]\s*,\s*async \(event, options/)
  assert.match(source, /assertTrusted\(event\)/)
  assert.match(source, /webContents\.capturePage\(/)
  assert.match(source, /executeJavaScript\(`\(async \(selection\) =>/)
  assert.match(source, /MAX_SESSION_SCREENSHOT_HEIGHT/)
  assert.match(source, /selection\.top/)
  assert.match(source, /desktopSettings\.screenshotDirectory/)
  assert.match(source, /function writeScreenshotFile\(directory, bytes, now = new Date\(\)\)/)
  assert.match(source, /fs\.writeFileSync\(targetPath, bytes, \{ flag: ['"]wx['"] \}\)/)
  assert.match(source, /const targetPath = writeScreenshotFile\(screenshotDirectory, bytes\)/)
  assert.doesNotMatch(source, /dialog\.showSaveDialog\(mainWindow/)
  assert.match(source, /clipboard\.writeImage\(nativeImage\.createFromBuffer\(bytes\)\)/)
  assert.match(source, /bytes: Uint8Array\.from\(bytes\)/)
  assert.match(source, /const chunks = \[\]/)
  assert.match(source, /sharp\(\{[\s\S]*?create:/)
  assert.match(source, /translate3d\(0,/)
  assert.match(source, /data-sandrone-screenshot-overlay/)
  assert.match(source, /setProperty\(['"]visibility['"],\s*['"]hidden['"],\s*['"]important['"]\)/)
  assert.match(source, /setProperty\(['"]scroll-behavior['"],\s*['"]auto['"],\s*['"]important['"]\)/)
  assert.ok(source.includes("setProperty('padding-bottom'"))
  assert.match(source, /return \{ ok: false, error: message \}/)
  assert.doesNotMatch(source, /result\?\.path|options\?\.path|requestedPath.*screenshot/)
})

test('local image policy permits only real image files inside persisted workspaces', async t => {
  const root = await mkdtemp(join(tmpdir(), 'sandrone-local-image-'))
  const workspace = join(root, 'workspace')
  const outside = join(root, 'outside')
  await mkdir(workspace)
  await mkdir(outside)
  const image = join(workspace, '角色.webp')
  const text = join(workspace, 'notes.txt')
  const escaped = join(outside, 'escaped.png')
  await writeFile(image, Buffer.from([0x52, 0x49, 0x46, 0x46]))
  await writeFile(text, 'not an image')
  await writeFile(escaped, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  t.after(() => rm(root, { recursive: true, force: true }))

  const record = resolveAuthorizedLocalImage(image, [workspace])
  assert.equal(record.path, image)
  assert.equal(record.mimeType, 'image/webp')
  assert.throws(() => resolveAuthorizedLocalImage(text, [workspace]), /Unsupported local image type/)
  assert.throws(() => resolveAuthorizedLocalImage(escaped, [workspace]), /outside the authorized workspaces/)
  assert.throws(() => resolveAuthorizedLocalImage('\\\\server\\share\\image.png', [workspace]), /must be absolute/)

  const link = join(workspace, 'escape.png')
  try {
    await symlink(escaped, link, 'file')
    assert.throws(() => resolveAuthorizedLocalImage(link, [workspace]), /outside the authorized workspaces/)
  } catch (error) {
    if (error.code !== 'EPERM') throw error
  }
})

test('workspace storage parser extracts only non-empty workspace paths', () => {
  assert.deepEqual(workspaceRootsFromStorage({
    tables: { workspaces: { a: { path: 'C:\\work' }, b: { path: '' }, c: { title: 'missing' } } },
  }), ['C:\\work'])
})

test('desktop deploys bundled Skills into the Harness user Skill root', async t => {
  const root = await mkdtemp(join(tmpdir(), 'sandrone-skills-'))
  const source = join(root, 'source')
  const home = join(root, 'home')
  await mkdir(join(source, 'image-preview'), { recursive: true })
  await writeFile(join(source, 'image-preview', 'SKILL.md'), '---\nname: image-preview\ndescription: preview\n---\n')
  await mkdir(join(source, 'not-a-skill'), { recursive: true })
  await writeFile(join(source, 'not-a-skill', 'SKILL.md'), '---\nname: not-a-skill\ndescription: ignored\n---\n')
  t.after(() => rm(root, { recursive: true, force: true }))

  const deployed = deploySkills({ sourceRoot: source, dshHome: home, skillNames: ['image-preview'] })
  assert.equal(deployed.length, 1)
  assert.equal(await readFile(join(home, 'skills', 'image-preview', 'SKILL.md'), 'utf8'), '---\nname: image-preview\ndescription: preview\n---\n')
  await assert.rejects(readFile(join(home, 'skills', 'not-a-skill', 'SKILL.md'), 'utf8'))
})

test('extension config normalizes untrusted values and builds a restart patch', async t => {
  const module = await import('../apps/desktop/lib/extensions-config.cjs')
  const config = module.normalizeExtensionsConfig({
    buddy: { name: '  Klee  ' },
    mcp: { servers: [{ name: 'github', transport: 'stdio', command: 'npx', args: ['-y', 'server'] }] },
    skills: { disabled: ['sandrone-image-preview', 'sandrone-image-preview'] },
    plugins: { managed: [{ id: 'extra', name: '@scope/plugin', enabled: true }] },
    im: { enabled: true, platform: 'anything', allowedUsers: ['10001', '10001'] },
  })
  assert.equal(config.buddy.name, 'Klee')
  assert.deepEqual(config.skills.disabled, ['sandrone-image-preview'])
  assert.equal(config.im.platform, 'qqbot')
  assert.deepEqual(config.im.allowedUsers, ['10001'])
  const patch = module.buildExtensionsPatch(config)
  assert.match(patch, /@deepseek-ai\/dsh-mcp-client/)
  assert.match(patch, /@scope\/plugin/)
  assert.match(patch, /serverName: "github"/)

  const root = await mkdtemp(join(tmpdir(), 'sandrone-extension-config-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const target = join(root, 'extensions.json')
  module.writeExtensionsConfig(target, config)
  assert.equal(module.readExtensionsConfig(target).buddy.name, 'Klee')
})

test('disabled bundled Skills remove only their Sandrone-owned deployment', async t => {
  const root = await mkdtemp(join(tmpdir(), 'sandrone-disabled-skill-'))
  const source = join(root, 'source')
  const home = join(root, 'home')
  await mkdir(join(source, 'managed'), { recursive: true })
  await writeFile(join(source, 'managed', 'SKILL.md'), '---\nname: managed\ndescription: managed\n---\n')
  await mkdir(join(home, 'skills', 'user-skill'), { recursive: true })
  await writeFile(join(home, 'skills', 'user-skill', 'SKILL.md'), 'user')
  await mkdir(join(home, 'skills', 'managed'), { recursive: true })
  await writeFile(join(home, 'skills', 'managed', 'SKILL.md'), 'old')
  t.after(() => rm(root, { recursive: true, force: true }))

  deploySkills({ sourceRoot: source, dshHome: home, skillNames: ['managed'], disabledNames: ['managed'] })
  await assert.rejects(readFile(join(home, 'skills', 'managed', 'SKILL.md'), 'utf8'))
  assert.equal(await readFile(join(home, 'skills', 'user-skill', 'SKILL.md'), 'utf8'), 'user')
})

test('desktop package includes bundled Skills', async () => {
  const source = await readFile(new URL('../apps/desktop/electron-builder.yml', import.meta.url), 'utf8')
  assert.match(source, /- skills\/sandrone-image-preview\/\*\*\/\*/)
  assert.match(source, /- skills\/sandrone-harness-frontend-lifecycle\/\*\*\/\*/)
  assert.match(source, /- skills\/sandrone-harness-gpt-development\/\*\*\/\*/)
})

test('desktop deploys the bundled image tool package before launching Harness', async () => {
  const source = await readFile(new URL('../apps/desktop/main.cjs', import.meta.url), 'utf8')
  assert.match(source, /deployRuntimePackage\(\{[\s\S]*?packageName:\s*['"]@sandrone\/harness-image-tools['"]/)
  assert.match(source, /deployPlugin\([\s\S]*?deployRuntimePackage\([\s\S]*?prepareExtensions\(\)/)
})

test('desktop deploys only Sandrone-managed Agent presets under DSH_HOME', async t => {
  const root = await mkdtemp(join(tmpdir(), 'sandrone-agent-presets-'))
  const source = join(root, 'source')
  const home = join(root, 'home')
  await mkdir(join(source, 'sandrone-buddy'), { recursive: true })
  await writeFile(join(source, 'sandrone-buddy', 'preset.yml'), 'name: Buddy\n')
  await writeFile(join(source, 'sandrone-buddy', 'agent.cordis.yml'), '- id: persona\n  name: test\n')
  t.after(() => rm(root, { recursive: true, force: true }))

  const deployed = deployAgentPresets({ sourceRoot: source, dshHome: home, presetNames: ['sandrone-buddy'] })
  assert.equal(deployed.length, 1)
  assert.equal(await readFile(join(home, '.agent-presets', 'sandrone-buddy', MANAGED_MARKER), 'utf8'), 'managed by Sandrone\n')
  await mkdir(join(source, 'user-preset'), { recursive: true })
  await writeFile(join(source, 'user-preset', 'preset.yml'), 'name: User\n')
  await writeFile(join(source, 'user-preset', 'agent.cordis.yml'), '- id: persona\n  name: test\n')
  await mkdir(join(home, '.agent-presets', 'user-preset'), { recursive: true })
  await writeFile(join(home, '.agent-presets', 'user-preset', 'agent.cordis.yml'), 'user owned\n')
  assert.throws(
    () => deployAgentPresets({ sourceRoot: source, dshHome: home, presetNames: ['user-preset'] }),
    /user-owned/,
  )
})

test('desktop package and launchers include the Sandrone Buddy preset', async () => {
  const [builder, main, web] = await Promise.all([
    readFile(new URL('../apps/desktop/electron-builder.yml', import.meta.url), 'utf8'),
    readFile(new URL('../apps/desktop/main.cjs', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/run-web.mjs', import.meta.url), 'utf8'),
  ])
  assert.match(builder, /- presets\/sandrone-buddy\/\*\*\/\*/)
  assert.match(builder, /packages\/sandrone-image-tools\/src\/\*\*\/\*/)
  assert.match(main, /deployAgentPresets/)
  assert.match(web, /deployAgentPresets/)
})

test('desktop exposes narrow extension config and Skill scan IPC only', async () => {
  const [main, preload] = await Promise.all([
    readFile(new URL('../apps/desktop/main.cjs', import.meta.url), 'utf8'),
    readFile(new URL('../apps/desktop/preload.cjs', import.meta.url), 'utf8'),
  ])
  for (const channel of ['desktop:get-extensions-config', 'desktop:save-extensions-config', 'desktop:scan-skills']) {
    assert.match(main, new RegExp(channel))
    assert.match(preload, new RegExp(channel))
  }
  assert.match(main, /writeExtensionsPatch\(extensionsPatchPath\(\), config\)/)
  assert.match(main, /['"]--patch['"], extensionsPatchPath\(\)/)
  assert.doesNotMatch(preload, /require\(['"]node:fs|fs\.readFile|fs\.writeFile|rmSync|arbitrary/)
})

test('workspace browser stays inside registered workspace roots', async t => {
  const { listWorkspaceDirectory, readWorkspaceFile } = await import('../apps/desktop/lib/workspace-browser.cjs')
  const root = await mkdtemp(join(tmpdir(), 'sandrone-workspace-browser-'))
  const outside = await mkdtemp(join(tmpdir(), 'sandrone-workspace-outside-'))
  await mkdir(join(root, 'src'), { recursive: true })
  await writeFile(join(root, 'src', 'index.js'), 'export const value = 1\n')
  await writeFile(join(outside, 'secret.txt'), 'secret')
  t.after(() => Promise.all([rm(root, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })]))

  const listing = listWorkspaceDirectory(root, '', [root])
  assert.equal(listing.entries.find(entry => entry.name === 'src')?.directory, true)
  assert.equal(readWorkspaceFile(root, join('src', 'index.js'), [root]).text, 'export const value = 1\n')
  assert.throws(() => listWorkspaceDirectory(outside, '', [root]), /not registered/)
  assert.throws(() => readWorkspaceFile(root, join('..', basename(outside), 'secret.txt'), [root]), /escapes/)
})

test('desktop exposes bounded workspace browsing IPC', async () => {
  const [main, preload] = await Promise.all([
    readFile(new URL('../apps/desktop/main.cjs', import.meta.url), 'utf8'),
    readFile(new URL('../apps/desktop/preload.cjs', import.meta.url), 'utf8'),
  ])
  for (const channel of ['desktop:list-workspace-directory', 'desktop:read-workspace-file', 'desktop:reveal-workspace-path']) {
    assert.match(main, new RegExp(channel))
    assert.match(preload, new RegExp(channel))
  }
  assert.match(main, /readWorkspaceRoots\(workspaceStoragePath\(\)\)/)
  assert.match(main, /statSync\(resolved\.target\)\.isDirectory\(\)[\s\S]*?shell\.openPath\(resolved\.target\)/)
  assert.match(main, /shell\.showItemInFolder\(resolved\.target\)/)
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
  assert.match(source, /SANDRONE_DSH_ARGS:\s*JSON\.stringify\(\[['"]web['"],[\s\S]*?['"]--no-open['"]\]\)/)
})

test('desktop loading page uses the current brand mark without a framed card', async () => {
  const source = await readFile(new URL('../apps/desktop/loading.html', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /class=['"]card['"]|\.card\s*\{/)
  assert.match(source, /class=['"]launch-copy['"]/)
  assert.match(source, /<img class=['"]mark['"] src=['"]\.\.\/\.\.\/build\/icon\.svg['"] alt=['"]['"]>/)
  assert.match(source, /img-src ['"]self['"] data:/)
  assert.match(source, /\.launch-copy\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*center;/)
})

test('desktop menu avoids duplicate window actions and labels theme destination', async () => {
  const source = await readFile(new URL('../apps/desktop/main.cjs', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /role:\s*['"]close['"],\s*label:\s*['"]关闭窗口['"]/)
  assert.doesNotMatch(source, /role:\s*['"]resetZoom['"],\s*label:\s*['"]实际大小['"]/)
  assert.match(source, /id:\s*['"]toggle-theme['"]/)
  assert.match(source, /colorScheme === ['"]dark['"] \? ['"]切换白天模式['"] : ['"]切换夜间模式['"]/)
})

test('manual restart revokes the old origin before stopping Harness', async () => {
  const source = await readFile(new URL('../apps/desktop/main.cjs', import.meta.url), 'utf8')
  const handler = source.match(/ipcMain\.handle\('desktop:restart-harness',[\s\S]*?\n  \}\)/)?.[0] ?? ''
  const revoke = handler.indexOf('activeOrigin = null')
  const loading = handler.indexOf('await showLoadingPage()')
  const restart = handler.indexOf('await supervisor.restart()')
  assert.ok(revoke >= 0 && loading > revoke && restart > loading)
})
