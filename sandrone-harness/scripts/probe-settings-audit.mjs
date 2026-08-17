// Settings audit v2: scans every settings section for REAL layout anomalies —
// cross-element text overlaps (excluding ancestor/descendant pairs) and
// clipped text — so the rebuild is driven by evidence.
import { mkdtemp, realpath, readFile, rm } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const out = []
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
    await wait(1_000)
  }
}

const auditSection = () => window.evaluate(() => {
  const panel = document.querySelector('[role="dialog"][aria-modal="true"]')
  if (!panel) return null
  const leaves = []
  const walk = element => {
    const style = getComputedStyle(element)
    const rect = element.getBoundingClientRect()
    const text = (element.textContent || '').replace(/\s+/g, ' ').trim()
    const visible = style.display !== 'none' && style.visibility !== 'hidden'
      && Number.parseFloat(style.opacity || '1') > 0 && rect.width > 0 && rect.height > 0
    if (!visible) { for (const child of element.children) walk(child); return }
    if (text.length > 0 && style.whiteSpace === 'nowrap'
      && style.overflowX !== 'visible' && style.overflowX !== 'auto'
      && element.scrollWidth > element.clientWidth + 2 && element.clientWidth > 0) {
      leaves.push({ kind: 'clip', el: element, text: text.slice(0, 40), w: rect.width, sw: element.scrollWidth })
    }
    if (text.length > 0 && (element.children.length === 0 || element.tagName === 'INPUT' || element.tagName === 'BUTTON')) {
      leaves.push({ kind: 'leaf', el: element, text: text.slice(0, 30), x: rect.x, y: rect.y, w: rect.width, h: rect.height })
    }
    for (const child of element.children) walk(child)
  }
  walk(panel)
  const leafNodes = leaves.filter(n => n.kind === 'leaf')
  const overlaps = []
  for (let i = 0; i < leafNodes.length; i += 1) {
    for (let j = i + 1; j < leafNodes.length; j += 1) {
      const a = leafNodes[i]; const b = leafNodes[j]
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue
      const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
      const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
      if (ix > 5 && iy > 5) {
        overlaps.push({ a: `${a.el.tagName}.${a.text}`, b: `${b.el.tagName}.${b.text}`, ix: Math.round(ix), iy: Math.round(iy) })
      }
    }
  }
  return {
    clips: leaves.filter(n => n.kind === 'clip').map(n => ({ tag: n.el.tagName, cls: String(n.el.className).slice(0, 36), text: n.text, w: n.w, sw: n.sw })).slice(0, 10),
    overlaps: overlaps.slice(0, 12),
  }
})

try {
  await waitForHarness()
  await wait(2_000)
  await window.evaluate(() => {
    const btn = [...document.querySelectorAll('[role="dialog"] button')].find(b => /稍后配置|Configure later/.test((b.textContent || '')))
    if (btn) btn.click()
    const cont = [...document.querySelectorAll('[role="dialog"] button')].find(b => /继续|Continue/.test((b.textContent || '')))
    if (cont) cont.click()
  })
  await wait(1_500)
  await window.evaluate(() => document.querySelector('[data-sandrone-settings] button')?.click())
  await wait(1_000)

  const sections = ['通用设置', '模型', '插件', 'Agent 预设', '其他']
  for (const label of sections) {
    await window.evaluate(l => {
      const panel = document.querySelector('[role="dialog"][aria-modal="true"]')
      const cell = panel && [...panel.querySelectorAll('[class*="navCell"]')].find(b => (b.textContent || '').trim() === l)
      cell?.click()
    }, label)
    await wait(900)
    const result = await auditSection()
    out.push({ section: label, ...result })
    console.log('SECTION', label, JSON.stringify(result))
  }
  console.log(JSON.stringify({ out }, null, 1))
} catch (error) {
  console.error('[audit]', error)
} finally {
  await application.close().catch(() => {})
  await rm(profileRoot, { recursive: true, force: true }).catch(() => {})
}
