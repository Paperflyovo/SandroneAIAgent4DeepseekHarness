import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { verifyArchitecture } from '../scripts/verify-architecture.mjs'

async function fixture(files) {
  const root = await mkdtemp(join(tmpdir(), 'sandrone-architecture-'))
  for (const [relative, source] of Object.entries(files)) {
    const target = join(root, relative)
    await mkdir(join(target, '..'), { recursive: true })
    await writeFile(target, source)
  }
  return root
}

test('architecture gate accepts a thin official Harness client plugin', async t => {
  const root = await fixture({
    'packages/ui/client.jsx': "import { Button } from '@deepseek-ai/dsh-client-ui-primitives'\nexport function apply(ctx) { ctx.effect(() => ctx.slots.register({ name: 'shell.overlay' }, Button)) }\n",
  })
  t.after(() => rm(root, { recursive: true, force: true }))
  const report = await verifyArchitecture({ root })
  assert.deepEqual(report.violations, [])
})

test('architecture gate rejects legacy server, WebSocket and provider proxy code', async t => {
  const root = await fixture({
    'src/server/index.ts': 'export const oldServer = true\n',
    'apps/web/gateway.ts': "import { WebSocketServer } from 'ws'\nexport class ProviderProxy {}\n",
  })
  t.after(() => rm(root, { recursive: true, force: true }))
  const report = await verifyArchitecture({ root })
  assert.ok(report.violations.some(item => item.rule === 'legacy backend path'))
  assert.ok(report.violations.some(item => item.rule === 'parallel WebSocket transport'))
  assert.ok(report.violations.some(item => item.rule === 'parallel provider proxy'))
})

test('architecture gate rejects DeepSeek private src imports but permits public client exports', async t => {
  const root = await fixture({
    'packages/ui/bad.ts': "import x from '@deepseek-ai/dsh-client-runtime/src/client/index.ts'\n",
    'packages/ui/side-effect.ts': "import '@deepseek-ai/dsh-client-ui-theme/src/client/index.ts'\n",
    'packages/ui/good.ts': "import type {} from '@deepseek-ai/dsh-client-runtime/client'\n",
  })
  t.after(() => rm(root, { recursive: true, force: true }))
  const report = await verifyArchitecture({ root })
  const privateImports = report.violations.filter(item => item.rule === 'DeepSeek private source import')
  assert.equal(privateImports.length, 2)
  assert.deepEqual(privateImports.map(item => item.file).sort(), ['packages/ui/bad.ts', 'packages/ui/side-effect.ts'])
})
