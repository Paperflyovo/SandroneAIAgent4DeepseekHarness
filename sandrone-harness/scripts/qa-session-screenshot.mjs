import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile, readdir, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'
import sharp from 'sharp'

import screenshotModule from '../apps/desktop/lib/session-screenshot.cjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const { composeSessionScreenshot } = screenshotModule

async function inspectPlaywrightRoot(candidate) {
  try {
    const packageRoot = await realpath(resolve(candidate))
    const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
    return manifest.name === 'playwright' ? packageRoot : null
  } catch {
    return null
  }
}

async function loadChromium() {
  const runtimeRoot = join(homedir(), '.cache', 'codex-runtimes')
  const candidates = []
  const override = process.env.PLAYWRIGHT_PACKAGE_ROOT?.trim()
  if (override) candidates.push(override)
  candidates.push(join(runtimeRoot, 'codex-primary-runtime', 'dependencies', 'node', 'node_modules', 'playwright'))
  try {
    candidates.push(dirname(require.resolve('playwright/package.json')))
  } catch {}
  try {
    for (const entry of await readdir(runtimeRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith('codex-runtime-install-')) continue
      candidates.push(join(runtimeRoot, entry.name, 'payload', 'codex-primary-runtime', 'dependencies', 'node', 'node_modules', 'playwright'))
    }
  } catch {}
  for (const candidate of [...new Set(candidates)]) {
    const packageRoot = await inspectPlaywrightRoot(candidate)
    if (!packageRoot) continue
    const playwright = require(packageRoot)
    if (playwright?.chromium) return playwright.chromium
  }
  throw new Error('Playwright Chromium not found; set PLAYWRIGHT_PACKAGE_ROOT')
}

const bundle = await build({
  entryPoints: [join(root, 'packages', 'sandrone-ui', 'src', 'sessionScreenshot.js')],
  bundle: true,
  write: false,
  format: 'iife',
  globalName: 'SandroneScreenshotQA',
  platform: 'browser',
  target: ['chrome140'],
})

