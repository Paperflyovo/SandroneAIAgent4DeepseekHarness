'use strict'

const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')
const https = require('node:https')
const { once } = require('node:events')
const { spawn } = require('node:child_process')

const REPOSITORY = Object.freeze({ owner: 'Paperflyovo', name: 'SandroneAIAgent4DeepseekHarness' })
const RELEASES_URL = `https://api.github.com/repos/${REPOSITORY.owner}/${REPOSITORY.name}/releases/latest`
const REPOSITORY_URL = `https://github.com/${REPOSITORY.owner}/${REPOSITORY.name}`
const MAX_RELEASE_BODY_LENGTH = 2_400
const MAX_DOWNLOAD_BYTES = 350 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 20_000
const MAX_REDIRECTS = 4
const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

function parseVersion(input) {
  const match = typeof input === 'string' ? input.trim().match(VERSION_PATTERN) : null
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
  }
}

function compareVersions(left, right) {
  const a = parseVersion(left)
  const b = parseVersion(right)
  if (!a || !b) throw new Error('版本号格式无效')
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] !== b[key]) return a[key] > b[key] ? 1 : -1
  }
  if (a.prerelease.length === 0 && b.prerelease.length > 0) return 1
  if (a.prerelease.length > 0 && b.prerelease.length === 0) return -1
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index += 1) {
    const leftPart = a.prerelease[index]
    const rightPart = b.prerelease[index]
    if (leftPart === undefined) return -1
    if (rightPart === undefined) return 1
    if (leftPart === rightPart) continue
    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : null
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : null
    if (leftNumber !== null && rightNumber !== null) return leftNumber > rightNumber ? 1 : -1
    if (leftNumber !== null) return -1
    if (rightNumber !== null) return 1
    return leftPart > rightPart ? 1 : -1
  }
  return 0
}

function architectureName(platform, arch) {
  if (platform === 'win32') {
    return { x64: 'x64', arm64: 'arm64', ia32: 'ia32' }[arch] || null
  }
  if (platform === 'darwin' || platform === 'linux') {
    return { x64: 'x64', arm64: 'arm64', ia32: 'ia32' }[arch] || null
  }
  return null
}

function assetNameFor(platform, arch, version) {
  const normalizedArch = architectureName(platform, arch)
  if (!normalizedArch) return []
  if (platform === 'win32') return [`SandroneAIAgent-${version}-${normalizedArch}.exe`]
  if (platform === 'darwin') return [
    `SandroneAIAgent-${version}-mac-${normalizedArch}.dmg`,
    `SandroneAIAgent-${version}-mac-${normalizedArch}.zip`,
  ]
  if (platform === 'linux') return [
    `SandroneAIAgent-${version}-linux-${normalizedArch}.AppImage`,
    `SandroneAIAgent-${version}-linux-${normalizedArch}.deb`,
  ]
  return []
}

function selectReleaseAsset(release, { platform, arch }) {
  if (!release || !Array.isArray(release.assets)) return null
  const version = parseVersion(release.tag_name || '')
  if (!version) return null
  const normalizedVersion = `${version.major}.${version.minor}.${version.patch}${version.prerelease.length ? `-${version.prerelease.join('.')}` : ''}`
  const names = assetNameFor(platform, arch, normalizedVersion)
  return names.map(name => release.assets.find(asset => (
    asset && asset.name === name && typeof asset.browser_download_url === 'string'
  ))).find(Boolean) || null
}

function trimReleaseNotes(value) {
  if (typeof value !== 'string') return ''
  return value.replace(/\r\n?/g, '\n').trim().slice(0, MAX_RELEASE_BODY_LENGTH)
}

function isAllowedDownloadUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && (
      url.hostname === 'github.com'
      || url.hostname === 'objects.githubusercontent.com'
      || url.hostname.endsWith('.githubusercontent.com')
    )
  } catch {
    return false
  }
}

