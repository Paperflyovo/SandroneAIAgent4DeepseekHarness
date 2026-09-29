import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

test('desktop runner invokes the imported public CLI exactly once with the supplied arguments', async t => {
  const root = await mkdtemp(join(tmpdir(), 'sandrone-runner-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const bin = join(root, 'cli.mjs')
  await writeFile(bin, 'export async function runCli() { console.log(JSON.stringify(process.argv.slice(2))) }\nif (import.meta.main) await runCli()\n')
  const { stdout } = await promisify(execFile)(process.execPath, [fileURLToPath(new URL('../apps/desktop/harness-runner.mjs', import.meta.url))], {
    env: { ...process.env, SANDRONE_DSH_BIN: bin, SANDRONE_DSH_ARGS: JSON.stringify(['web', '--no-open']) },
  })
  assert.deepEqual(JSON.parse(stdout), ['web', '--no-open'])
})
