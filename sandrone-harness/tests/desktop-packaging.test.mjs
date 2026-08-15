import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import test from 'node:test'

import nativeArtifacts from '../apps/desktop/verify-native-artifacts.cjs'
import {
  desktopPackagingTarget,
  electronExecutableRelativePath,
} from '../scripts/lib/desktop-platform.mjs'

const { requiredNodePtyArtifacts } = nativeArtifacts

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
  assert.deepEqual(requiredNodePtyArtifacts('win32', 'arm64'), ['prebuilds/win32-arm64/pty.node'])
  assert.deepEqual(requiredNodePtyArtifacts('darwin', 'x64'), [
    'prebuilds/darwin-x64/pty.node',
    'prebuilds/darwin-x64/spawn-helper',
  ])
  assert.deepEqual(requiredNodePtyArtifacts('linux', 'arm64'), ['build/Release/pty.node'])
  assert.throws(() => requiredNodePtyArtifacts('freebsd', 'x64'), /Unsupported packaged platform/)
  await access(new URL('../node_modules/node-pty/prebuilds/win32-x64/pty.node', import.meta.url))
  await access(new URL('../node_modules/node-pty/prebuilds/darwin-arm64/pty.node', import.meta.url))
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
