import { getFontEmbedCSS } from 'html-to-image'
import { cloneNode as cloneScreenshotNode } from 'html-to-image/es/clone-node.js'
import { embedImages } from 'html-to-image/es/embed-images.js'
import { canvasToBlob, createImage, nodeToDataURL } from 'html-to-image/es/util.js'

const SESSION_SCREENSHOT_CHUNK_HEIGHT = 6_000
const SESSION_SCREENSHOT_CHUNK_PIXELS = 18_000_000
const SESSION_SCREENSHOT_MAX_HEIGHT = 36_000
const SESSION_SCREENSHOT_MAX_WIDTH = 8_000
const SESSION_SCREENSHOT_MAX_PIXELS = 180_000_000
const SESSION_SCREENSHOT_RENDER_TIMEOUT_MS = 20_000
const SESSION_SCREENSHOT_TOTAL_TIMEOUT_MS = 60_000
const SESSION_SCREENSHOT_EXCLUDED = [
  '[data-composer-seat]',
  '[data-sandrone-screenshot-overlay]',
  '.sandrone-session-screenshot-overlay',
  '.sandrone-right-panel',
].join(',')

export function screenshotTimeout(promise, timeoutMs, message) {
  let timer
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = window.setTimeout(() => reject(new Error(message)), timeoutMs)
    }),
  ]).finally(() => window.clearTimeout(timer))
}

function screenshotBackground(element) {
  for (let current = element; current instanceof HTMLElement; current = current.parentElement) {
    const color = window.getComputedStyle(current).backgroundColor
    if (color && color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)') return color
  }
  return document.documentElement.dataset.colorScheme === 'dark' ? '#1d1b1a' : '#faf8f4'
}

function prepareScreenshotClone(clone) {
  clone.querySelectorAll('*').forEach(copy => {
    const position = copy.style.position
    if (position === 'sticky' && copy.closest('[data-chat-flow-kind]')) {
      copy.style.setProperty('position', 'relative', 'important')
      copy.style.setProperty('inset', 'auto', 'important')
    } else if (position === 'fixed' || position === 'sticky') {
      copy.setAttribute('data-sandrone-capture-excluded', 'true')
    }
  })
}

function captureMediaLayoutLocks(source) {
  const locks = []
  let sequence = 0
  source.querySelectorAll('*').forEach(element => {
    if (!(element instanceof HTMLElement) || element.children.length < 2) return
    const style = window.getComputedStyle(element)
    if (!['flex', 'inline-flex', 'grid', 'inline-grid'].includes(style.display)) return
    const mediaChildren = [...element.children].filter(child => child.matches('img, video, canvas, picture') || child.querySelector('img, video, canvas, picture'))
    if (mediaChildren.length < 2) return
    const containerRect = element.getBoundingClientRect()
    if (containerRect.width < 1 || containerRect.height < 1) return
    const id = `media-${sequence++}`
    element.setAttribute('data-sandrone-capture-layout-lock', id)
    const children = [...element.children].map((child, index) => {
      const rect = child.getBoundingClientRect()
      child.setAttribute('data-sandrone-capture-layout-child', `${id}:${index}`)
      return { id: `${id}:${index}`, left: rect.left - containerRect.left, top: rect.top - containerRect.top, width: rect.width, height: rect.height }
    })
    locks.push({ id, width: containerRect.width, height: containerRect.height, children })
  })
  return locks
}

function clearMediaLayoutLockMarkers(source) {
  source.querySelectorAll('[data-sandrone-capture-layout-lock], [data-sandrone-capture-layout-child]').forEach(element => {
    element.removeAttribute('data-sandrone-capture-layout-lock')
    element.removeAttribute('data-sandrone-capture-layout-child')
  })
}

