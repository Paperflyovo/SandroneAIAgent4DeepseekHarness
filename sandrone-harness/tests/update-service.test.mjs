import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
  REPOSITORY_URL,
  UpdateService,
  assetNameFor,
  compareVersions,
  isAllowedDownloadUrl,
  parseVersion,
  selectReleaseAsset,
} = require('../apps/desktop/lib/update-service.cjs')

test('version comparison handles v prefixes and prereleases', () => {
  assert.equal(parseVersion('v1.2.3').major, 1)
  assert.equal(compareVersions('1.2.3', '1.2.3'), 0)
  assert.equal(compareVersions('1.2.4', 'v1.2.3'), 1)
  assert.equal(compareVersions('1.2.3-beta.2', '1.2.3-beta.10'), -1)
  assert.equal(compareVersions('1.2.3', '1.2.3-rc.1'), 1)
})

test('asset selection is exact and platform aware', () => {
  assert.deepEqual(assetNameFor('win32', 'x64', '1.2.3'), ['SandroneAIAgent-1.2.3-x64.exe'])
  const release = {
    tag_name: 'v1.2.3',
    assets: [
      { name: 'SandroneAIAgent-1.2.3-x64.exe.blockmap', browser_download_url: 'https://github.com/example/blockmap' },
      { name: 'SandroneAIAgent-1.2.3-x64.exe', browser_download_url: 'https://github.com/example/installer.exe' },
    ],
  }
  assert.equal(selectReleaseAsset(release, { platform: 'win32', arch: 'x64' }).name, 'SandroneAIAgent-1.2.3-x64.exe')
  assert.equal(selectReleaseAsset(release, { platform: 'darwin', arch: 'x64' }), null)
})

test('download URLs are restricted to GitHub HTTPS hosts', () => {
  assert.equal(isAllowedDownloadUrl('https://github.com/Paperflyovo/file.exe'), true)
  assert.equal(isAllowedDownloadUrl('https://objects.githubusercontent.com/file.exe'), true)
  assert.equal(isAllowedDownloadUrl('http://github.com/file.exe'), false)
  assert.equal(isAllowedDownloadUrl('https://example.com/file.exe'), false)
})

test('update service reports an available release and downloads atomically', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sandrone-update-test-'))
  const installerBytes = Buffer.from('MZ-sandrone-test-installer')
  const digest = (await import('node:crypto')).createHash('sha256').update(installerBytes).digest('hex')
  const requestImpl = async (_url, options) => {
    assert.equal(options.headers.Accept, 'application/vnd.github+json')
    return {
      status: 200,
      headers: { etag: '"test-release"' },
      body: Buffer.from(JSON.stringify({
        tag_name: 'v0.2.0',
        name: 'Sandrone AI Agent v0.2.0',
        html_url: `${REPOSITORY_URL}/releases/tag/v0.2.0`,
        body: '修复稳定性问题',
        assets: [{
          name: 'SandroneAIAgent-0.2.0-x64.exe',
          size: installerBytes.length,
          digest: `sha256:${digest}`,
          browser_download_url: 'https://github.com/Paperflyovo/test/releases/download/v0.2.0/SandroneAIAgent-0.2.0-x64.exe',
        }],
      })),
    }
  }
  const downloadImpl = async (_url, target, options) => {
    await (await import('node:fs/promises')).writeFile(target, installerBytes)
    options.onProgress?.({ receivedBytes: installerBytes.length, totalBytes: installerBytes.length, percent: 100 })
    return { size: installerBytes.length, sha256: digest }
  }
  try {
    const service = new UpdateService({ appVersion: '0.1.2', userDataPath: root, platform: 'win32', arch: 'x64', requestImpl, downloadImpl })
    assert.equal((await service.check({ force: true })).status, 'available')
    const downloaded = await service.download()
    assert.equal(downloaded.status, 'downloaded')
    assert.equal(downloaded.sha256, digest)
    assert.deepEqual(await readFile(join(root, 'updates', 'SandroneAIAgent-0.2.0-x64.exe')), installerBytes)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('unsupported platforms fail closed without contacting GitHub', async () => {
  let requests = 0
  const service = new UpdateService({ appVersion: '0.1.2', userDataPath: 'unused', platform: 'freebsd', requestImpl: async () => { requests += 1 } })
  assert.equal((await service.check()).status, 'unsupported')
  assert.equal(requests, 0)
})
