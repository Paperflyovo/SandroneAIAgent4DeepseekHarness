// Probe v13: window-level capture trace — where do real pointer events go?
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

  const setup = await window.evaluate(() => {
    const log = []
    for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      window.addEventListener(t, e => log.push(`${t}->${e.target.tagName}.${String(e.target.className).slice(0, 40)}`), true)
    }
    window.__evLog = log
    const b = [...document.querySelectorAll('button[aria-haspopup="menu"]')].find(x => /_7KE1Ra_trigger/.test(x.className))
    const r = b.getBoundingClientRect()
    return {
      cx: r.x + r.width / 2, cy: r.y + r.height / 2,
      pointerLock: document.pointerLockElement ? String(document.pointerLockElement.className).slice(0, 40) : null,
      activeElement: document.activeElement ? `${document.activeElement.tagName}.${String(document.activeElement.className).slice(0, 40)}` : null,
      hasFocus: document.hasFocus(),
    }
  })
  console.log('SETUP:', JSON.stringify(setup))

  await window.mouse.click(setup.cx, setup.cy)
  await new Promise(resolve => setTimeout(resolve, 400))
  console.log('EVENT-LOG:', JSON.stringify(await window.evaluate(() => ({
    log: window.__evLog,
    expanded: (() => {
      const b = [...document.querySelectorAll('button[aria-haspopup="menu"]')].find(x => /_7KE1Ra_trigger/.test(x.className))
      return b ? b.getAttribute('aria-expanded') : null
    })(),
  })), null, 2))

  // Also click somewhere neutral (the conversation area) and see the target.
  await window.evaluate(() => { window.__evLog.length = 0 })
  await window.mouse.click(600, 300)
  await new Promise(resolve => setTimeout(resolve, 300))
  console.log('NEUTRAL-CLICK-LOG:', JSON.stringify(await window.evaluate(() => window.__evLog)))
} finally {
  await application.close().catch(() => {})
  await rm(profileRoot, { recursive: true, force: true }).catch(() => {})
}
