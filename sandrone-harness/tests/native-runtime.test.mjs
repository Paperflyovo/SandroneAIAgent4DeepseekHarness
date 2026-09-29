import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import test from 'node:test'

const requireRuntime = createRequire(process.env.QA_APP_ROOT ? join(process.env.QA_APP_ROOT, 'package.json') : import.meta.url)

test('Windows PTY executes the system PowerShell with the bundled native binaries', { skip: process.platform !== 'win32', timeout: 20000 }, async () => {
  const windowsRoot = process.env.SystemRoot || 'C:\\Windows'
  const executable = join(windowsRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe')
  const script = `
    const pty = require(${JSON.stringify(requireRuntime.resolve('node-pty'))});
    const terminal = pty.spawn(${JSON.stringify(executable)}, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', "Write-Output 'SANDRONE_PTY_OK'"], { cols: 80, rows: 24, cwd: ${JSON.stringify(windowsRoot)}, env: process.env });
    let output = '';
    terminal.onData(data => { output += data });
    terminal.onExit(({ exitCode }) => { process.stdout.write(output, () => process.exit(exitCode)) });
  `
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT
  const { stdout } = await promisify(execFile)(process.execPath, ['-e', script], { env, windowsHide: true, timeout: 15000 })
  assert.match(stdout, /SANDRONE_PTY_OK/)
})

test('bundled image codec encodes and decodes real PNG bytes', async () => {
  const sharp = requireRuntime('sharp')
  const data = await sharp({ create: { width: 2, height: 3, channels: 4, background: '#c5213d' } }).png().toBuffer()
  const metadata = await sharp(data).metadata()
  assert.equal(metadata.width, 2)
  assert.equal(metadata.height, 3)
  assert.equal(metadata.format, 'png')
})
