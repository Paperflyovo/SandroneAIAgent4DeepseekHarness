'use strict'

function parsedHttpUrl(value) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (url.username || url.password) return null
    return url
  } catch {
    return null
  }
}

function isLoopbackHostname(hostname) {
  const normalized = String(hostname).toLowerCase().replace(/\.$/, '')
  const mappedIpv4 = /^\[::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})\]$/i.exec(normalized)
  if (mappedIpv4) {
    const high = Number.parseInt(mappedIpv4[1], 16)
    const low = Number.parseInt(mappedIpv4[2], 16)
    return (high >>> 8) === 127 || ((high === 0 || high === 0x7fff) && (low >>> 8) === 127)
  }
  return normalized === 'localhost'
    || normalized.endsWith('.localhost')
    || normalized === '[::1]'
    || normalized.startsWith('127.')
}

function isExternalHttpUrl(value, internalOrigin) {
  const url = parsedHttpUrl(value)
  return url !== null
    && !isLoopbackHostname(url.hostname)
    && !isInternalHarnessUrl(value, internalOrigin)
}

function isInternalHarnessUrl(value, internalOrigin) {
  const url = parsedHttpUrl(value)
  const origin = parsedHttpUrl(internalOrigin)
  return url !== null && origin !== null && url.origin === origin.origin
}

function isTrustedFileUrl(value, trustedFileUrl) {
  try {
    const url = new URL(value)
    const trusted = new URL(trustedFileUrl)
    return url.protocol === 'file:' && trusted.protocol === 'file:' && url.href === trusted.href
  } catch {
    return false
  }
}

function classifyNavigation(value, options = {}) {
  if (isInternalHarnessUrl(value, options.internalOrigin ?? null)) return 'internal'
  if (isTrustedFileUrl(value, options.trustedFileUrl ?? null)) return 'trusted-file'
  if (isExternalHttpUrl(value, options.internalOrigin ?? null)) return 'external'
  return 'deny'
}

module.exports = {
  classifyNavigation,
  isExternalHttpUrl,
  isInternalHarnessUrl,
  isLoopbackHostname,
  isTrustedFileUrl,
  parsedHttpUrl,
}
