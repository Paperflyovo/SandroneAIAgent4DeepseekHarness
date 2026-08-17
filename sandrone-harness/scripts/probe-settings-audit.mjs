// One-off audit: open the settings page and scan it for layout anomalies —
// overlapping text, clipped text, overflowing/zero-size elements — so the
// rebuild can be driven by evidence instead of eyeballing.
import { mkdtemp, realpath, readFile, rm } from 'node:fs/promises'
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
    const pkg = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
    return { electron: loaded._electron, version: String(pkg.version ?? 'unknown') }
  }
  throw new Error('playwright electron driver not found')
}

const driver = await loadDriver()
const electronExecutable = await realpath(join(root, 'node_modules', 'electron', 'dist', 'electron.exe'))
const profileRoot = await mkdtemp(join(tmpdir(), 'sandrone-settings-audit-'))
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

  await window.evaluate(() => document.querySelector('[data-sandrone-settings] button')?.click())
  await new Promise(resolve => setTimeout(resolve, 800))
  const panel = window.locator('[role="dialog"][aria-modal="true"]')
  await panel.waitFor({ state: 'visible', timeout: 30_000 })

  // Visit every settings section and audit each one.
  const sections = ['通用设置', '模型', '插件']
  const report = []
  for (const label of sections) {
    const nav = window.getByRole('button', { name: label, exact: false }).first()
    try {
      await nav.click()
      await new Promise(resolve => setTimeout(resolve, 700))
    } catch {}
    const audit = await window.evaluate(() => {
      const panelEl = document.querySelector('[role="dialog"][aria-modal="true"]')
      if (!panelEl) return { error: 'no panel' }
      const panel = panelEl.getBoundingClientRect()
      const textNodes = []
      const walk = element => {
        const style = getComputedStyle(element)
        const rect = element.getBoundingClientRect()
        const text = (element.textContent || '').replace(/\s+/g, ' ').trim()
        const visible = style.display !== 'none' && style.visibility !== 'hidden'
          && Number.parseFloat(style.opacity || '1') > 0 && rect.width > 0 && rect.height > 0
        if (!visible) { for (const child of element.children) walk(child); return }
        if (text.length > 0 && element.children.length > 0) {
          // Clipped text? (scrollWidth larger than clientWidth without overflow visible)
          if (element.scrollWidth > element.clientWidth + 2 && element.clientWidth > 0
            && style.overflowX !== 'visible' && style.whiteSpace === 'nowrap') {
            textNodes.push({ kind: 'clip', tag: element.tagName, cls: String(element.className).slice(0, 40), text: text.slice(0, 40), w: rect.width, sw: element.scrollWidth })
          }
        }
        // Text-bearing leaf-ish nodes for overlap detection
        if (text.length > 0 && (element.children.length === 0 || element.tagName === 'INPUT' || element.tagName === 'BUTTON')) {
          textNodes.push({ kind: 'leaf', tag: element.tagName, cls: String(element.className).slice(0, 40), text: text.slice(0, 40), x: rect.x, y: rect.y, w: rect.width, h: rect.height })
        }
        // Overflow beyond the panel
        if (rect.width > 0 && (rect.x < panel.x - 2 || rect.right > panel.right + 2 || rect.y < panel.y - 2 || rect.bottom > panel.bottom + 2)) {
          textNodes.push({ kind: 'overflow', tag: element.tagName, cls: String(element.className).slice(0, 40), text: text.slice(0, 30), x: Math.round(rect.x), right: Math.round(rect.right), y: Math.round(rect.y), bottom: Math.round(rect.bottom), panel: { x: Math.round(panel.x), right: Math.round(panel.right), y: Math.round(panel.y), bottom: Math.round(panel.bottom) } })
        }
        for (const child of element.children) walk(child)
      }
      walk(panelEl)
      // Overlapping text leaves
      const leaves = textNodes.filter(node => node.kind === 'leaf')
      const overlaps = []
      for (let i = 0; i < leaves.length; i += 1) {
        for (let j = i + 1; j < leaves.length; j += 1) {
          const a = leaves[i]; const b = leaves[j]
          if (a === b) continue
          const ax = a.x, ay = a.y, aw = a.w, ah = a.h
          const bx = b.x, by = b.y, bw = b.w, bh = b.h
          const ix = Math.max(0, Math.min(ax + aw, bx + bw) - Math.max(ax, bx))
          const iy = Math.max(0, Math.min(ay + ah, by + bh) - Math.max(ay, by))
          if (ix > 4 && iy > 4 && ix * iy > 30) {
            overlaps.push({ a: `${a.tag}.${a.text}`, b: `${b.tag}.${b.text}`, ix: Math.round(ix), iy: Math.round(iy) })
          }
        }
      }
      return { clipped: textNodes.filter(n => n.kind === 'clip').slice(0, 12), overflow: textNodes.filter(n => n.kind === 'overflow').slice(0, 8), overlaps: overlaps.slice(0, 10) }
    })
    report.push({ section: label, ...audit })
  }
  console.log(JSON.stringify({ report }, null, 1))
} catch (error) {
  console.error('[audit]', error)
} finally {
  await application.close().catch(() => {})
  await rm(profileRoot, { recursive: true, force: true }).catch(() => {})
}
