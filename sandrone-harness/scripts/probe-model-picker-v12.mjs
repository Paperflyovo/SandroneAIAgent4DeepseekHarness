// Probe v12: trace pointer events on the model trigger in the bottom layout,
// and dump the row DOM around it.
import { mkdtemp, realpath, readFile, rm, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)

function bundledPlaywrightCandidates() {
  const runtimeRoot = process.env.CODEX_RUNTIME_ROOT?.trim()
  const candidates = []
  const push = candidate => { if (candidate) candidates.push(candidate) }
  if (runtimeRoot) {
    push(join(runtimeRoot, 'dependencies', 'node', 'node_modules', 'playwright'))
    push(join(runtimeRoot, 'dependencies', 'node', 'node_modules', 'playwright-core'))
  }
  try {
    const { homedir } = require('node:os')
    push(join(homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'node', 'node_modules', 'playwright'))
  } catch {}
  return [...new Set(candidates)]
}

async function loadDriver() {
  for (const packageRoot of bundledPlaywrightCandidates()) {
    let loaded
    try { loaded = require(packageRoot) } catch { continue }
    if (!loaded?._electron) continue
    return { electron: loaded._electron, version: String(JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')).version ?? 'unknown') }
  }
  throw new Error('playwright electron driver not found')
}

const driver = await loadDriver()
const electronExecutable = await realpath(join(root, 'node_modules', 'electron', 'dist', 'electron.exe'))
const profileRoot = await mkdtemp(join(tmpdir(), 'sandrone-model-picker-'))
const workspaceDirectory = join(profileRoot, 'workspace-fixture')
await mkdir(workspaceDirectory, { recursive: true })
const launchEnvironment = {
  ...process.env,
  APPDATA: profileRoot,
  LOCALAPPDATA: profileRoot,
  TEMP: profileRoot,
  TMP: profileRoot,
  ELECTRON_USER_DATA_DIR: join(profileRoot, 'chromium'),
  SANDRONE_QA_PICK_DIRECTORY: workspaceDirectory,
}
delete launchEnvironment.ELECTRON_RUN_AS_NODE

const application = await driver.electron.launch({
  executablePath: electronExecutable,
  args: [`--user-data-dir=${join(profileRoot, 'chromium')}`, join(root, 'apps', 'desktop', 'main.cjs')],
  cwd: root,
  env: launchEnvironment,
  timeout: 60_000,
})
const window = await application.firstWindow({ timeout: 60_000 })

async function waitForHarness(timeoutMs = 300_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const status = await window.evaluate(() => window.sandroneDesktop?.getStatus()).catch(() => null)
    if (status?.phase === 'ready' && status?.url) return
    if (Date.now() > deadline) throw new Error('harness not ready')
    await new Promise(resolve => setTimeout(resolve, 1_000))
  }
}

async function dismissAllOnboarding() {
  for (let round = 0; round < 4; round++) {
    const dialog = window.getByRole('dialog').filter({ hasText: /添加一个 API Key|Add an API Key/i }).first()
    try {
      await dialog.waitFor({ state: 'visible', timeout: 4_000 })
      const later = dialog.getByRole('button', { name: /稍后配置|Configure later/i }).first()
      try { await later.click() } catch {}
      await dialog.waitFor({ state: 'hidden', timeout: 8_000 }).catch(() => {})
    } catch { break }
  }
  const notice = window.getByRole('dialog').filter({ hasText: /内测声明|Preview Notice/i }).first()
  try {
    await notice.waitFor({ state: 'visible', timeout: 4_000 })
    await notice.getByRole('button', { name: /继续|Continue/i }).click()
    await notice.waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {})
  } catch {}
}