function applyMediaLayoutLocks(clone, locks) {
  for (const lock of locks) {
    const container = clone.querySelector(`[data-sandrone-capture-layout-lock="${lock.id}"]`)
    if (!(container instanceof HTMLElement)) continue
    container.style.setProperty('position', 'relative', 'important')
    container.style.setProperty('display', 'block', 'important')
    container.style.setProperty('box-sizing', 'border-box', 'important')
    for (const property of ['width', 'min-width', 'max-width']) container.style.setProperty(property, `${lock.width}px`, 'important')
    for (const property of ['height', 'min-height', 'max-height']) container.style.setProperty(property, `${lock.height}px`, 'important')
    for (const childLock of lock.children) {
      const child = container.querySelector(`:scope > [data-sandrone-capture-layout-child="${childLock.id}"]`)
      if (!(child instanceof HTMLElement)) continue
      child.style.setProperty('position', 'absolute', 'important')
      child.style.setProperty('inset', 'auto', 'important')
      child.style.setProperty('left', `${childLock.left}px`, 'important')
      child.style.setProperty('top', `${childLock.top}px`, 'important')
      child.style.setProperty('box-sizing', 'border-box', 'important')
      for (const property of ['width', 'min-width', 'max-width']) child.style.setProperty(property, `${childLock.width}px`, 'important')
      for (const property of ['height', 'min-height', 'max-height']) child.style.setProperty(property, `${childLock.height}px`, 'important')
      child.style.setProperty('margin', '0', 'important')
    }
  }
}

async function renderFrozenViewport(viewport, host, width, height, backgroundColor) {
  let dataUrl
  try {
    dataUrl = await nodeToDataURL(viewport, width, height)
  } finally {
    host.appendChild(viewport)
  }
  const image = await createImage(dataUrl)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('无法创建截图画布')
  context.fillStyle = backgroundColor
  context.fillRect(0, 0, width, height)
  context.drawImage(image, 0, 0, width, height)
  return canvasToBlob(canvas, { type: 'image/png', quality: 1 })
}

function relativeBox(element, root, rootRect, scrollTop = 0) {
  const rect = element.getBoundingClientRect()
  const top = rect.top - rootRect.top + scrollTop
  return { top, bottom: top + rect.height }
}

function captureAnchorPairs(source, clone) {
  const sourceRect = source.getBoundingClientRect()
  const cloneRect = clone.getBoundingClientRect()
  const cloneByKey = new Map()
  clone.querySelectorAll('[data-chat-anchor-key]').forEach(element => {
    const key = element.getAttribute('data-chat-anchor-key')
    if (!key) return
    const matches = cloneByKey.get(key) || []
    matches.push(element)
    cloneByKey.set(key, matches)
  })
  const occurrences = new Map()
  const pairs = []
  source.querySelectorAll('[data-chat-anchor-key]').forEach(element => {
    const key = element.getAttribute('data-chat-anchor-key')
    if (!key) return
    const occurrence = occurrences.get(key) || 0
    occurrences.set(key, occurrence + 1)
    const cloneElement = cloneByKey.get(key)?.[occurrence]
    if (!cloneElement) return
    const sourceBox = relativeBox(element, source, sourceRect, source.scrollTop)
    const cloneBox = relativeBox(cloneElement, clone, cloneRect)
    if (![sourceBox.top, sourceBox.bottom, cloneBox.top, cloneBox.bottom].every(Number.isFinite)) return
    if (sourceBox.bottom <= sourceBox.top || cloneBox.bottom <= cloneBox.top) return
    pairs.push({ source: sourceBox, clone: cloneBox })
  })
  pairs.sort((left, right) => left.source.top - right.source.top || left.source.bottom - right.source.bottom)
  return pairs.filter((pair, index) => {
    const previous = pairs[index - 1]
    return !previous
      || Math.abs(previous.source.top - pair.source.top) > 0.5
      || Math.abs(previous.source.bottom - pair.source.bottom) > 0.5
      || Math.abs(previous.clone.top - pair.clone.top) > 0.5
      || Math.abs(previous.clone.bottom - pair.clone.bottom) > 0.5
  })
}

function interpolate(value, sourceStart, sourceEnd, cloneStart, cloneEnd) {
  if (sourceEnd <= sourceStart) return cloneStart
  const progress = Math.max(0, Math.min(1, (value - sourceStart) / (sourceEnd - sourceStart)))
  return cloneStart + (cloneEnd - cloneStart) * progress
}

