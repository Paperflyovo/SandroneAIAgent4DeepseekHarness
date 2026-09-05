'use strict'

const MAX_SESSION_SCREENSHOT_HEIGHT = 36_000
const MAX_SESSION_SCREENSHOT_WIDTH = 8_000
const MAX_SESSION_SCREENSHOT_PIXELS = 180_000_000
const MAX_SESSION_SCREENSHOT_TRANSFER_BYTES = 64 * 1024 * 1024
const MAX_SESSION_SCREENSHOT_CHUNKS = 12

function withTimeout(promise, timeoutMs, message) {
  let timer
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs)
      timer.unref?.()
    }),
  ]).finally(() => clearTimeout(timer))
}

async function composeSessionScreenshot(options, sharp) {
  const deadline = Date.now() + 40_000
  const remaining = limit => Math.max(1, Math.min(limit, deadline - Date.now()))
  const requestedChunks = options?.chunks
  const width = Number(options?.width)
  const height = Number(options?.height)
  if (!Array.isArray(requestedChunks) || requestedChunks.length < 1 || requestedChunks.length > MAX_SESSION_SCREENSHOT_CHUNKS) {
    throw new Error('截图数据无效或分块数量超出限制')
  }
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new Error('截图尺寸无效')
  if (width > MAX_SESSION_SCREENSHOT_WIDTH) throw new Error('会话宽度超出截图范围')
  if (height > MAX_SESSION_SCREENSHOT_HEIGHT) throw new Error(`会话过长，请先折叠轨迹或分段截图（上限 ${MAX_SESSION_SCREENSHOT_HEIGHT} 像素）`)
  if (width * height > MAX_SESSION_SCREENSHOT_PIXELS) throw new Error('截图区域过大，请缩小选区或分段截图')
  const chunks = []
  let transferredBytes = 0
  let outputHeight = 0
  for (const [index, value] of requestedChunks.entries()) {
    if (!(value instanceof Uint8Array) && !Buffer.isBuffer(value)) throw new Error(`截图片段 ${index + 1} 格式无效`)
    const data = Buffer.from(value)
    transferredBytes += data.length
    if (transferredBytes > MAX_SESSION_SCREENSHOT_TRANSFER_BYTES) throw new Error('截图数据过大，请缩小选区或分段截图')
    const metadata = await withTimeout(sharp(data).metadata(), remaining(10_000), `读取截图片段 ${index + 1} 超时`)
    if (metadata.format !== 'png' || metadata.width !== width || !Number.isInteger(metadata.height) || metadata.height < 1) {
      throw new Error(`截图片段 ${index + 1} 尺寸或格式无效`)
    }
    chunks.push({ top: outputHeight, data })
    outputHeight += metadata.height
  }
  if (outputHeight !== height) throw new Error('截图片段高度与选区不一致')
  const bytes = chunks.length === 1
    ? chunks[0].data
    : await withTimeout(sharp({
      create: {
        width,
        height: outputHeight,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      },
    }).composite(chunks.map(chunk => ({ input: chunk.data, left: 0, top: chunk.top }))).png().toBuffer(), remaining(30_000), '拼接会话截图超时')
  return { bytes, width, height: outputHeight }
}

module.exports = {
  MAX_SESSION_SCREENSHOT_TRANSFER_BYTES,
  composeSessionScreenshot,
}
