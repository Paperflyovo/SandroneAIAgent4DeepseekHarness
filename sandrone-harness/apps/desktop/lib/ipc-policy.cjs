'use strict'

const { isInternalHarnessUrl, isTrustedFileUrl } = require('./navigation-policy.cjs')

function isTrustedRendererUrl(value, options = {}) {
  return isInternalHarnessUrl(value, options.internalOrigin ?? null)
    || isTrustedFileUrl(value, options.trustedFileUrl ?? null)
}

function isTrustedIpcSender(event, window, options = {}) {
  if (!event || !window || window.isDestroyed?.()) return false
  const webContents = window.webContents
  if (!webContents || event.sender !== webContents) return false
  if (!webContents.mainFrame || event.senderFrame !== webContents.mainFrame) return false
  return isTrustedRendererUrl(event.senderFrame.url, options)
}

function assertTrustedIpcSender(event, window, options = {}) {
  if (!isTrustedIpcSender(event, window, options)) throw new Error('Untrusted IPC sender')
}

module.exports = { assertTrustedIpcSender, isTrustedIpcSender, isTrustedRendererUrl }
