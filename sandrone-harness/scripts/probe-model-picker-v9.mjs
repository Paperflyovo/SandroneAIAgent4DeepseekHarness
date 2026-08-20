// Probe v9: short-window case — dump trigger rect, occluder, click, poll.
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

try {
  await waitForHarness()
  const onboarding = window.getByRole('dialog').filter({ hasText: /添加一个 API Key|Add an API Key/i }).first()
  try {
    await onboarding.waitFor({ state: 'visible', timeout: 10_000 })
    await onboarding.getByRole('button', { name: /稍后配置|Configure later/i }).click()
    await onboarding.waitFor({ state: 'hidden', timeout: 30_000 }).catch(() => {})
  } catch {}
  const notice = window.getByRole('dialog').filter({ hasText: /内测声明|Preview Notice/i }).first()
  try {
    await notice.waitFor({ state: 'visible', timeout: 5_000 })
    await notice.getByRole('button', { name: /继续|Continue/i }).click()
    await notice.waitFor({ state: 'hidden', timeout: 30_000 }).catch(() => {})
  } catch {}

  await window.evaluate(() => {
    const b = [...document.querySelectorAll('button[aria-label="添加工作区"], button[aria-label="Add workspace"]')][0]
    b?.click()
  })
  await new Promise(resolve => setTimeout(resolve, 2000))
  const ns = window.getByRole('button', { name: /新建会话|新会话|New session/i }).first()
  try { await ns.click(); await new Promise(resolve => setTimeout(resolve, 1500)) } catch {}

  // Shrink window.
  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setSize(900, 560)
  })
  await new Promise(resolve => setTimeout(resolve, 1500))

  const pre = await window.evaluate(() => {
    const b = [...document.querySelectorAll('button[aria-haspopup="menu"]')].find(x => /_7KE1Ra_trigger/.test(x.className))
    if (!b) return { found: false }
    const r = b.getBoundingClientRect()
    const cx = r.x + r.width / 2, cy = r.y + r.height / 2
    const hit = document.elementFromPoint(cx, cy)
    const card = b.closest('[data-composer-card]')?.getBoundingClientRect()
    const seat = b.closest('[data-composer-seat]')?.getBoundingClientRect()
    return {
      found: true,
      viewport: [innerWidth, innerHeight],
      trigger: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      center: [Math.round(cx), Math.round(cy)],
      visible: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth,
      occluder: hit && !b.contains(hit) ? { cls: String(hit.className).slice(0, 50), tag: hit.tagName, inTitlebar: !!hit.closest('[data-sandrone-topbar]') } : null,
      card: card ? [Math.round(card.x), Math.round(card.y), Math.round(card.width), Math.round(card.height)] : null,
      seat: seat ? [Math.round(seat.x), Math.round(seat.y), Math.round(seat.width), Math.round(seat.height)] : null,
    }
  })
  console.log('PRE-SHORT:', JSON.stringify(pre, null, 2))

  if (pre.found && pre.visible) {
    await window.mouse.click(pre.center[0], pre.center[1])
    const ticks = []
    for (let i = 0; i < 10; i++) {
      await new Promise(resolve => setTimeout(resolve, 150))
      ticks.push(await window.evaluate(() => {
        const trigger = [...document.querySelectorAll('button[aria-haspopup="menu"]')].find(x => /_7KE1Ra_trigger/.test(x.className))
        const menu = [...document.querySelectorAll('*')].find(el => /_7KE1Ra_menu/.test(String(el.className || '')) && getComputedStyle(el).display !== 'none')
        return {
          expanded: trigger ? trigger.getAttribute('aria-expanded') : null,
          menu: menu ? (() => { const r = menu.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] })() : null,
        }
      }))
    }
    console.log('TICKS-SHORT:', JSON.stringify(ticks, null, 2))
  }

  // Also try element.click() to separate click-delivery from state logic.
  const synthetic = await window.evaluate(() => {
    const b = [...document.querySelectorAll('button[aria-haspopup="menu"]')].find(x => /_7KE1Ra_trigger/.test(x.className))
    if (!b) return 'no-trigger'
    b.click()
    return 'clicked'
  })
  console.log('SYNTHETIC:', synthetic)
  await new Promise(resolve => setTimeout(resolve, 500))
  console.log('AFTER-SYNTHETIC:', JSON.stringify(await window.evaluate(() => {
    const trigger = [...document.querySelectorAll('button[aria-haspopup="menu"]')].find(x => /_7KE1Ra_trigger/.test(x.className))
    const menu = [...document.querySelectorAll('*')].find(el => /_7KE1Ra_menu/.test(String(el.className || '')) && getComputedStyle(el).display !== 'none')
    return { expanded: trigger ? trigger.getAttribute('aria-expanded') : null, menu: !!menu }
  })))
} finally {
  await application.close().catch(() => {})
  await rm(profileRoot, { recursive: true, force: true }).catch(() => {})
}