function request(url, { headers = {}, timeoutMs = REQUEST_TIMEOUT_MS, maxBytes = 2 * 1024 * 1024 } = {}, redirects = 0) {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error, value) => {
      if (settled) return
      settled = true
      error ? reject(error) : resolve(value)
    }
    let parsed
    try { parsed = new URL(url) } catch { finish(new Error('更新地址无效')); return }
    if (parsed.protocol !== 'https:') { finish(new Error('更新连接必须使用 HTTPS')); return }
    const requestOptions = {
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: `${parsed.pathname}${parsed.search}`,
      method: 'GET',
      headers: { ...headers, Connection: 'close' },
    }
    const client = https.request(requestOptions, response => {
      const status = response.statusCode || 0
      const location = response.headers.location
      if ([301, 302, 303, 307, 308].includes(status) && location) {
        response.resume()
        if (redirects >= MAX_REDIRECTS) { finish(new Error('更新服务器重定向次数过多')); return }
        const next = new URL(location, url).toString()
        request(next, { headers, timeoutMs, maxBytes }, redirects + 1).then(value => finish(null, value), finish)
        return
      }
      if (status === 304) { response.resume(); finish(null, { status, headers: response.headers, body: Buffer.alloc(0) }); return }
      if (status < 200 || status >= 300) {
        response.resume()
        const error = new Error(`GitHub 更新请求失败（HTTP ${status}）`)
        error.statusCode = status
        finish(error)
        return
      }
      const chunks = []
      let total = 0
      response.on('data', chunk => {
        total += chunk.length
        if (total > maxBytes) {
          response.destroy(new Error('更新响应超过大小限制'))
          return
        }
        chunks.push(chunk)
      })
      response.on('end', () => finish(null, { status, headers: response.headers, body: Buffer.concat(chunks) }))
      response.on('error', error => finish(error))
    })
    client.setTimeout(timeoutMs, () => client.destroy(new Error('更新请求超时')))
    client.on('error', error => finish(error))
    client.end()
  })
}

function downloadFile(url, target, { expectedSize, onProgress } = {}, redirects = 0) {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error, value) => {
      if (settled) return
      settled = true
      error ? reject(error) : resolve(value)
    }
    let parsed
    try { parsed = new URL(url) } catch { finish(new Error('更新下载地址无效')); return }
    if (!isAllowedDownloadUrl(url)) { finish(new Error('更新下载地址不在 GitHub 白名单内')); return }
    const requestOptions = {
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: `${parsed.pathname}${parsed.search}`,
      method: 'GET',
      headers: {
        'User-Agent': 'SandroneAIAgent-Updater',
        Accept: 'application/octet-stream',
        Connection: 'close',
      },
    }
    const client = https.request(requestOptions, response => {
      const status = response.statusCode || 0
      const location = response.headers.location
      if ([301, 302, 303, 307, 308].includes(status) && location) {
        response.resume()
        if (redirects >= MAX_REDIRECTS) { finish(new Error('更新下载重定向次数过多')); return }
        const next = new URL(location, url).toString()
        downloadFile(next, target, { expectedSize, onProgress }, redirects + 1).then(value => finish(null, value), finish)
        return
      }
      if (status < 200 || status >= 300) {
        response.resume()
        const error = new Error(`更新下载失败（HTTP ${status}）`)
        error.statusCode = status
        finish(error)
        return
      }
      const contentLength = Number(response.headers['content-length'])
      if (Number.isFinite(contentLength) && contentLength > MAX_DOWNLOAD_BYTES) {
        response.resume(); finish(new Error('更新安装包超过大小限制')); return
      }
      if (Number.isFinite(expectedSize) && Number.isFinite(contentLength) && contentLength !== expectedSize) {
        response.resume(); finish(new Error('更新安装包大小与发布资产不一致')); return
      }
      const hash = crypto.createHash('sha256')
      const stream = fs.createWriteStream(target, { flags: 'w' })
      let total = 0
      let writeFailed = false
      const fail = error => {
        if (writeFailed) return
        writeFailed = true
        stream.destroy()
        response.destroy()
        finish(error)
      }
      response.on('data', chunk => {
        total += chunk.length
        if (total > MAX_DOWNLOAD_BYTES) { fail(new Error('更新安装包超过大小限制')); return }
        hash.update(chunk)
        if (!stream.write(chunk)) response.pause()
        onProgress?.({ receivedBytes: total, totalBytes: Number.isFinite(expectedSize) ? expectedSize : contentLength || null, percent: Number.isFinite(expectedSize) && expectedSize > 0 ? Math.min(100, Math.round(total / expectedSize * 100)) : null })
      })
      stream.on('drain', () => response.resume())
      response.on('end', () => {
        if (writeFailed) return
        stream.end(() => {
          if (Number.isFinite(expectedSize) && total !== expectedSize) { fail(new Error('更新安装包下载不完整')); return }
          finish(null, { size: total, sha256: hash.digest('hex') })
        })
      })
      response.on('error', fail)
      stream.on('error', fail)
    })
    client.setTimeout(REQUEST_TIMEOUT_MS, () => client.destroy(new Error('更新下载超时')))
    client.on('error', finish)
    client.end()
  })
}

async function requestWithFetch(fetchImpl, url, { headers = {}, maxBytes = 2 * 1024 * 1024 } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers,
      redirect: 'follow',
      signal: controller.signal,
    })
    if (response.status === 304) return { status: 304, headers: { etag: response.headers.get('etag') }, body: Buffer.alloc(0) }
    const body = Buffer.from(await response.arrayBuffer())
    if (body.length > maxBytes) throw new Error('更新响应超过大小限制')
    if (!response.ok) {
      const error = new Error(`GitHub 更新请求失败（HTTP ${response.status}）`)
      error.statusCode = response.status
      throw error
    }
    return { status: response.status, headers: { etag: response.headers.get('etag') }, body }
  } finally {
    clearTimeout(timer)
  }
}

