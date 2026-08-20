// Quick verification after the buddy refactor:
//  1) Buddy lives inside the composer row (no more floating card).
//  2) Real-mouse click opens the model picker in the bottom-composer layout.
//  3) Menu option text uses the official dark color, not sandrone-muted.
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
const screenshotRoot = join(root, 'runtime', 'tmp', 'composer-audit')
await mkdir(workspaceDirectory, { recursive: true })
await mkdir(screenshotRoot, { recursive: true })
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
  await dismissAllOnboarding()

  // 1) Buddy placement: no floating card at bottom-right; a trigger in the row.
  const buddyCheck = await window.evaluate(() => {
    const floating = [...document.querySelectorAll('.sandrone-buddy, .sandrone-buddy-launcher')]
      .filter(el => {
        const s = getComputedStyle(el)
        return s.display !== 'none' && (s.position === 'fixed' || (s.position === 'absolute' && (s.bottom !== 'auto')))
      })
    const trigger = document.querySelector('[data-composer-card] .sandrone-buddy-trigger')
    const tr = trigger ? trigger.getBoundingClientRect() : null
    return {
      floatingCards: floating.map(el => String(el.className).slice(0, 40)),
      triggerInCard: !!trigger,
      triggerRect: tr ? [Math.round(tr.x), Math.round(tr.y), Math.round(tr.width), Math.round(tr.height)] : null,
      buddyAside: !!document.querySelector('.sandrone-buddy'),
    }
  })
  console.log('BUDDY-CHECK:', JSON.stringify(buddyCheck, null, 2))
  console.log('LAYOUT-CHECK:', JSON.stringify(await window.evaluate(() => {
    const describe = element => {
      if (!element) return null
      const rect = element.getBoundingClientRect()
      return {
        rect: [Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)],
        scrollTop: element.scrollTop,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        overflowY: getComputedStyle(element).overflowY,
      }
    }
    const scroll = document.querySelector('[data-conversation-scroll]')
    const flows = [...document.querySelectorAll('[data-chat-flow-kind]')]
    return {
      viewport: [innerWidth, innerHeight],
      topbar: describe(document.querySelector('[data-sandrone-topbar]')),
      conversation: describe(document.querySelector('[data-sandrone-center] [data-slot="conversation"]')),
      scroll: describe(scroll),
      firstFlow: describe(flows[0]),
      lastFlow: describe(flows.at(-1)),
      body: describe(document.body),
    }
  }), null, 2))
  await window.screenshot({ path: join(screenshotRoot, 'composer.png'), fullPage: false })

  // 2) Real-mouse click on the model trigger.
  const info = await window.evaluate(() => {
    const b = document.querySelector('[data-sandrone-model-picker] .sandrone-model-trigger')
      || [...document.querySelectorAll('button[aria-haspopup="menu"]')].find(x => /_7KE1Ra_trigger/.test(x.className))
    if (!b) return null
    const r = b.getBoundingClientRect()
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
    return {
      x: r.x + r.width / 2, y: r.y + r.height / 2,
      occluder: hit && !b.contains(hit) ? `${hit.tagName}.${String(hit.className).slice(0, 40)}` : null,
    }
  })
  console.log('CLICK-INFO:', JSON.stringify(info))
  if (!info) throw new Error('no model trigger')
  await window.mouse.click(info.x, info.y)
  await new Promise(resolve => setTimeout(resolve, 450))

  const menu = await window.evaluate(() => {
    const m = document.querySelector('.sandrone-model-menu')
      || [...document.querySelectorAll('*')].find(el => /_7KE1Ra_menu/.test(String(el.className || '')) && getComputedStyle(el).display !== 'none')
    if (!m) return { opened: false }
    const r = m.getBoundingClientRect()
    return {
      opened: true,
      rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      inside: r.x >= 0 && r.y >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1,
      options: [...m.querySelectorAll('button')].map(b => ({
        text: (b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30),
        color: getComputedStyle(b).color,
      })),
    }
  })
  console.log('MENU:', JSON.stringify(menu, null, 2))

  const pass = buddyCheck.triggerInCard && !buddyCheck.floatingCards.length && menu.opened && menu.inside
  const colorsOk = menu.opened && menu.options.every(o => o.color !== 'rgb(112, 106, 99)')
  console.log('PASS:', pass, '| COLORS-OK:', colorsOk)
} finally {
  await application.close().catch(() => {})
  await rm(profileRoot, { recursive: true, force: true }).catch(() => {})
}
