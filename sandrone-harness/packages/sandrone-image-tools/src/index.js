import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import ipaddr from 'ipaddr.js'
import { lookup } from 'node:dns/promises'
import http from 'node:http'
import https from 'node:https'
import { basename } from 'node:path'

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_BYTES = 20 * 1024 * 1024
const DEFAULT_MAX_REDIRECTS = 5
const ALLOWED_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

export const name = 'sandrone-image-tools'
export const inject = ['tools', 'attachments', 'systemPrompt']
export const Config = z.object({
  timeoutMs: z.number().default(DEFAULT_TIMEOUT_MS),
  maxBytes: z.number().default(DEFAULT_MAX_BYTES),
  maxRedirects: z.number().default(DEFAULT_MAX_REDIRECTS),
})

function positiveInteger(name, value) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`sandrone-image-tools: ${name} must be a positive integer`)
  return value
}

function normalizedAddress(address) {
  const parsed = ipaddr.parse(address)
  return parsed.kind() === 'ipv6' && parsed.isIPv4MappedAddress() ? parsed.toIPv4Address() : parsed
}

export function isPublicAddress(address) {
  try {
    return normalizedAddress(address).range() === 'unicast'
  } catch {
    return false
  }
}

export function parseRemoteImageUrl(value) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error('url must be a valid absolute HTTP(S) URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('url must use http or https')
  if (url.username || url.password) throw new Error('url must not contain embedded credentials')
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new Error('url must not target localhost or local-network names')
  }
  return url
}

export async function resolvePublicTarget(url, resolve = lookup) {
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  if (ipaddr.isValid(hostname)) {
    if (!isPublicAddress(hostname)) throw new Error(`remote image host resolves to a non-public address: ${hostname}`)
    const parsed = normalizedAddress(hostname)
    return { address: parsed.toString(), family: parsed.kind() === 'ipv6' ? 6 : 4 }
  }
  const answers = await resolve(hostname, { all: true, verbatim: true })
  if (answers.length === 0) throw new Error(`remote image host did not resolve: ${hostname}`)
  const unsafe = answers.find(answer => !isPublicAddress(answer.address))
  if (unsafe) throw new Error(`remote image host resolves to a non-public address: ${unsafe.address}`)
  return answers[0]
}

export function detectImageMediaType(data) {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg'
  if (data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  if (data.length >= 6 && (data.toString('ascii', 0, 6) === 'GIF87a' || data.toString('ascii', 0, 6) === 'GIF89a')) return 'image/gif'
  return undefined
}

function imageName(url, mediaType) {
  const candidate = basename(decodeURIComponent(url.pathname))
  if (candidate && candidate !== '/' && candidate !== '.') return candidate.slice(0, 240)
  const extension = mediaType === 'image/jpeg' ? 'jpg' : mediaType.slice('image/'.length)
  return `remote-image.${extension}`
}

export function pinnedLookup(target) {
  return (_hostname, optionsOrCallback, maybeCallback) => {
    const options = typeof optionsOrCallback === 'function' ? {} : optionsOrCallback
    const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback
    if (options?.all) callback(null, [{ address: target.address, family: target.family }])
    else callback(null, target.address, target.family)
  }
}

function requestOnce(url, target, { signal, timeoutMs, maxBytes }) {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', abort)
      callback(value)
    }
    const abort = () => request.destroy(signal?.reason instanceof Error ? signal.reason : new Error('remote image request aborted'))
    const transport = url.protocol === 'https:' ? https : http
    const request = transport.request(url, {
      method: 'GET',
      headers: {
        Accept: 'image/png,image/jpeg,image/webp,image/gif;q=0.9,*/*;q=0.1',
        'User-Agent': 'SandroneHarness/0.1 remote-image-reader',
      },
      lookup: pinnedLookup(target),
      ...(url.protocol === 'https:' ? { servername: url.hostname.replace(/^\[|\]$/g, '') } : {}),
    }, response => {
      const chunks = []
      let bytes = 0
      response.on('data', chunk => {
        bytes += chunk.length
        if (bytes > maxBytes) {
          response.destroy(new Error(`remote image exceeds the ${maxBytes}-byte download limit`))
          return
        }
        chunks.push(chunk)
      })
      response.once('error', error => finish(reject, error))
      response.once('end', () => finish(resolve, {
        statusCode: response.statusCode ?? 0,
        headers: response.headers,
        data: Buffer.concat(chunks, bytes),
      }))
    })
    request.setTimeout(timeoutMs, () => request.destroy(new Error(`remote image request timed out after ${timeoutMs}ms`)))
    request.once('error', error => finish(reject, error))
    if (signal?.aborted) abort()
    else signal?.addEventListener('abort', abort, { once: true })
    request.end()
  })
}

