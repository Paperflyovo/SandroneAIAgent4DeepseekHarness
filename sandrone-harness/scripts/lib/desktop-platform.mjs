const TARGETS = Object.freeze({
  win32: Object.freeze({ builderPlatform: 'win', config: 'apps/desktop/electron-builder.windows.yml' }),
  darwin: Object.freeze({ builderPlatform: 'mac', config: 'apps/desktop/electron-builder.macos.yml' }),
  linux: Object.freeze({ builderPlatform: 'linux', config: 'apps/desktop/electron-builder.linux.yml' }),
})

const ARCHITECTURES = new Set(['x64', 'arm64'])

export function desktopPackagingTarget(platform = process.platform, architecture = process.arch) {
  const target = TARGETS[platform]
  if (!target) throw new Error(`Desktop packaging does not support platform ${platform}`)
  if (!ARCHITECTURES.has(architecture)) {
    throw new Error(`Desktop packaging does not support architecture ${architecture} on ${platform}`)
  }
  return { ...target, architecture }
}

export function electronExecutableRelativePath(platform = process.platform) {
  if (platform === 'win32') return 'electron.exe'
  if (platform === 'darwin') return 'Electron.app/Contents/MacOS/Electron'
  if (platform === 'linux') return 'electron'
  throw new Error(`Desktop QA does not support platform ${platform}`)
}