export function mapScreenshotCoordinate(value, anchors, sourceExtent, cloneExtent) {
  const coordinate = Math.max(0, Math.min(sourceExtent, value))
  if (anchors.length === 0) return Math.min(coordinate, cloneExtent)
  const containing = anchors
    .filter(anchor => coordinate >= anchor.source.top && coordinate <= anchor.source.bottom)
    .sort((left, right) => (left.source.bottom - left.source.top) - (right.source.bottom - right.source.top))[0]
  if (containing) {
    return interpolate(coordinate, containing.source.top, containing.source.bottom, containing.clone.top, containing.clone.bottom)
  }
  let previous = null
  let next = null
  for (const anchor of anchors) {
    if (anchor.source.bottom <= coordinate && (!previous || anchor.source.bottom > previous.source.bottom)) previous = anchor
    if (anchor.source.top >= coordinate && (!next || anchor.source.top < next.source.top)) next = anchor
  }
  if (previous && next) {
    return interpolate(coordinate, previous.source.bottom, next.source.top, previous.clone.bottom, next.clone.top)
  }
  if (next) return interpolate(coordinate, 0, next.source.top, 0, next.clone.top)
  if (previous) return interpolate(coordinate, previous.source.bottom, sourceExtent, previous.clone.bottom, cloneExtent)
  return Math.min(coordinate, cloneExtent)
}