export async function downloadRemoteImage(value, options = {}) {
  const timeoutMs = positiveInteger('timeoutMs', options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const maxBytes = positiveInteger('maxBytes', options.maxBytes ?? DEFAULT_MAX_BYTES)
  const maxRedirects = positiveInteger('maxRedirects', options.maxRedirects ?? DEFAULT_MAX_REDIRECTS)
  let url = parseRemoteImageUrl(value)
  for (let redirects = 0; ; redirects += 1) {
    const target = await resolvePublicTarget(url, options.lookup)
    const response = await (options.request ?? requestOnce)(url, target, { signal: options.signal, timeoutMs, maxBytes })
    if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
      if (redirects >= maxRedirects) throw new Error(`remote image exceeded the ${maxRedirects}-redirect limit`)
      const location = response.headers.location
      if (!location) throw new Error(`remote image redirect from ${url.href} has no Location header`)
      url = parseRemoteImageUrl(new URL(location, url).href)
      continue
    }
    if (response.statusCode < 200 || response.statusCode >= 300) throw new Error(`remote image request failed with HTTP ${response.statusCode}`)
    const mediaType = detectImageMediaType(response.data)
    if (!mediaType || !ALLOWED_MEDIA_TYPES.has(mediaType)) throw new Error('remote response is not a supported PNG, JPEG, WebP, or GIF image')
    return { url, data: response.data, mediaType }
  }
}

function imageContent(value) {
  return [{
    type: 'text',
    text: `<url>${value.url}</url>\n<type>image</type>\n<content>\n${value.image.mediaType} image, ${value.image.width}x${value.image.height} px, ${value.image.bytes} bytes\n</content>`,
  }, {
    type: 'image',
    attachment: value.image,
  }]
}

export function apply(ctx, config) {
  const timeoutMs = positiveInteger('timeoutMs', config.timeoutMs)
  const maxBytes = positiveInteger('maxBytes', config.maxBytes)
  const maxRedirects = positiveInteger('maxRedirects', config.maxRedirects)
  ctx.systemPrompt.section({
    name: 'tool:read_image_url',
    order: 112,
    text: 'Use read_image_url when an HTTP(S) URL points directly to an image and you need to inspect the actual pixels. Do not claim a linked image is unreadable before trying this tool. The tool stores the image as a durable attachment and returns a native image block.',
  })
  ctx.tools.register(defineTool({
    name: 'read_image_url',
    description: 'Download a public HTTP(S) PNG/JPEG/WebP/GIF URL and return the actual image. Localhost, private-network targets, oversized responses, and unsafe redirects are rejected.',
    parameters: {
      url: {
        type: 'string',
        required: true,
        description: 'Direct public HTTP(S) URL of the image.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          url: { type: 'string', required: true },
          image: {
            type: 'object',
            required: true,
            additionalProperties: false,
            properties: {
              attachmentId: { type: 'string', required: true },
              mediaType: { type: 'string', required: true },
              bytes: { type: 'integer', required: true },
              width: { type: 'integer', required: true },
              height: { type: 'integer', required: true },
              name: { type: 'string' },
            },
          },
        },
      },
      render: (_args, value) => imageContent(value),
    },
    timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const downloaded = await downloadRemoteImage(args.url, {
        signal: exec.signal,
        timeoutMs,
        maxBytes: Math.min(maxBytes, ctx.attachments.imageLimits.maxImageBytes, ctx.attachments.imageLimits.maxMessageImageBytes),
        maxRedirects,
      })
      const ref = await ctx.attachments.saveImage({
        data: downloaded.data,
        mediaType: downloaded.mediaType,
        name: imageName(downloaded.url, downloaded.mediaType),
      })
      return {
        url: downloaded.url.href,
        image: {
          attachmentId: ref.attachmentId,
          mediaType: ref.mediaType,
          bytes: ref.bytes,
          width: ref.width,
          height: ref.height,
          ...(ref.name === undefined ? {} : { name: ref.name }),
        },
      }
    },
    presentCall(args) {
      return { card: 'generic', title: `Read image ${args.url}`, kind: 'read' }
    },
  }))
}
