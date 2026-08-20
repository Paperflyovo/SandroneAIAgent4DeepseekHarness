// Probe v8: real user state — session composer at window bottom, effort
// sub-menu, short window — using REAL mouse clicks so occlusion matters.
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

async function dismissDialogs() {
  for (const [label, buttons] of [
    [/添加一个 API Key|Add an API Key/i, [/稍后配置|Configure later/i]],
    [/内测声明|Preview Notice/i, [/继续|Continue/i]],
  ]) {
    const dialog = window.getByRole('dialog').filter({ hasText: label }).first()
    try {
      await dialog.waitFor({ state: 'visible', timeout: 6_000 })
      for (const btn of buttons) {
        const b = dialog.getByRole('button', { name: btn }).first()
        try { await b.click(); break } catch {}
      }
      await dialog.waitFor({ state: 'hidden', timeout: 20_000 }).catch(() => {})
    } catch {}
  }
}

async function menuDump(tag) {
  const dump = await window.evaluate(() => {
    const menu = [...document.querySelectorAll('*')].find(el => /_7KE1Ra_menu/.test(String(el.className || '')) && getComputedStyle(el).display !== 'none')
    if (!menu) return { opened: false }
    const rect = menu.getBoundingClientRect()
    const options = [...menu.querySelectorAll('button')].map(b => {
      const r = b.getBoundingClientRect()
      const s = getComputedStyle(b)
      return {
        text: (b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
        rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
        color: s.color, bg: s.backgroundColor, font: s.fontSize, radius: s.borderRadius,
      }
    })
    return {
      opened: true,
      viewport: [innerWidth, innerHeight],
      rect: [Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)],
      inside: rect.x >= 0 && rect.y >= 0 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1,
      underTitlebar: rect.y < 38,
      titlebarCover: rect.y < 38 ? Math.round(38 - rect.y) : 0,
      text: (menu.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 100),
      options,
    }
  })
  console.log(`MENU[${tag}]:`, JSON.stringify(dump, null, 2))
  return dump
}

async function realClickTrigger() {
  const info = await window.evaluate(() => {
    const b = [...document.querySelectorAll('button[aria-haspopup="menu"]')].find(x => /_7KE1Ra_trigger/.test(x.className))
    if (!b) return null
    const r = b.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })
  if (!info) { console.log('NO MODEL TRIGGER'); return false }
  await window.mouse.click(info.x, info.y)
  await new Promise(resolve => setTimeout(resolve, 400))
  return true
}

try {
  await waitForHarness()
  await dismissDialogs()

  await window.evaluate(() => {
    const b = [...document.querySelectorAll('button[aria-label="添加工作区"], button[aria-label="Add workspace"]')][0]
    b?.click()
  })
  await new Promise(resolve => setTimeout(resolve, 2000))
  const ns = window.getByRole('button', { name: /新建会话|新会话|New session/i }).first()
  try {
    await ns.click()
    await new Promise(resolve => setTimeout(resolve, 1500))
  } catch (error) {
    console.log('NEW-SESSION-FAILED:', String(error).slice(0, 150))
  }

  // 1) Session state, real mouse click.
  console.log('--- 1) session composer, real click ---')
  await realClickTrigger()
  await menuDump('session-root')

  // 2) Click the effort cell (推理等级) to open the sub-menu.
  const effortClicked = await window.evaluate(() => {
    const menu = [...document.querySelectorAll('*')].find(el => /_7KE1Ra_menu/.test(String(el.className || '')) && getComputedStyle(el).display !== 'none')
    const cell = menu && [...menu.querySelectorAll('button')].find(b => /推理|effort|Reasoning/i.test(b.textContent || ''))
    if (!cell) return false
    const r = cell.getBoundingClientRect()
    window.__cellRect = { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    return true
  })
  if (effortClicked) {
    const { x, y } = await window.evaluate(() => window.__cellRect)
    await window.mouse.click(x, y)
    await new Promise(resolve => setTimeout(resolve, 400))
    console.log('--- 2) effort sub-menu ---')
    await menuDump('session-effort')
  } else {
    console.log('--- 2) no effort cell found ---')
  }

  // Close the menu (Escape).
  await window.keyboard.press('Escape').catch(() => {})
  await new Promise(resolve => setTimeout(resolve, 300))

  // 3) Shrink the window and retry.
  await application.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.setSize(900, 560)
  })
  await new Promise(resolve => setTimeout(resolve, 1200))
  console.log('--- 3) short window 900x560 ---')
  await realClickTrigger()
  await menuDump('short-window')
} finally {
  await application.close().catch(() => {})
  await rm(profileRoot, { recursive: true, force: true }).catch(() => {})
}
