// Verify the Sandrone model picker: own trigger in the composer row, menu
// opens with real mouse clicks, model list pane readable (dark text, proper
// background), nothing covers it.
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
const errors = []
window.on('console', msg => {
  if (msg.type() === 'error') errors.push(msg.text().slice(0, 400))
})
window.on('pageerror', err => errors.push(`PAGEERROR: ${String(err).slice(0, 400)}`))

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

async function clickAt(selector) {
  const info = await window.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const r = el.getBoundingClientRect()
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
    return {
      x: r.x + r.width / 2, y: r.y + r.height / 2,
      occluder: hit && !el.contains(hit) ? `${hit.tagName}.${String(hit.className).slice(0, 40)}` : null,
    }
  }, selector)
  if (!info) return false
  await window.mouse.click(info.x, info.y)
  await new Promise(resolve => setTimeout(resolve, 450))
  return true
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

  // 1) Own trigger present, official one gone.
  const seat = await window.evaluate(() => ({
    own: !!document.querySelector('[data-sandrone-model-picker] .sandrone-model-trigger'),
    official: !!document.querySelector('._7KE1Ra_trigger'),
    scopeMark: document.body.dataset.sandroneModelScope || null,
    regMark: document.body.dataset.sandroneModelRegistered || null,
    errMark: document.body.dataset.sandroneModelError || null,
    injectErrMark: document.body.dataset.sandroneModelInjectError || null,
  }))
  console.log('SEAT:', JSON.stringify(seat))
  console.log('ERRORS:', JSON.stringify(errors.slice(0, 12), null, 2))

  // 2) Open the picker with a real click.
  await clickAt('[data-sandrone-model-picker] .sandrone-model-trigger')
  const rootMenu = await window.evaluate(() => {
    const menu = document.querySelector('[data-sandrone-model-picker] .sandrone-model-menu')
    if (!menu) return { opened: false }
    const r = menu.getBoundingClientRect()
    return {
      opened: true,
      rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      inside: r.x >= 0 && r.y >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1,
      cells: [...menu.querySelectorAll('.sandrone-model-cell')].map(c => ({
        text: (c.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
        color: getComputedStyle(c).color,
        disabled: c.disabled,
      })),
      occluder: (() => {
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
        return hit && !menu.contains(hit) ? `${hit.tagName}.${String(hit.className).slice(0, 40)}` : null
      })(),
    }
  })
  console.log('ROOT-MENU:', JSON.stringify(rootMenu, null, 2))

  // 3) Click the 模型 cell -> model list pane.
  await clickAt('[data-sandrone-model-picker] .sandrone-model-cell:nth-child(1)')
  const modelsPane = await window.evaluate(() => {
    const menu = document.querySelector('[data-sandrone-model-picker] .sandrone-model-menu')
    if (!menu) return { opened: false }
    const r = menu.getBoundingClientRect()
    const options = [...menu.querySelectorAll('.sandrone-model-option')].map(o => {
      const s = getComputedStyle(o)
      const name = o.querySelector('.sandrone-model-option-name')
      return {
        text: (o.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
        color: s.color,
        bg: s.backgroundColor,
        fontSize: s.fontSize,
        nameColor: name ? getComputedStyle(name).color : null,
      }
    })
    const titles = [...menu.querySelectorAll('.sandrone-model-group-title')].map(t => t.textContent)
    return {
      opened: true,
      rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      inside: r.x >= 0 && r.y >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1,
      titles,
      options,
      status: [...menu.querySelectorAll('.sandrone-model-status')].map(s => (s.textContent || '').trim().slice(0, 60)),
      occluder: (() => {
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
        return hit && !menu.contains(hit) ? `${hit.tagName}.${String(hit.className).slice(0, 40)}` : null
      })(),
    }
  })
  console.log('MODELS-PANE:', JSON.stringify(modelsPane, null, 2))

  const readable = modelsPane.opened && modelsPane.options.length > 0 &&
    modelsPane.options.every(o => o.color && o.color !== 'rgba(0, 0, 0, 0)' && o.bg && o.bg !== 'rgba(0, 0, 0, 0)')
  console.log('PASS:', JSON.stringify({ ownSeat: seat.own, officialGone: !seat.official, rootOpened: rootMenu.opened, modelsReadable: readable, modelsInside: modelsPane.inside }))
} finally {
  await application.close().catch(() => {})
  await rm(profileRoot, { recursive: true, force: true }).catch(() => {})
}