export async function renderSessionScreenshot(target, selection, baseline) {
  const rect = target.getBoundingClientRect()
  const scrollHeight = Math.max(target.scrollHeight, target.clientHeight)
  if (baseline && (Math.abs(rect.width - baseline.width) > 1 || Math.abs(scrollHeight - baseline.scrollHeight) > 1)) {
    throw new Error('会话内容或布局已变化，请重新选择截图')
  }
  if (selection.bottom > scrollHeight) throw new Error('截图终点超出当前会话内容')
  const width = Math.ceil(rect.width)
  const requestedHeight = selection.bottom - selection.top
  if (width < 1 || requestedHeight < 1) throw new Error('截图选区为空')
  if (width > SESSION_SCREENSHOT_MAX_WIDTH) throw new Error('会话宽度超出截图范围')
  if (requestedHeight > SESSION_SCREENSHOT_MAX_HEIGHT) throw new Error(`选取范围过长，请分段截图（上限 ${SESSION_SCREENSHOT_MAX_HEIGHT} 像素）`)
  if (width * requestedHeight > SESSION_SCREENSHOT_MAX_PIXELS) throw new Error('截图区域过大，请缩小选区或分段截图')
  const backgroundColor = screenshotBackground(target)
  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  host.setAttribute('data-sandrone-capture-host', 'true')
  Object.assign(host.style, {
    position: 'fixed',
    left: '-100000px',
    top: '0',
    width: `${width}px`,
    height: '1px',
    overflow: 'hidden',
    pointerEvents: 'none',
    contain: 'strict',
    zIndex: '-2147483648',
  })
  const viewport = document.createElement('div')
  const mediaLayoutLocks = captureMediaLayoutLocks(target)
  let snapshot
  try {
    snapshot = await screenshotTimeout(cloneScreenshotNode(target, {
      filter: node => !(node instanceof Element) || !node.matches(SESSION_SCREENSHOT_EXCLUDED),
    }, true), SESSION_SCREENSHOT_RENDER_TIMEOUT_MS, '冻结会话布局超时')
  } finally {
    clearMediaLayoutLockMarkers(target)
  }
  if (!(snapshot instanceof HTMLElement)) throw new Error('无法创建会话截图副本')
  const freezeStyle = document.createElement('style')
  freezeStyle.textContent = `
    [data-sandrone-capture-clone], [data-sandrone-capture-clone] *,
    [data-sandrone-capture-clone] *::before, [data-sandrone-capture-clone] *::after {
      animation: none !important; transition: none !important; caret-color: transparent !important;
      scrollbar-width: none !important;
    }
    [data-sandrone-capture-clone] *::-webkit-scrollbar { width: 0 !important; height: 0 !important; display: none !important; }
    [data-sandrone-capture-clone] [data-sandrone-capture-excluded="true"] { visibility: hidden !important; }
  `
  Object.assign(viewport.style, {
    position: 'relative',
    width: `${width}px`,
    overflow: 'hidden',
    background: backgroundColor,
  })
  snapshot.setAttribute('data-sandrone-capture-clone', 'true')
  snapshot.setAttribute('inert', '')
  prepareScreenshotClone(snapshot)
  applyMediaLayoutLocks(snapshot, mediaLayoutLocks)
  Object.assign(snapshot.style, {
    position: 'absolute',
    left: '0',
    top: '0',
    width: `${rect.width}px`,
    minWidth: `${rect.width}px`,
    maxWidth: `${rect.width}px`,
    height: `${rect.height}px`,
    minHeight: `${rect.height}px`,
    maxHeight: `${rect.height}px`,
    overflow: 'visible',
    transform: 'translate3d(0, 0, 0)',
    scrollBehavior: 'auto',
    scrollbarGutter: 'auto',
  })
  snapshot.querySelectorAll(SESSION_SCREENSHOT_EXCLUDED).forEach(element => element.setAttribute('data-sandrone-capture-excluded', 'true'))
  viewport.append(freezeStyle, snapshot)
  host.appendChild(viewport)
  document.body.appendChild(host)
  try {
    await new Promise(resolve => window.requestAnimationFrame(resolve))
    const cloneExtent = Math.max(snapshot.scrollHeight, snapshot.clientHeight)
    const anchors = captureAnchorPairs(target, snapshot)
    const mappedTop = Math.max(0, Math.floor(mapScreenshotCoordinate(selection.top, anchors, scrollHeight, cloneExtent)))
    const mappedBottom = Math.min(cloneExtent, Math.ceil(mapScreenshotCoordinate(selection.bottom, anchors, scrollHeight, cloneExtent)))
    const height = mappedBottom - mappedTop
    if (height < 1) throw new Error('截图选区映射为空，请重新选择')
    if (height > SESSION_SCREENSHOT_MAX_HEIGHT || width * height > SESSION_SCREENSHOT_MAX_PIXELS) throw new Error('映射后的截图区域过大，请缩小选区或分段截图')
    const chunkHeightLimit = Math.max(1, Math.min(SESSION_SCREENSHOT_CHUNK_HEIGHT, Math.floor(SESSION_SCREENSHOT_CHUNK_PIXELS / width)))
    const deadline = performance.now() + SESSION_SCREENSHOT_TOTAL_TIMEOUT_MS
    const remaining = limit => Math.max(1, Math.min(limit, deadline - performance.now()))
    await screenshotTimeout(document.fonts?.ready || Promise.resolve(), remaining(3_000), '等待字体加载超时').catch(() => {})
    let fontEmbedCSS
    try {
      fontEmbedCSS = await screenshotTimeout(getFontEmbedCSS(viewport, { preferredFontFormat: 'woff2' }), remaining(8_000), '嵌入字体超时')
    } catch {
      fontEmbedCSS = undefined
    }
    if (fontEmbedCSS) {
      const fontStyle = document.createElement('style')
      fontStyle.textContent = fontEmbedCSS
      viewport.prepend(fontStyle)
    }
    await screenshotTimeout(embedImages(viewport, { cacheBust: false }), remaining(SESSION_SCREENSHOT_RENDER_TIMEOUT_MS), '嵌入截图图片超时')
    const chunks = []
    for (let offset = 0; offset < height; offset += chunkHeightLimit) {
      const chunkHeight = Math.min(chunkHeightLimit, height - offset)
      viewport.style.height = `${chunkHeight}px`
      snapshot.style.transform = `translate3d(0, ${-(mappedTop + offset)}px, 0)`
      const blob = await screenshotTimeout(renderFrozenViewport(viewport, host, width, chunkHeight, backgroundColor), remaining(SESSION_SCREENSHOT_RENDER_TIMEOUT_MS), `渲染截图片段 ${chunks.length + 1} 超时`)
      if (!(blob instanceof Blob) || blob.size < 1) throw new Error(`截图片段 ${chunks.length + 1} 为空`)
      chunks.push(new Uint8Array(await blob.arrayBuffer()))
    }
    return { chunks, width, height }
  } finally {
    host.remove()
  }
}
