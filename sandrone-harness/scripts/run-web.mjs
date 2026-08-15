import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const { deployPlugin } = require('../apps/desktop/lib/deploy-plugin.cjs')
const { packageBin } = require('../apps/desktop/lib/resolve-package.cjs')
const dshHome = resolve(process.env.DSH_HOME || join(root, 'runtime', 'dsh-home'))
const patch = join(root, 'profiles', 'sandrone-web.patch.yml')
const plugin = join(root, 'packages', 'sandrone-ui')
const dump = process.argv.slice(2).includes('--dump-config')

await mkdir(dshHome, { recursive: true })
deployPlugin({ source: plugin, dshHome })

const args = ['web', '--patch', patch]
if (dump) args.push('--dump-config')
else args.push('--port', process.env.PORT || '3080')

const child = spawn(process.execPath, [packageBin('@deepseek-ai/dsh', 'dsh', join(root, 'package.json')), ...args], {
  cwd: process.cwd(),
  env: { ...process.env, DSH_HOME: dshHome },
  stdio: 'inherit',
  windowsHide: true,
})

const forward = signal => {
  if (!child.killed) child.kill(signal)
}
process.once('SIGINT', () => forward('SIGINT'))
process.once('SIGTERM', () => forward('SIGTERM'))
child.once('error', error => {
  console.error(`Could not start DeepSeek Harness: ${error.message}`)
  process.exitCode = 1
})
child.once('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0)
})
