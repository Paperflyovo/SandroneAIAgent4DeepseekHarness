// One-off: drive the CUSTOM provider card with the real SoruxGPT endpoint,
// using programmatic clicks/fills (the onboarding mask blocks real pointers).
import { mkdtemp, realpath, readFile, rm } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const out = { steps: [] }
const step = (name, data) => { out.steps.push({ name, ...data }); console.log('STEP', name, JSON.stringify(data).slice(0, 700)) }
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

function bundledPlaywrightCandidates() {
  const runtimeRoot = process.env.CODEX_RUNTIME_ROOT?.trim()
  const candidates = []
  const push = c => { if (c) candidates.push(c) }
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
    const pkg = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
    return { electron: loaded._electron, version: String(pkg.version ?? 'unknown') }
  }
  throw new Error('driver not found')
}

const driver = await loadDriver()
const electronExecutable = await realpath(join(root, 'node_modules', 'electron', 'dist', 'electron.exe'))
const profileRoot = await mkdtemp(join(tmpdir(), 'sandrone-provider-probe-'))
const launchEnvironment = {
  ...process.env,
  APPDATA: profileRoot,
  LOCALAPPDATA: profileRoot,
  TEMP: profileRoot,
  TMP: profileRoot,
  ELECTRON_USER_DATA_DIR: join(profileRoot, 'chromium'),
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
window.on('pageerror', error => console.log('[pageerror]', error.message))

async function waitForHarness(timeoutMs = 300_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const status = await window.evaluate(() => window.sandroneDesktop?.getStatus()).catch(() => null)
    if (status?.phase === 'ready' && status?.url) return
    if (Date.now() > deadline) throw new Error('harness not ready')
    await wait(1_000)
  }
}

const clickByText = text => window.evaluate(t => {
  const panel = document.querySelector('[role="dialog"][aria-modal="true"]')
  const scope = panel || document
  const el = [...scope.querySelectorAll('button')].find(b => (b.textContent || '').replace(/\s+/g, ' ').trim() === t)
  if (el) { el.click(); return true }
  return false
}, text)

const setInput = (label, value) => window.evaluate(([l, v]) => {
  const panel = document.querySelector('[role="dialog"][aria-modal="true"]')
  const el = [...panel.querySelectorAll('input')].find(i => (i.getAttribute('aria-label') || '') === l)
  if (!el) return false
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(el, v)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  return true
}, [label, value])

const dump = () => window.evaluate(() => {
  const panel = document.querySelector('[role="dialog"][aria-modal="true"]')
  if (!panel) return null
  const create = [...panel.querySelectorAll('button')].find(b => (b.textContent || '').trim() === '创建提供方')
  const all = [...panel.querySelectorAll('button, input, select, p')].map(el => {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return null
    return {
      tag: el.tagName, type: el.type || '', label: el.getAttribute('aria-label') || '',
      text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 24),
      disabled: el.disabled || undefined,
      y: Math.round(r.y), h: Math.round(r.height),
    }
  }).filter(Boolean)
  return {
    createDisabled: create?.disabled ?? null,
    createInViewport: create ? (create.getBoundingClientRect().y >= 0 && create.getBoundingClientRect().y + create.getBoundingClientRect().height <= window.innerHeight) : null,
    hints: all.filter(i => i.tag === 'P').map(i => i.text).filter(Boolean).slice(0, 8),
    buttons: all.filter(i => i.tag === 'BUTTON').map(i => i.text).filter(Boolean),
    fields: all.filter(i => i.tag === 'INPUT' || i.tag === 'SELECT').map(i => ({ label: i.label, disabled: i.disabled, y: i.y, h: i.h })).slice(0, 12),
  }
})

try {
  await waitForHarness()
  await wait(2_000)
  // Defer onboarding if it is up.
  await window.evaluate(() => {
    const btn = [...document.querySelectorAll('[role="dialog"] button')].find(b => /稍后配置|Configure later/.test((b.textContent || '')))
    if (btn) btn.click()
    const cont = [...document.querySelectorAll('[role="dialog"] button')].find(b => /继续|Continue/.test((b.textContent || '')))
    if (cont) cont.click()
  })
  await wait(1_500)

  await window.evaluate(() => document.querySelector('[data-sandrone-settings] button')?.click())
  await wait(1_000)
  await window.evaluate(() => {
    const panel = document.querySelector('[role="dialog"][aria-modal="true"]')
    const cell = panel && [...panel.querySelectorAll('[class*="navCell"]')].find(b => (b.textContent || '').trim() === '模型')
    cell?.click()
  })
  await wait(1_000)
  step('models section open', await dump())

  await clickByText('添加自定义提供方')
  await wait(700)
  step('custom card open', await dump())

  await setInput('Provider ID', 'soruxgpt')
  await setInput('显示名称', 'SoruxGPT')
  await setInput('API 地址', 'https://app.soruxgpt.com/api/codex')
  await setInput('API 密钥', 'sk-probe-dummy-0000')
  await window.evaluate(() => {
    const sel = document.querySelector('body [role="dialog"][class*="VOzbGW_panel"] select')
    if (sel) { sel.value = 'openai'; sel.dispatchEvent(new Event('change', { bubbles: true })) }
  })
  await wait(400)
  step('filled', await dump())

  const fetched = await clickByText('获取可用模型')
  step('fetch clicked', { fetched })
  await wait(15_000)
  step('after fetch', await dump())

  const adopted = await clickByText('添加所选')
  step('adopt clicked', { adopted })
  await wait(1_000)
  step('final', await dump())

  console.log(JSON.stringify({ out }, null, 1))
} catch (error) {
  console.error('[probe]', error)
} finally {
  await application.close().catch(() => {})
  await rm(profileRoot, { recursive: true, force: true }).catch(() => {})
}
