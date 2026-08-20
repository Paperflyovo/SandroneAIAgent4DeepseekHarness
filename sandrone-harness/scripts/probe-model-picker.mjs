// One-off probe: open the composer's model picker dropdown and dump its
// geometry, ancestor chain and occlusion so "inputbox选择模型的时候下拉框有问题"
// can be diagnosed from evidence instead of eyeballing.
import { mkdtemp, realpath, readFile, rm, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const profileRoot = await mkdtemp(join(tmpdir(), 'sandrone-model-picker-'))
const workspaceDirectory = join(profileRoot, 'workspace-fixture')
await mkdir(workspaceDirectory, { recursive: true })

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

  const composer = window.locator('[data-sandrone-composer] [data-composer-card]')
  await composer.waitFor({ state: 'visible', timeout: 30_000 })

  // The composer starts blocked on workspace selection; adopt a fixture
  // workspace through the native-picker flow, then create a session so the
  // composer gains its model trigger.
  const workspaceClick = await window.evaluate(() => {
    const b = [...document.querySelectorAll('button[aria-label="添加工作区"], button[aria-label="Add workspace"]')][0]
    if (!b) return 'no-button'
    const r = b.getBoundingClientRect()
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
    const occluder = hit && !b.contains(hit) ? { cls: String(hit.className).slice(0, 60), tag: hit.tagName } : null
    b.click()
    return { occluder, rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] }
  })
  console.log('WORKSPACE-CLICK:', JSON.stringify(workspaceClick))
  try {
    const workspaceTitle = window.getByText('workspace-fixture', { exact: true }).first()
    await workspaceTitle.waitFor({ state: 'visible', timeout: 30_000 })
  } catch (error) {
    console.log('WORKSPACE-TITLE-FAILED:', String(error).slice(0, 200))
  }
  const newSession = window.getByRole('button', { name: /新建会话|新会话|New session/i }).first()
  try {
    await newSession.click()
    await new Promise(resolve => setTimeout(resolve, 1500))
  } catch (error) {
    console.log('NEW-SESSION-CLICK-FAILED:', String(error).slice(0, 200))
  }
  const post = await window.evaluate(() => {
    const placeholder = document.querySelector('[data-sandrone-composer] textarea')?.placeholder || null
    const sessionRows = [...document.querySelectorAll('[data-sandrone-sidebar] [role="treeitem"], [data-sandrone-sidebar] [class*="session"]')].length
    const menuTriggers = [...document.querySelectorAll('button[aria-haspopup="menu"]')].map(b => (b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40))
    return { placeholder, sessionRows, menuTriggers }
  })
  console.log('POST-SESSION:', JSON.stringify(post, null, 2))

  // First: is a model trigger rendered at all (any aria-haspopup=menu button)?
  const pre = await window.evaluate(() => {
    const triggers = [...document.querySelectorAll('button[aria-haspopup="menu"]')].map(b => {
      const r = b.getBoundingClientRect()
      return {
        cls: String(b.className).slice(0, 60),
        text: (b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
        expanded: b.getAttribute('aria-expanded'),
        rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
        inComposer: !!b.closest('[data-sandrone-composer]'),
      }
    })
    const seatEls = [...document.querySelectorAll('[data-composer-seat], [data-sandrone-composer]')].map(el => {
      const r = el.getBoundingClientRect()
      return { cls: String(el.className).slice(0, 60), rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] }
    })
    return { triggers, seatEls, composerCard: (() => { const c = document.querySelector('[data-composer-card]'); if (!c) return null; const r = c.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] })() }
  })
  console.log('PRE:', JSON.stringify(pre, null, 2))

  // Click the model trigger (fall back to clicking where it should be).
  const clicked = await window.evaluate(() => {
    const b = [...document.querySelectorAll('button[aria-haspopup="menu"]')].find(x => /_7KE1Ra_trigger/.test(x.className)) || [...document.querySelectorAll('button[aria-haspopup="menu"]')][0]
    if (!b) return false
    const r = b.getBoundingClientRect()
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
    const occluder = hit && !b.contains(hit) ? { cls: String(hit.className).slice(0, 60), tag: hit.tagName } : null
    b.click()
    window.__probeTriggerInfo = { occluder, disabled: b.disabled, cls: String(b.className) }
    return true
  })
  console.log('CLICKED:', clicked)
  const ticks = []
  for (let i = 0; i < 14; i++) {
    await new Promise(resolve => setTimeout(resolve, 150))
    const tick = await window.evaluate(() => {
      const trigger = document.querySelector('button[aria-haspopup="menu"]')
      const expanded = trigger ? trigger.getAttribute('aria-expanded') : null
      const menu = [...document.querySelectorAll('*')].find(el => /_7KE1Ra_menu/.test(String(el.className || '')) && getComputedStyle(el).display !== 'none')
      return { expanded, menu: !!menu, triggerInfo: window.__probeTriggerInfo || null }
    })
    ticks.push(tick)
  }
  console.log('TICKS:', JSON.stringify(ticks, null, 2))

  const dump = await window.evaluate(() => {
    const vw = innerWidth, vh = innerHeight
    const menu = [...document.querySelectorAll('*')].find(el => {
      const c = String(el.className || '')
      return /_7KE1Ra_menu/.test(c) && getComputedStyle(el).display !== 'none'
    })
    if (!menu) return { viewport: [vw, vh], opened: false }
    const rect = menu.getBoundingClientRect()
    const style = getComputedStyle(menu)
    const chain = []
    let node = menu
    for (let depth = 0; node && depth < 14; depth++, node = node.parentElement) {
      const s = getComputedStyle(node)
      const r = node.getBoundingClientRect()
      chain.push({
        depth,
        tag: node.tagName,
        cls: String(node.className).slice(0, 70),
        role: node.getAttribute('role'),
        pos: s.position,
        z: s.zIndex,
        ox: s.overflowX, oy: s.overflowY,
        transform: s.transform !== 'none' ? s.transform : '',
        rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      })
    }
    const pts = {
      center: [rect.x + rect.width / 2, rect.y + rect.height / 2],
      topLeft: [rect.x + 4, rect.y + 4],
      topRight: [rect.x + rect.width - 4, rect.y + 4],
      bottomLeft: [rect.x + 4, rect.y + rect.height - 4],
      bottomRight: [rect.x + rect.width - 4, rect.y + rect.height - 4],
    }
    const occlusion = {}
    for (const [name, [px, py]] of Object.entries(pts)) {
      const el = document.elementFromPoint(px, py)
      occlusion[name] = el ? {
        cls: String(el.className).slice(0, 60),
        tag: el.tagName,
        inMenu: menu.contains(el),
        text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30),
      } : null
    }
    return {
      viewport: [vw, vh],
      opened: true,
      menuCls: String(menu.className).slice(0, 80),
      menuRole: menu.getAttribute('role'),
      menuText: (menu.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120),
      rect: [Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)],
      insideViewport: rect.x >= 0 && rect.y >= 0 && rect.right <= vw + 1 && rect.bottom <= vh + 1,
      style: { pos: style.position, z: style.zIndex, display: style.display, visibility: style.visibility, opacity: style.opacity, overflow: style.overflow },
      chain,
      occlusion,
    }
  })
  console.log('DUMP:', JSON.stringify(dump, null, 2))
} finally {
  await application.close().catch(() => {})
  await rm(profileRoot, { recursive: true, force: true }).catch(() => {})
}