try {
  await waitForHarness()
  await dismissAllOnboarding()
  await window.evaluate(() => {
    const b = [...document.querySelectorAll('button[aria-label="添加工作区"], button[aria-label="Add workspace"]')][0]
    b?.click()
  })
  await new Promise(resolve => setTimeout(resolve, 2000))
  await dismissAllOnboarding()
  const ns = window.getByRole('button', { name: /新建会话|新会话|New session/i }).first()
  try { await ns.click(); await new Promise(resolve => setTimeout(resolve, 1500)) } catch {}

  const textarea = window.locator('[data-sandrone-composer] textarea')
  await textarea.waitFor({ state: 'visible', timeout: 15_000 })
  await textarea.click()
  await textarea.fill('hello')
  await window.keyboard.press('Enter')
  await new Promise(resolve => setTimeout(resolve, 9000))

  // Install capture-phase listeners on the trigger and ancestors, then real-click.
  const trace = await window.evaluate(() => {
    const b = [...document.querySelectorAll('button[aria-haspopup="menu"]')].find(x => /_7KE1Ra_trigger/.test(x.className))
    if (!b) return { found: false }
    const log = []
    const types = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'focus', 'pointerover', 'pointerenter']
    for (const t of types) {
      b.addEventListener(t, e => log.push(`${t}@button`), true)
      b.parentElement?.addEventListener(t, e => log.push(`${t}@parent`), true)
    }
    window.__evLog = log
    const s = getComputedStyle(b)
    const r = b.getBoundingClientRect()
    const chain = []
    let n = b
    for (let d = 0; n && d < 8; d++, n = n.parentElement) {
      const cs = getComputedStyle(n)
      const nr = n.getBoundingClientRect()
      chain.push({
        d, tag: n.tagName, cls: String(n.className).slice(0, 50),
        pe: cs.pointerEvents, appRegion: cs.webkitAppRegion || cs.getPropertyValue('-webkit-app-region'),
        z: cs.zIndex, rect: [Math.round(nr.x), Math.round(nr.y), Math.round(nr.width), Math.round(nr.height)],
      })
    }
    return {
      found: true,
      trigger: { pointer: s.pointerEvents, region: s.webkitAppRegion || s.getPropertyValue('-webkit-app-region'), rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] },
      chain,
      cx: r.x + r.width / 2, cy: r.y + r.height / 2,
    }
  })
  console.log('TRACE-SETUP:', JSON.stringify(trace, null, 2))
  if (!trace.found) throw new Error('no trigger')

  await window.mouse.click(trace.cx, trace.cy)
  await new Promise(resolve => setTimeout(resolve, 500))
  const result = await window.evaluate(() => {
    const b = [...document.querySelectorAll('button[aria-haspopup="menu"]')].find(x => /_7KE1Ra_trigger/.test(x.className))
    const menu = [...document.querySelectorAll('*')].find(el => /_7KE1Ra_menu/.test(String(el.className || '')) && getComputedStyle(el).display !== 'none')
    return { log: window.__evLog, expanded: b ? b.getAttribute('aria-expanded') : null, menu: !!menu }
  })
  console.log('EVENT-LOG:', JSON.stringify(result, null, 2))

  // Which element does the browser think is at that point DURING dispatch?
  // (elementFromPoint is a proxy; also try dispatchEvent on the button directly)
  const direct = await window.evaluate(() => {
    const b = [...document.querySelectorAll('button[aria-haspopup="menu"]')].find(x => /_7KE1Ra_trigger/.test(x.className))
    if (!b) return 'no-trigger'
    const log = []
    for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      b.addEventListener(t, () => log.push(t), true)
    }
    const opts = { bubbles: true, cancelable: true, view: window }
    for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      b.dispatchEvent(new (t.startsWith('pointer') ? PointerEvent : MouseEvent)(t, opts))
    }
    return { log, expanded: b.getAttribute('aria-expanded') }
  })
  console.log('DIRECT-DISPATCH:', JSON.stringify(direct))
} finally {
  await application.close().catch(() => {})
  await rm(profileRoot, { recursive: true, force: true }).catch(() => {})
}
