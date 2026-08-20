// Probe the INSTALLED SandroneAIAgent.exe (the build the user actually runs):
// workspace -> session -> model picker dropdown geometry/occlusion/behavior.
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

const INSTALLED_EXE = 'E:\\Sandrone4Deepseek\\SandroneAIAgent\\SandroneAIAgent.exe'
const driver = await loadDriver()
const profileRoot = await mkdtemp(join(tmpdir(), 'sandrone-installed-probe-'))
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

console.log('launching installed exe...')
const application = await driver.electron.launch({
  executablePath: INSTALLED_EXE,
  args: [`--user-data-dir=${join(profileRoot, 'chromium')}`],
  cwd: profileRoot,
  env: launchEnvironment,
  timeout: 90_000,
})
const window = await application.firstWindow({ timeout: 90_000 })
console.log('window ok, title:', await window.title())

async function waitForHarness(timeoutMs = 300_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const status = await window.evaluate(() => window.sandroneDesktop?.getStatus()).catch(() => null)
    if (status?.phase === 'ready' && status?.url) return status
    if (Date.now() > deadline) throw new Error('harness not ready')
    await new Promise(resolve => setTimeout(resolve, 1_000))
  }
}

try {
  const status = await waitForHarness()
  console.log('STATUS:', JSON.stringify(status))

  // Skip onboarding / notice dialogs if present.
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

  // Adopt the fixture workspace (synthetic click; real click may be masked).
  const ws = await window.evaluate(() => {
    const b = [...document.querySelectorAll('button[aria-label="添加工作区"], button[aria-label="Add workspace"]')][0]
    if (!b) return 'no-button'
    b.click()
    return 'clicked'
  })
  console.log('WORKSPACE:', ws)
  await new Promise(resolve => setTimeout(resolve, 2500))

  // Create a session.
  const ns = window.getByRole('button', { name: /新建会话|新会话|New session/i }).first()
  try {
    await ns.click()
    await new Promise(resolve => setTimeout(resolve, 1500))
  } catch (error) {
    console.log('NEW-SESSION-FAILED:', String(error).slice(0, 150))
  }

  const pre = await window.evaluate(() => {
    const triggers = [...document.querySelectorAll('button[aria-haspopup="menu"]')].map(b => {
      const r = b.getBoundingClientRect()
      return {
        cls: String(b.className).slice(0, 50),
        text: (b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 50),
        rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
        disabled: b.disabled,
      }
    })
    return { viewport: [innerWidth, innerHeight], triggers }
  })
  console.log('PRE:', JSON.stringify(pre, null, 2))

  // Click the model trigger (the one that is not workspace/mode).
  const click = await window.evaluate(() => {
    const all = [...document.querySelectorAll('button[aria-haspopup="menu"]')]
    const model = all.find(b => /_7KE1Ra_trigger/.test(b.className)) || all[2]
    if (!model) return 'no-trigger'
    const r = model.getBoundingClientRect()
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
    model.click()
    return {
      cls: String(model.className).slice(0, 50),
      text: (model.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 50),
      occluder: hit && !model.contains(hit) ? { cls: String(hit.className).slice(0, 50), tag: hit.tagName } : null,
    }
  })
  console.log('CLICK:', JSON.stringify(click))

  const ticks = []
  for (let i = 0; i < 8; i++) {
    await new Promise(resolve => setTimeout(resolve, 150))
    ticks.push(await window.evaluate(() => {
      const menu = [...document.querySelectorAll('*')].find(el => {
        const c = String(el.className || '')
        return /menu/.test(c) && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 50
      })
      if (!menu) return { menu: false }
      const r = menu.getBoundingClientRect()
      return {
        menu: true,
        cls: String(menu.className).slice(0, 60),
        rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
        inside: r.x >= 0 && r.y >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1,
        text: (menu.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
      }
    }))
  }
  console.log('TICKS:', JSON.stringify(ticks, null, 2))

  // If a menu is open, dump full chain + occlusion.
  const dump = await window.evaluate(() => {
    const menu = [...document.querySelectorAll('*')].find(el => {
      const c = String(el.className || '')
      return /menu/.test(c) && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 50
    })
    if (!menu) return { opened: false }
    const rect = menu.getBoundingClientRect()
    const chain = []
    let node = menu
    for (let depth = 0; node && depth < 12; depth++, node = node.parentElement) {
      const s = getComputedStyle(node)
      const r = node.getBoundingClientRect()
      chain.push({
        depth, tag: node.tagName,
        cls: String(node.className).slice(0, 60),
        pos: s.position, z: s.zIndex,
        ox: s.overflowX, oy: s.overflowY,
        rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      })
    }
    return {
      opened: true,
      viewport: [innerWidth, innerHeight],
      menuCls: String(menu.className).slice(0, 70),
      rect: [Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)],
      insideViewport: rect.x >= 0 && rect.y >= 0 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1,
      style: { pos: getComputedStyle(menu).position, z: getComputedStyle(menu).zIndex, overflow: getComputedStyle(menu).overflow },
      chain,
    }
  })
  console.log('DUMP:', JSON.stringify(dump, null, 2))
} finally {
  await application.close().catch(() => {})
  await rm(profileRoot, { recursive: true, force: true }).catch(() => {})
}