async function downloadFileWithFetch(fetchImpl, url, target, { expectedSize, onProgress } = {}) {
  if (!isAllowedDownloadUrl(url)) throw new Error('更新下载地址不在 GitHub 白名单内')
  const controller = new AbortController()
  let timer
  const armTimeout = () => {
    clearTimeout(timer)
    timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  }
  armTimeout()
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { 'User-Agent': 'SandroneAIAgent-Updater', Accept: 'application/octet-stream' },
      redirect: 'follow',
      signal: controller.signal,
    })
    if (!response.ok) {
      const error = new Error(`更新下载失败（HTTP ${response.status}）`)
      error.statusCode = response.status
      throw error
    }
    if (response.url && !isAllowedDownloadUrl(response.url)) throw new Error('更新下载发生了不受信重定向')
    const contentLength = Number(response.headers.get('content-length'))
    if (Number.isFinite(contentLength) && contentLength > MAX_DOWNLOAD_BYTES) throw new Error('更新安装包超过大小限制')
    if (Number.isFinite(expectedSize) && Number.isFinite(contentLength) && contentLength !== expectedSize) throw new Error('更新安装包大小与发布资产不一致')
    if (!response.body) throw new Error('更新服务器没有返回文件内容')
    const hash = crypto.createHash('sha256')
    const stream = fs.createWriteStream(target, { flags: 'w' })
    let total = 0
    try {
      for await (const value of response.body) {
        armTimeout()
        const chunk = Buffer.from(value)
        total += chunk.length
        if (total > MAX_DOWNLOAD_BYTES) throw new Error('更新安装包超过大小限制')
        hash.update(chunk)
        if (!stream.write(chunk)) await once(stream, 'drain')
        onProgress?.({ receivedBytes: total, totalBytes: Number.isFinite(expectedSize) ? expectedSize : contentLength || null, percent: Number.isFinite(expectedSize) && expectedSize > 0 ? Math.min(100, Math.round(total / expectedSize * 100)) : null })
      }
      if (Number.isFinite(expectedSize) && total !== expectedSize) throw new Error('更新安装包下载不完整')
      await new Promise((resolve, reject) => {
        stream.once('error', reject)
        stream.end(resolve)
      })
      return { size: total, sha256: hash.digest('hex') }
    } catch (error) {
      stream.destroy()
      throw error
    }
  } finally {
    clearTimeout(timer)
  }
}

class UpdateService {
  constructor({ appVersion, userDataPath, platform = process.platform, arch = process.arch, requestImpl, downloadImpl, fetchImpl } = {}) {
    this.currentVersion = String(appVersion || '0.0.0')
    this.userDataPath = userDataPath
    this.platform = platform
    this.arch = arch
    this.requestImpl = requestImpl || (fetchImpl ? (url, options) => requestWithFetch(fetchImpl, url, options) : request)
    this.downloadImpl = downloadImpl || (fetchImpl ? (url, target, options) => downloadFileWithFetch(fetchImpl, url, target, options) : downloadFile)
    this.release = null
    this.etag = null
    this.latestResult = null
    this.downloaded = null
    this.checkInFlight = null
    this.downloadInFlight = null
  }

  snapshot() {
    if (!this.latestResult) return { status: 'idle', currentVersion: this.currentVersion }
    const { assetUrl: _assetUrl, expectedSha256: _expectedSha256, ...publicResult } = this.latestResult
    return { ...publicResult, currentVersion: this.currentVersion, downloaded: Boolean(this.downloaded) }
  }

