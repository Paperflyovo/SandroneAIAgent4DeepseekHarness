import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { once } from 'node:events'
import { checkSidebarCollapse, checkComposerTextAlignment, checkAttachmentPicker, checkConversationResize, checkOpenInAppMenu, checkCommandLauncher, checkShellGeometry, checkSessionViews, checkPermissionSelection } from './qa-workflow-checks.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const appRoot = resolve(process.env.QA_APP_ROOT || root)
const requireApp = createRequire(join(appRoot, 'package.json'))
const { deployPlugin } = requireApp('./apps/desktop/lib/deploy-plugin.cjs')
const { deployRuntimePackage } = requireApp('./apps/desktop/lib/deploy-runtime-package.cjs')
const { deployAgentPresets } = requireApp('./apps/desktop/lib/deploy-agent-presets.cjs')
const { packageBin } = requireApp('./apps/desktop/lib/resolve-package.cjs')
const { redact } = requireApp('./apps/desktop/lib/harness-supervisor.cjs')
const require = createRequire(import.meta.url)
const playwrightRoot = process.env.PLAYWRIGHT_PACKAGE_ROOT || join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const { chromium } = require(playwrightRoot)
const temporary = await mkdtemp(join(root, 'runtime/tmp/qa-upgrade-'))
const home = join(temporary, 'home')
const workspace = join(temporary, 'workspace')
await mkdir(workspace, { recursive: true })
const imagePath = join(workspace, 'preview.png')
await writeFile(imagePath, await readFile(join(appRoot, 'build/icon.png')))
const requests = []
const report = { appRoot, checks: [], errors: [] }
const mock = createServer(async (request, response) => {
  try {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const input = JSON.parse(Buffer.concat(chunks).toString())
    requests.push(input)
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    const send = (delta, finish_reason = null) => response.write(`data: ${JSON.stringify({ id: 'chatcmpl-upgrade', object: 'chat.completion.chunk', model: 'qa-model', choices: [{ index: 0, delta, finish_reason }] })}\n\n`)
    send({ role: 'assistant', content: '' })
    const tool = input.tools?.find(tool => tool.function.name === 'pwsh')
    const toolResult = input.messages?.some(message => message.role === 'tool')
    if (tool && !toolResult && input.messages?.some(message => message.role === 'user' && JSON.stringify(message.content).includes('terminal-qa'))) {
      send({ tool_calls: [{ index: 0, id: 'call-terminal', type: 'function', function: { name: 'pwsh', arguments: JSON.stringify({ command: "Write-Output 'SANDRONE_TERMINAL_OK'", description: 'Verify packaged PowerShell execution' }) } }] })
      send({}, 'tool_calls')
    } else {
      const text = `SANDRONE_REPLY_OK\n\n![本地图片](<${imagePath}>)`
      for (const content of text.match(/.{1,15}|\n/g)) {
        send({ content })
        await new Promise(resolve => setTimeout(resolve, 20))
      }
      send({}, 'stop')
    }
    response.end('data: [DONE]\n\n')
  } catch (error) { response.destroy(error) }
})
mock.listen(0, '127.0.0.1')
await once(mock, 'listening')
deployPlugin({ source: join(appRoot, 'packages/sandrone-ui'), dshHome: home })
deployRuntimePackage({ source: join(appRoot, 'packages/sandrone-image-tools'), dshHome: home, packageName: '@sandrone/harness-image-tools' })
deployAgentPresets({ sourceRoot: join(appRoot, 'presets'), dshHome: home, presetNames: ['sandrone-buddy'] })
const bridge = join(home, 'profiles/web/node_modules/@sandrone/qa-bridge')
await mkdir(bridge, { recursive: true })
await writeFile(join(bridge, 'package.json'), JSON.stringify({ name: '@sandrone/qa-bridge', version: '1.0.0', type: 'module', exports: { '.': './index.js', './client': './client.js' }, dsh: { client: { platform: 'web', inject: ['@deepseek-ai/dsh-client-ui-session', '@deepseek-ai/dsh-api-remotes'] } } }))
await writeFile(join(bridge, 'index.js'), 'export function apply() {}\n')
await writeFile(join(bridge, 'client.js'), `window.__ModuleLoader__.load({ id: '@sandrone/qa-bridge', factory: () => ({ inject: ['remote', 'remote.workspace', 'sessions'], apply(ctx) { ctx.effect(() => { window.__sandroneQa = ctx; return () => { delete window.__sandroneQa } }) } }) })`)
const patch = join(temporary, 'qa.patch.yml')
await writeFile(patch, [
  '- insert:', '    - id: qa-bridge', "      name: '@sandrone/qa-bridge'",
  '- id: llm-pi-ai', '  config:', '    providers:', '      sandrone-qa:',
  '        api: openai-completions', '        apiKeyEnv: SANDRONE_QA_API_KEY',
  `        baseURL: http://127.0.0.1:${mock.address().port}/v1`,
  '        models:', '          - id: qa-model', '            input: [text, image]',
  '- id: agent-default-model', '  config:', '    provider: sandrone-qa', '    model: qa-model',
].join('\n'))
const env = { ...process.env, DSH_HOME: home, SANDRONE_QA_API_KEY: 'local-fixture', SANDRONE_DSH_BIN: packageBin('@deepseek-ai/dsh', 'dsh', join(appRoot, 'package.json')), SANDRONE_DSH_ARGS: JSON.stringify(['web', '--patch', join(appRoot, 'profiles/sandrone-web.patch.yml'), '--patch', patch, '--port', '0', '--no-open']) }
if (process.platform === 'win32') {
  for (const name of Object.keys(env)) if (name.toLowerCase() === 'path') delete env[name]
  const windowsRoot = process.env.SystemRoot || 'C:\\Windows'
  env.PATH = [join(windowsRoot, 'System32'), windowsRoot, join(windowsRoot, 'System32/WindowsPowerShell/v1.0')].join(';')
}
if (process.env.QA_NODE_EXECUTABLE) env.ELECTRON_RUN_AS_NODE = '1'
const child = fork(join(appRoot, 'apps/desktop/harness-runner.mjs'), [], { execPath: process.env.QA_NODE_EXECUTABLE || process.execPath, execArgv: ['--expose-internals'], cwd: temporary, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true })
let browser
let page
try {
  const url = await new Promise((resolve, reject) => {
    let output = ''
    const timer = setTimeout(() => reject(new Error('Harness readiness timeout')), 90000)
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Harness exited ${code}`)) })
    child.stdout.on('data', chunk => {
      output += String(chunk)
      const match = output.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=[\w-]+)/)
      if (match) { clearTimeout(timer); resolve(match[1]) }
    })
    child.stderr.on('data', chunk => report.errors.push(redact(chunk)))
  })
  browser = await chromium.launch({ channel: 'msedge', headless: true })
  page = await browser.newPage({ viewport: { width: 1280, height: 688 }, deviceScaleFactor: 1.5 })
  page.on('pageerror', error => report.errors.push(error.message))
  await page.goto(url)
  await page.waitForFunction(() => window.__sandroneQa)
  await page.getByRole('button', { name: '继续', exact: true }).click()
  const onboarding = page.getByRole('button', { name: '稍后配置', exact: true })
  if (await onboarding.isVisible()) await onboarding.click()
  await page.evaluate(async workspace => {
    const result = await window.__sandroneQa.remote.workspace.create({ path: workspace })
    if (!result.ok) throw new Error(result.error.message)
  }, workspace)
  await page.locator('[role="treeitem"]').filter({ hasText: 'workspace' }).first().hover()
  await page.getByRole('button', { name: '在“workspace”中新建会话', exact: true }).click()
  const composer = page.locator('[data-sandrone-composer-input][contenteditable="true"]')
  await checkSidebarCollapse(page)
  report.composerAlignment = { hero: await checkComposerTextAlignment(page) }
  await checkCommandLauncher(page)
  await checkPermissionSelection(page)
  await checkShellGeometry(page)
  await checkAttachmentPicker(page)
  report.checks.push('new-session commands by pointer, keyboard and slash; single attachment control')
  await composer.fill('terminal-qa')
  await composer.press('Enter')
  await page.getByText('SANDRONE_REPLY_OK', { exact: true }).first().waitFor({ timeout: 30000 })
  assert.ok(requests.some(input => input.messages?.some(message => message.role === 'tool' && JSON.stringify(message.content).includes('SANDRONE_TERMINAL_OK'))))
  report.checks.push('official PowerShell tool and streamed reply')
  await page.waitForFunction(() => [...document.images].some(img => img.src.includes('/api/file?path=') && img.complete && img.naturalWidth > 0))
  report.checks.push('Windows local image file delivery')
  await checkCommandLauncher(page)
  await checkShellGeometry(page)
  report.checks.push('active-session commands and titlebar geometry')
  report.composerAlignment.docked = await checkComposerTextAlignment(page)
  await page.mouse.move(2, 2)
  await composer.press('Control+Home')
  await page.locator('[data-composer-card]').screenshot({ path: join(temporary, 'composer-aligned.png'), caret: 'initial' })
  report.checks.push('hero and docked placeholder, caret and typed text share origins and font metrics at 150% scaling')
  await checkConversationResize(page)
  report.checks.push('native left/right resize keeps attachment hit targets and file chooser reachable')
  await checkSessionViews(page)
  await checkOpenInAppMenu(page)
  const launches = []
  await page.route('**/open-in-app/open', async route => {
    launches.push(route.request().postDataJSON())
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
  const launchResponse = page.waitForResponse('**/open-in-app/open')
  await page.locator('[data-sandrone-open-in-app] button[data-state]').click()
  await launchResponse
  assert.equal(launches.length, 1)
  assert.equal(launches[0].path, workspace)
  assert.ok(launches[0].app)
  await page.locator('[data-sandrone-open-in-app]').getByRole('button', { name: '选择打开方式', exact: true }).click()
  const selectionResponse = page.waitForResponse('**/open-in-app/open')
  const menuChoices = page.getByRole('menu').getByRole('menuitem')
  const selectedChoice = menuChoices.nth(Math.min(1, await menuChoices.count() - 1))
  const selectedLabel = (await selectedChoice.innerText()).trim()
  await selectedChoice.click()
  await selectionResponse
  assert.equal(launches.length, 2)
  assert.equal(launches[1].path, workspace)
  assert.equal((await page.locator('[data-sandrone-open-in-app] button[data-state]').innerText()).trim(), selectedLabel)
  await page.unroute('**/open-in-app/open')
  report.checks.push('native external-app menu placement, keyboard navigation and launch request (OS launch stubbed)')
  report.checks.push('registered conversation views match their controls')
  await composer.fill('image-qa')
  const chooserReady = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '添加附件', exact: true }).click()
  await (await chooserReady).setFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Native file attachment fixture') })
  await page.getByRole('button', { name: '移除文件 notes.txt', exact: true }).click()
  await page.locator('[data-composer-card] input[type="file"]').setInputFiles(imagePath)
  await page.getByRole('button', { name: '移除图片 preview.png', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: '移除图片 preview.png', exact: true }).count(), 0)
  await page.locator('[data-composer-card] input[type="file"]').setInputFiles(imagePath)
  await composer.press('Enter')
  await page.waitForFunction(() => !document.querySelector('[aria-label="停止生成"]'))
  const deadline = Date.now() + 15000
  while (!requests.some(input => input.messages?.some(message => Array.isArray(message.content) && message.content.some(part => part.type === 'image_url'))) && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert.ok(requests.some(input => input.messages?.some(message => Array.isArray(message.content) && message.content.some(part => part.type === 'image_url'))))
  report.checks.push('native file and image removal; image attachment reaches provider')
  await page.getByRole('button', { name: '工作区与文件预览', exact: true }).click()
  await page.locator('[data-rightbar-col]').getByText('preview.png', { exact: true }).waitFor()
  await page.locator('[data-rightbar-col]').getByText('preview.png', { exact: true }).dblclick()
  await page.waitForFunction(() => [...document.querySelectorAll('[data-rightbar-col] img')].some(image => image.complete && image.naturalWidth > 0))
  await checkShellGeometry(page)
  await checkAttachmentPicker(page)
  await page.getByRole('button', { name: '工作区与文件预览', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('[data-sandrone-frame]')?.getAttribute('data-rightbar-collapsed') === 'true')
  report.checks.push('single workspace control opens and closes native file pane')
  await page.getByRole('button', { name: '工作区与文件预览', exact: true }).click()
  await page.getByRole('button', { name: 'Open Sandrone Buddy', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('[data-sandrone-frame]')?.getAttribute('data-rightbar-collapsed') === 'true')
  await page.getByPlaceholder('和 Buddy 说点什么…').fill('buddy-qa')
  await page.getByRole('button', { name: '发送给 Buddy', exact: true }).click()
  await page.locator('.sandrone-buddy-message.buddy:not(.pending)').first().waitFor({ timeout: 15000 })
  await page.reload()
  await page.locator('[role="treeitem"]').filter({ hasText: 'SANDRONE_REPLY_OK' }).first().click()
  await page.getByRole('button', { name: 'Open Sandrone Buddy', exact: true }).click()
  await page.locator('.sandrone-buddy-message.buddy:not(.pending)').first().waitFor({ timeout: 15000 })
  assert.match(await page.locator('.sandrone-buddy-history').innerText(), /buddy-qa/)
  report.checks.push('main and companion history after reload')
  await page.getByRole('button', { name: '关闭 Buddy', exact: true }).click()
  await page.getByRole('button', { name: '切换夜间模式', exact: true }).click()
  await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-composer-card]')).backgroundColor === 'rgb(43, 41, 39)')
  await checkComposerTextAlignment(page)
  await page.screenshot({ path: join(temporary, 'dark.png') })
  await page.getByRole('button', { name: '切换白天模式', exact: true }).click()
  await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-composer-card]')).backgroundColor === 'rgb(255, 253, 250)')
  for (const width of [1280, 1440, 768, 390, 1920]) {
    await page.setViewportSize({ width, height: 900 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const geometry = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }))
    assert.equal(geometry.scroll, geometry.width)
    await checkShellGeometry(page)
    await checkSidebarCollapse(page)
    await checkComposerTextAlignment(page)
    await checkAttachmentPicker(page)
    await checkOpenInAppMenu(page)
    await page.locator('[data-sandrone-session-toolbar]').click({ position: { x: 5, y: 5 } })
    await page.mouse.move(2, 2)
    await page.screenshot({ path: join(temporary, `${width}.png`) })
    if (width === 1280) await page.locator('[data-sandrone-session-toolbar]').screenshot({ path: join(temporary, 'header.png') })
  }
  report.checks.push('responsive layout and reduced motion')
  assert.deepEqual(report.errors, [])
  report.passed = true
} catch (error) {
  report.passed = false
  report.failure = redact(error.message)
  process.exitCode = 1
  if (page && !page.isClosed()) {
    report.visibleText = await page.locator('body').innerText().catch(() => '')
    await page.screenshot({ path: join(temporary, 'failure.png') }).catch(() => {})
  }
} finally {
  await browser?.close()
  if (child.exitCode === null) {
    const ended = once(child, 'exit')
    if (child.connected) child.send({ type: 'shutdown' })
    const timer = setTimeout(() => child.kill(), 8000)
    await ended
    clearTimeout(timer)
  }
  mock.closeAllConnections()
  await new Promise(resolve => mock.close(resolve))
  await writeFile(join(temporary, 'report.json'), JSON.stringify(report, null, 2))
  await writeFile(join(temporary, 'mock-requests.json'), JSON.stringify(requests, null, 2))
  console.log(`[qa:upgrade] ${report.passed ? 'passed' : 'failed'}: ${join(temporary, 'report.json')}`)
  if (report.failure) console.error(report.failure)
}
