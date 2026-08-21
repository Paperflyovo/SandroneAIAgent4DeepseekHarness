import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import nativeArtifacts from '../apps/desktop/verify-native-artifacts.cjs'
import {
  desktopPackagingTarget,
  electronExecutableRelativePath,
} from '../scripts/lib/desktop-platform.mjs'

const { missingRequiredPeerDependencies, requiredNodePtyArtifacts } = nativeArtifacts

async function source(relative) {
  return readFile(new URL(`../${relative}`, import.meta.url), 'utf8')
}

test('desktop packaging maps each supported host to one native builder configuration', () => {
  assert.deepEqual(desktopPackagingTarget('win32', 'x64'), {
    builderPlatform: 'win', config: 'apps/desktop/electron-builder.windows.yml', architecture: 'x64',
  })
  assert.deepEqual(desktopPackagingTarget('darwin', 'arm64'), {
    builderPlatform: 'mac', config: 'apps/desktop/electron-builder.macos.yml', architecture: 'arm64',
  })
  assert.deepEqual(desktopPackagingTarget('linux', 'x64'), {
    builderPlatform: 'linux', config: 'apps/desktop/electron-builder.linux.yml', architecture: 'x64',
  })
  assert.throws(() => desktopPackagingTarget('freebsd', 'x64'), /does not support platform/)
  assert.throws(() => desktopPackagingTarget('linux', 'riscv64'), /does not support architecture/)
})

test('desktop QA resolves the Electron executable on Windows, macOS and Linux', () => {
  assert.equal(electronExecutableRelativePath('win32'), 'electron.exe')
  assert.equal(electronExecutableRelativePath('darwin'), 'Electron.app/Contents/MacOS/Electron')
  assert.equal(electronExecutableRelativePath('linux'), 'electron')
})

test('platform builder profiles keep native dependency policy explicit', async () => {
  const [base, windows, macos, linux] = await Promise.all([
    source('apps/desktop/electron-builder.yml'),
    source('apps/desktop/electron-builder.windows.yml'),
    source('apps/desktop/electron-builder.macos.yml'),
    source('apps/desktop/electron-builder.linux.yml'),
  ])
  assert.match(base, /afterPack:\s+apps\/desktop\/verify-native-artifacts\.cjs/)
  assert.doesNotMatch(base, /npmRebuild:/)
  assert.match(windows, /npmRebuild:\s+false/)
  assert.match(windows, /target:\s*\n\s+- nsis/)
  assert.match(macos, /npmRebuild:\s+false/)
  assert.match(macos, /- dmg[\s\S]*- zip/)
  assert.match(linux, /npmRebuild:\s+true/)
  assert.match(linux, /nativeRebuilder:\s+sequential/)
  assert.match(linux, /- AppImage[\s\S]*- deb/)
})

test('native artifact gate distinguishes prebuilt and rebuilt node-pty layouts', async () => {
  assert.deepEqual(requiredNodePtyArtifacts('win32', 'arm64'), [
    'prebuilds/win32-arm64/conpty.node',
    'prebuilds/win32-arm64/conpty_console_list.node',
    'prebuilds/win32-arm64/conpty/conpty.dll',
    'prebuilds/win32-arm64/conpty/OpenConsole.exe',
  ])
  assert.deepEqual(requiredNodePtyArtifacts('darwin', 'x64'), [
    'prebuilds/darwin-x64/pty.node',
    'prebuilds/darwin-x64/spawn-helper',
  ])
  assert.deepEqual(requiredNodePtyArtifacts('linux', 'arm64'), ['prebuilds/linux-arm64/pty.node'])
  assert.throws(() => requiredNodePtyArtifacts('freebsd', 'x64'), /Unsupported packaged platform/)
  await access(new URL('../node_modules/node-pty/prebuilds/win32-x64/conpty.node', import.meta.url))
  await access(new URL('../node_modules/node-pty/prebuilds/darwin-arm64/pty.node', import.meta.url))
})

test('packaging gate rejects missing required peers and ignores optional peers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sandrone-peer-gate-'))
  const nodeModules = join(root, 'node_modules')
  const consumer = join(nodeModules, '@example', 'consumer')
  const runtime = join(nodeModules, '@example', 'runtime')
  await mkdir(consumer, { recursive: true })
  await writeFile(join(consumer, 'package.json'), JSON.stringify({
    name: '@example/consumer',
    version: '1.0.0',
    peerDependencies: {
      '@example/optional': '1.0.0',
      '@example/runtime': '1.0.0',
    },
    peerDependenciesMeta: {
      '@example/optional': { optional: true },
    },
  }))
  try {
    assert.deepEqual(missingRequiredPeerDependencies(nodeModules), [{
      packageName: '@example/runtime',
      consumers: ['@example/consumer@1.0.0'],
    }])
    await mkdir(runtime, { recursive: true })
    await writeFile(join(runtime, 'package.json'), JSON.stringify({
      name: '@example/runtime',
      version: '1.0.0',
    }))
    assert.deepEqual(missingRequiredPeerDependencies(nodeModules), [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('manual sandbox workflow covers native x64 and arm64 runners for all desktop platforms', async () => {
  const workflow = await source('../.github/workflows/desktop-cross-platform.yml')
  for (const runner of [
    'windows-latest', 'windows-11-arm',
    'macos-15-intel', 'macos-latest',
    'ubuntu-latest', 'ubuntu-24.04-arm',
  ]) assert.match(workflow, new RegExp(runner))
  assert.match(workflow, /workflow_dispatch:/)
  assert.doesNotMatch(workflow, /softprops\/action-gh-release|contents:\s+write/)
})