const chromium = await loadChromium()
const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 }, colorScheme: 'light' })
  page.setDefaultTimeout(120_000)
  await page.setContent('<!doctype html><html><head><style>html,body{margin:0;background:#faf8f4}#target{width:720px;height:600px;overflow:auto;background:#fff}</style></head><body><div id="target"></div></body></html>')
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  await page.evaluate(() => {
    const target = document.getElementById('target')
    const canvas = document.createElement('canvas')
    canvas.width = 720
    canvas.height = 9_000
    canvas.style.display = 'block'
    const context = canvas.getContext('2d')
    for (let y = 0; y < canvas.height; y += 1) {
      context.fillStyle = `rgb(${y & 255}, ${(y >> 8) & 255}, ${(y >> 16) & 255})`
      context.fillRect(0, y, canvas.width, 1)
    }
    target.appendChild(canvas)
  })
  const before = await page.screenshot({ fullPage: false })
  const rendered = await page.evaluate(async () => {
    const target = document.getElementById('target')
    const baseline = { width: target.getBoundingClientRect().width, scrollHeight: target.scrollHeight }
    const result = await window.SandroneScreenshotQA.renderSessionScreenshot(target, { top: 20, bottom: 6_900 }, baseline)
    const chunks = await Promise.all(result.chunks.map(chunk => new Promise((resolveData, reject) => {
      const reader = new FileReader()
      reader.addEventListener('load', () => resolveData(reader.result), { once: true })
      reader.addEventListener('error', () => reject(reader.error), { once: true })
      reader.readAsDataURL(new Blob([chunk], { type: 'image/png' }))
    })))
    return {
      ...result,
      chunks,
      captureHosts: document.querySelectorAll('[data-sandrone-capture-host]').length,
      targetStyle: target.getAttribute('style'),
      scrollTop: target.scrollTop,
    }
  })
  const after = await page.screenshot({ fullPage: false })
  assert.equal(rendered.captureHosts, 0)
  assert.equal(rendered.targetStyle, null)
  assert.equal(rendered.scrollTop, 0)
  assert.ok(before.equals(after), 'visible page changed while rendering the screenshot')
  const chunks = rendered.chunks.map(dataUrl => Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'))
  const composed = await composeSessionScreenshot({ chunks, width: rendered.width, height: rendered.height }, sharp)
  assert.equal(composed.width, 720)
  assert.equal(composed.height, 6_880)
  const metadata = await sharp(composed.bytes).metadata()
  assert.equal(metadata.width, 720)
  assert.equal(metadata.height, 6_880)
  const seamTop = 5_998
  const seam = await sharp(composed.bytes).extract({ left: 360, top: seamTop, width: 1, height: 4 }).raw().toBuffer()
  for (let row = 0; row < 4; row += 1) {
    const sourceY = 20 + seamTop + row
    assert.deepEqual([...seam.subarray(row * 4, row * 4 + 4)], [sourceY & 255, (sourceY >> 8) & 255, (sourceY >> 16) & 255, 255])
  }

  await page.setContent(`<!doctype html><html><head><style>
    html,body{margin:0;background:#faf8f4}
    .session-shell #target{box-sizing:border-box;width:720px;height:300px;overflow:auto;padding:54px 12px 20px;background:#fff}
    .session-shell [data-chat-anchor-key]{box-sizing:border-box;width:520px}
    .session-shell .intro{height:200px;margin-bottom:16px;background:#c43b32}
    .session-shell .answer{height:1036px;background:#1266cc}
  </style></head><body><div class="session-shell"><div id="target"><div class="intro" data-chat-anchor-key="intro"></div><div class="answer" data-chat-anchor-key="answer"></div></div></div></body></html>`)
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  const anchored = await page.evaluate(async () => {
    const target = document.getElementById('target')
    const answer = target.querySelector('[data-chat-anchor-key="answer"]')
    const targetRect = target.getBoundingClientRect()
    const answerRect = answer.getBoundingClientRect()
    const answerTop = answerRect.top - targetRect.top + target.scrollTop
    const result = await window.SandroneScreenshotQA.renderSessionScreenshot(target, { top: answerTop + 300, bottom: answerTop + 917 }, {
      width: targetRect.width,
      scrollHeight: target.scrollHeight,
    })
    const chunks = await Promise.all(result.chunks.map(chunk => new Promise((resolveData, reject) => {
      const reader = new FileReader()
      reader.addEventListener('load', () => resolveData(reader.result), { once: true })
      reader.addEventListener('error', () => reject(reader.error), { once: true })
      reader.readAsDataURL(new Blob([chunk], { type: 'image/png' }))
    })))
    return { ...result, chunks, captureHosts: document.querySelectorAll('[data-sandrone-capture-host]').length }
  })
  assert.equal(anchored.captureHosts, 0)
  assert.equal(anchored.width, 720)
  assert.equal(anchored.height, 617)
  assert.equal(anchored.chunks.length, 1)
  const anchoredBytes = Buffer.from(anchored.chunks[0].slice(anchored.chunks[0].indexOf(',') + 1), 'base64')
  const anchoredPixel = await sharp(anchoredBytes).extract({ left: 260, top: 308, width: 1, height: 1 }).raw().toBuffer()
  assert.deepEqual([...anchoredPixel], [18, 102, 204, 255])

  await page.setContent(`<!doctype html><html><head><style>
    html,body{margin:0;background:#faf8f4}#target{box-sizing:border-box;width:720px;height:300px;overflow:auto;background:#fff}
    .spacer{height:400px}.message{box-sizing:border-box;width:720px;height:152px;display:flex;flex-direction:column;align-items:flex-end}
    .stack{width:338px;display:flex;flex-direction:column;align-items:flex-end;gap:8px}.gallery{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:10px;width:138px;height:64px}
    .tile{box-sizing:border-box;display:grid;width:64px;min-width:64px;height:64px;place-items:center;padding:0;border:1px solid #ddd;background:#fff;overflow:hidden}
    .tile img{display:block;width:62px;height:62px}.bubble{box-sizing:border-box;width:338px;height:46px;background:#f5e5e2;border:1px solid #e8cbc7}
  </style></head><body><div id="target"><div class="spacer"></div><div class="message" data-chat-anchor-key="double-image"><div class="stack"><div class="gallery"><button class="tile"><img alt="red"></button><button class="tile"><img alt="blue"></button></div><div class="bubble"></div></div></div></div></body></html>`)
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  await page.evaluate(() => {
    const colors = ['#c43b32', '#1266cc']
    document.querySelectorAll('.tile img').forEach((image, index) => {
      image.src = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="62" height="62"><rect width="62" height="62" fill="${colors[index]}"/></svg>`)}`
    })
  })
  await page.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth > 0))
  const galleryResult = await page.evaluate(async () => {
    const target = document.getElementById('target')
    const anchor = target.querySelector('[data-chat-anchor-key="double-image"]')
    const targetRect = target.getBoundingClientRect()
    const anchorRect = anchor.getBoundingClientRect()
    const top = anchorRect.top - targetRect.top + target.scrollTop
    const result = await window.SandroneScreenshotQA.renderSessionScreenshot(target, { top, bottom: top + anchorRect.height }, { width: targetRect.width, scrollHeight: target.scrollHeight })
    return new Uint8Array(result.chunks[0])
  })
  const galleryImage = sharp(Buffer.from(galleryResult))
  const firstTile = await galleryImage.clone().extract({ left: 613, top: 31, width: 1, height: 1 }).raw().toBuffer()
  const secondTile = await galleryImage.clone().extract({ left: 687, top: 31, width: 1, height: 1 }).raw().toBuffer()
  const bubblePixel = await galleryImage.clone().extract({ left: 600, top: 88, width: 1, height: 1 }).raw().toBuffer()
  assert.deepEqual([...firstTile], [196, 59, 50, 255])
  assert.deepEqual([...secondTile], [18, 102, 204, 255])
  assert.deepEqual([...bubblePixel], [245, 229, 226, 255])
  console.log('[qa:screenshot] passed: exact crop, clean seam, anchored selection, two-image gallery, visible DOM unchanged')
} finally {
  await browser.close()
}
