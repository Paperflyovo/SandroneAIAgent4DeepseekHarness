import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import resolvePackage from '../apps/desktop/lib/resolve-package.cjs'
import { desktopPackagingTarget } from './lib/desktop-platform.mjs'

const { packageBin } = resolvePackage
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function parseArguments(args) {
  const allowed = new Set(['--dir'])
  for (const argument of args) {
    if (!allowed.has(argument)) throw new Error(`Unknown desktop packaging argument: ${argument}`)
  }
  return { directoryOnly: args.includes('--dir') }
}

async function run() {
  const options = parseArguments(process.argv.slice(2))
  const target = desktopPackagingTarget()
  const executable = packageBin('electron-builder', 'electron-builder', join(root, 'package.json'))
  const args = [
    executable,
    '--config', target.config,
    `--${target.builderPlatform}`,
    `--${target.architecture}`,
    '--publish', 'never',
  ]
  if (options.directoryOnly) args.push('--dir')

  console.log(`[desktop:package] ${process.platform}-${target.architecture} via ${target.config}`)
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: process.env.CSC_IDENTITY_AUTO_DISCOVERY ?? 'false' },
    stdio: 'inherit',
    windowsHide: true,
  })
  const code = await new Promise((accept, reject) => {
    child.once('error', reject)
    child.once('exit', (exitCode, signal) => {
      if (signal) reject(new Error(`electron-builder terminated by ${signal}`))
      else accept(exitCode ?? 1)
    })
  })
  if (code !== 0) throw new Error(`electron-builder exited with code ${code}`)
}

await run()