  async check({ force = false } = {}) {
    if (!architectureName(this.platform, this.arch)) {
      this.latestResult = { status: 'unsupported', currentVersion: this.currentVersion, repositoryUrl: REPOSITORY_URL }
      return this.snapshot()
    }
    if (this.checkInFlight) return this.checkInFlight
    this.checkInFlight = (async () => {
      const headers = {
        'User-Agent': `SandroneAIAgent/${this.currentVersion}`,
        Accept: 'application/vnd.github+json',
      }
      if (!force && this.etag) headers['If-None-Match'] = this.etag
      try {
        const response = await this.requestImpl(RELEASES_URL, { headers })
        if (response.status === 304 && this.latestResult) return this.snapshot()
        this.etag = response.headers.etag || this.etag
        const release = JSON.parse(response.body.toString('utf8'))
        const latestVersion = release.tag_name
        if (!parseVersion(latestVersion)) throw new Error('GitHub 发布版本号无效')
        const comparison = compareVersions(latestVersion, this.currentVersion)
        const base = {
          currentVersion: this.currentVersion,
          latestVersion: latestVersion.replace(/^v/, ''),
          releaseName: typeof release.name === 'string' && release.name.trim() ? release.name.trim().slice(0, 160) : `Sandrone AI Agent ${latestVersion}`,
          releaseUrl: typeof release.html_url === 'string' ? release.html_url : REPOSITORY_URL,
          publishedAt: typeof release.published_at === 'string' ? release.published_at : null,
          notes: trimReleaseNotes(release.body),
        }
        if (comparison <= 0) {
          this.release = release
          this.latestResult = { ...base, status: 'up-to-date' }
          this.downloaded = null
          return this.snapshot()
        }
        const asset = selectReleaseAsset(release, { platform: this.platform, arch: this.arch })
        if (!asset || !isAllowedDownloadUrl(asset.browser_download_url)) {
          this.latestResult = { ...base, status: 'asset-unavailable' }
          this.release = release
          this.downloaded = null
          return this.snapshot()
        }
        this.release = release
        this.latestResult = {
          ...base,
          status: 'available',
          assetName: asset.name,
          assetSize: Number.isFinite(asset.size) ? asset.size : null,
          assetUrl: asset.browser_download_url,
          expectedSha256: /^sha256:[a-f0-9]{64}$/i.test(asset.digest || '') ? asset.digest.slice(7).toLowerCase() : null,
        }
        this.downloaded = null
        return this.snapshot()
      } catch (error) {
        const message = error?.statusCode === 403
          ? 'GitHub 暂时限制了更新请求，请稍后再试。'
          : error?.message || '检查更新失败。'
        this.latestResult = { status: 'error', currentVersion: this.currentVersion, message, releaseUrl: REPOSITORY_URL }
        return this.snapshot()
      } finally {
        this.checkInFlight = null
      }
    })()
    return this.checkInFlight
  }

  async download({ onProgress } = {}) {
    if (this.downloadInFlight) return this.downloadInFlight
    if (!this.latestResult || this.latestResult.status !== 'available') throw new Error('当前没有可下载的更新')
    this.downloadInFlight = (async () => {
      const updateDir = path.join(this.userDataPath, 'updates')
      const target = path.join(updateDir, this.latestResult.assetName)
      const partial = `${target}.partial`
      await fsp.mkdir(updateDir, { recursive: true })
      try { await fsp.rm(partial, { force: true }) } catch {}
      try {
        const result = await this.downloadImpl(this.latestResult.assetUrl, partial, {
          expectedSize: this.latestResult.assetSize,
          onProgress,
        })
        if (this.latestResult.expectedSha256 && result.sha256 !== this.latestResult.expectedSha256) {
          throw new Error('更新安装包的 SHA-256 与 GitHub 发布记录不一致')
        }
        if (this.latestResult.assetName.toLowerCase().endsWith('.exe')) {
          const handle = await fsp.open(partial, 'r')
          const header = Buffer.alloc(2)
          try { await handle.read(header, 0, 2, 0) } finally { await handle.close() }
          if (header[0] !== 0x4d || header[1] !== 0x5a) throw new Error('下载的更新文件不是有效的 Windows 安装包')
        }
        await fsp.rm(target, { force: true })
        await fsp.rename(partial, target)
        this.downloaded = { path: target, ...result }
        this.latestResult = { ...this.latestResult, status: 'downloaded', downloadedSize: result.size, sha256: result.sha256 }
        return this.snapshot()
      } catch (error) {
        try { await fsp.rm(partial, { force: true }) } catch {}
        this.latestResult = { ...this.latestResult, status: 'error', message: error?.message || '下载更新失败。' }
        return this.snapshot()
      } finally {
        this.downloadInFlight = null
      }
    })()
    return this.downloadInFlight
  }

  async install() {
    if (!this.downloaded?.path) throw new Error('请先下载更新')
    const filePath = path.resolve(this.downloaded.path)
    const updateRoot = path.resolve(this.userDataPath, 'updates')
    if (!filePath.startsWith(`${updateRoot}${path.sep}`) || !fs.existsSync(filePath)) throw new Error('更新文件路径无效')
    const command = this.platform === 'win32' ? filePath : this.platform === 'darwin' ? 'open' : 'xdg-open'
    const args = this.platform === 'win32' ? [] : [filePath]
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: false })
      child.once('error', reject)
      child.once('spawn', () => {
        child.unref()
        this.latestResult = { ...this.latestResult, status: this.platform === 'win32' ? 'installing' : 'manual' }
        resolve(this.snapshot())
      })
    })
  }
}

module.exports = {
  REPOSITORY,
  RELEASES_URL,
  REPOSITORY_URL,
  UpdateService,
  architectureName,
  assetNameFor,
  compareVersions,
  isAllowedDownloadUrl,
  parseVersion,
  selectReleaseAsset,
}
