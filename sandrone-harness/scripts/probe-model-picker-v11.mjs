// Probe v11: real conversation layout — composer pinned at window bottom,
// messages above. Send a message (fails without key, but layout changes),
// then open the model picker and dump geometry.
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
  // The API-key modal may reappear after the workspace flow; dismiss repeatedly.
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

  // Type into the composer and press Enter to create a conversation.
  const textarea = window.locator('[data-sandrone-composer] textarea')
  await textarea.waitFor({ state: 'visible', timeout: 15_000 })
  await textarea.click()
  await textarea.fill('hello')
  await window.keyboard.press('Enter')
  await new Promise(resolve => setTimeout(resolve, 2500))

  const layout = await window.evaluate(() => {
    const seat = document.querySelector('[data-composer-seat]')
    const card = document.querySelector('[data-composer-card]')
    const trigger = [...document.querySelectorAll('button[aria-haspopup="menu"]')].find(x => /_7KE1Ra_trigger/.test(x.className))
    const rect = el => { if (!el) return null; const r = el.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] }
    return {
      viewport: [innerWidth, innerHeight],
      seat: rect(seat),
      card: rect(card),
      trigger: rect(trigger),
      messages: [...document.querySelectorAll('[data-conversation-scroll] [class*="message"], [data-conversation-scroll] [class*="node"]')].length,
      dialogs: [...document.querySelectorAll('[role="dialog"]')].filter(d => getComputedStyle(d).display !== 'none').map(d => (d.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60)),
    }
  })
  console.log('LAYOUT:', JSON.stringify(layout, null, 2))

  // Dismiss any dialogs that block, wait for the send to settle, re-check.
  await dismissAllOnboarding()
  await new Promise(resolve => setTimeout(resolve, 8000))
  const state = await window.evaluate(() => {
    const b = [...document.querySelectorAll('button[aria-haspopup="menu"]')].find(x => /_7KE1Ra_trigger/.test(x.className))
    return {
      disabled: b ? b.disabled : null,
      expanded: b ? b.getAttribute('aria-expanded') : null,
      dialogs: [...document.querySelectorAll('[role="dialog"]')].filter(d => getComputedStyle(d).display !== 'none').map(d => (d.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80)),
      composerText: (document.querySelector('[data-sandrone-composer] textarea')?.value || '').slice(0, 60),
    }
  })
  console.log('SETTLED-STATE:', JSON.stringify(state, null, 2))
  const clickInfo = await window.evaluate(() => {
    const b = [...document.querySelectorAll('button[aria-haspopup="menu"]')].find(x => /_7KE1Ra_trigger/.test(x.className))
    if (!b) return null
    const r = b.getBoundingClientRect()
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, occluder: hit && !b.contains(hit) ? String(hit.className).slice(0, 40) : null, disabled: b.disabled }
  })
  console.log('CLICK-INFO:', JSON.stringify(clickInfo))
  if (clickInfo) {
    await window.mouse.click(clickInfo.x, clickInfo.y)
    for (let i = 0; i < 6; i++) {
      await new Promise(resolve => setTimeout(resolve, 150))
      const t = await window.evaluate(() => {
        const b = [...document.querySelectorAll('button[aria-haspopup="menu"]')].find(x => /_7KE1Ra_trigger/.test(x.className))
        const menu = [...document.querySelectorAll('*')].find(el => /_7KE1Ra_menu/.test(String(el.className || '')) && getComputedStyle(el).display !== 'none')
        return { expanded: b ? b.getAttribute('aria-expanded') : null, menu: !!menu }
      })
      console.log('  tick', i, JSON.stringify(t))
    }
  }
  const dump = await window.evaluate(() => {
    const menu = [...document.querySelectorAll('*')].find(el => /_7KE1Ra_menu/.test(String(el.className || '')) && getComputedStyle(el).display !== 'none')
    if (!menu) return { opened: false }
    const rect = menu.getBoundingClientRect()
    return {
      opened: true,
      viewport: [innerWidth, innerHeight],
      rect: [Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)],
      inside: rect.x >= 0 && rect.y >= 0 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1,
      underTitlebar: rect.y < 38,
      titlebarCoverPx: rect.y < 38 ? Math.round(38 - rect.y) : 0,
      options: [...menu.querySelectorAll('button')].map(b => {
        const r = b.getBoundingClientRect()
        const s = getComputedStyle(b)
        return { text: (b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40), color: s.color, rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] }
      }),
    }
  })
  console.log('MENU:', JSON.stringify(dump, null, 2))

  // Synthetic click comparison.
  const synth = await window.evaluate(() => {
    const b = [...document.querySelectorAll('button[aria-haspopup="menu"]')].find(x => /_7KE1Ra_trigger/.test(x.className))
    if (!b) return 'no-trigger'
    b.click()
    return 'clicked'
  })
  console.log('SYNTHETIC:', synth)
  await new Promise(resolve => setTimeout(resolve, 400))
  console.log('AFTER-SYNTH:', JSON.stringify(await window.evaluate(() => {
    const b = [...document.querySelectorAll('button[aria-haspopup="menu"]')].find(x => /_7KE1Ra_trigger/.test(x.className))
    const menu = [...document.querySelectorAll('*')].find(el => /_7KE1Ra_menu/.test(String(el.className || '')) && getComputedStyle(el).display !== 'none')
    return { expanded: b ? b.getAttribute('aria-expanded') : null, menu: menu ? (() => { const r = menu.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] })() : null }
  })))
} finally {
  await application.close().catch(() => {})
  await rm(profileRoot, { recursive: true, force: true }).catch(() => {})
}
