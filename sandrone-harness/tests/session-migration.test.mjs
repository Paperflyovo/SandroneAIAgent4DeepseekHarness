import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, access, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { zstdCompress } from 'node:zlib'
import test from 'node:test'
const requireRuntime = createRequire(process.env.QA_APP_ROOT ? join(process.env.QA_APP_ROOT, 'package.json') : import.meta.url)
const { Context } = await import(pathToFileURL(requireRuntime.resolve('@deepseek-ai/cordis')).href)
const { default: JsonlSessionPersistence } = await import(pathToFileURL(requireRuntime.resolve('@deepseek-ai/dsh-session-persistence-jsonl')).href)

const compress = promisify(zstdCompress)
const event = (type, seq, data, extra = {}) => ({ type, seq, time: 100 + seq, data, ...extra })
const message = (role, text) => ({ id: text, role, content: [{ type: 'text', text }], source: role === 'user' ? { kind: 'user' } : { kind: 'model', provider: 'mock', model: 'mock' } })

for (const [label, row] of [
  ['unknown permission origin', event('permission/preset', 0, { preset: 'read-only', origin: 'unknown' })],
  ['unknown permission field', event('permission/preset', 0, { preset: 'read-only', origin: 'selection', unknown: true })],
  ['unknown descriptor version', event('subagent/descriptor', 0, { version: 99, mode: 'one-shot', provider: 'in-process' })],
  ['new field in legacy descriptor', event('subagent/descriptor', 0, { version: 2, mode: 'continuable', provider: 'in-process', label: 'child', agentReasoningEffort: 'high' })],
]) {
  test(`migration rejects ${label} without touching source`, async t => {
    const root = await mkdtemp(join(tmpdir(), 'sandrone-invalid-migration-'))
    const context = new Context()
    t.after(async () => { await context.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
    const id = 'invalid-history'
    const directory = join(root, '_no-cwd', id)
    await mkdir(directory, { recursive: true })
    const source = join(directory, 'session.jsonl')
    const original = Buffer.from([JSON.stringify({ type: 'session', version: 0, id, createdAt: 1, delegationDepth: 0 }), JSON.stringify(row), ''].join('\n'))
    await writeFile(source, original)
    await context.plugin(JsonlSessionPersistence, { root, compression: 'none' })
    await assert.rejects(context.sessionPersistence.open(id, 'write'), /origin|unexpected member|unsupported descriptor/)
    assert.deepEqual(await readFile(source), original)
    await assert.rejects(access(join(directory, 'session.v3.jsonl')), { code: 'ENOENT' })
  })
}

for (const compression of ['none', 'zstd']) {
  test(`published runtime migrates V0 history and reopens V3 (${compression})`, async t => {
    const root = await mkdtemp(join(tmpdir(), 'sandrone-migration-'))
    const contexts = []
    t.after(async () => {
      for (const context of contexts) await context.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    })
    const id = 'legacy-history'
    const directory = join(root, '_no-cwd', id)
    await mkdir(directory, { recursive: true })
    const suffix = compression === 'none' ? 'jsonl' : 'jsonl.zstd'
    const source = join(directory, `session.${suffix}`)
    const successor = join(directory, `session.v3.${suffix}`)
    const rows = [
      event('turn/start', 0, { turn: 1 }),
      event('step/start', 1, { turn: 1, step: 1 }),
      event('user/message', 2, message('user', '历史问题'), { surfaceOp: 'append' }),
      event('request/header', 3, { header: { config: { provider: 'mock', model: 'mock' }, system: 'test' }, reason: 'change' }),
      { type: 'text-chunks', seq0: 4, time0: 104, data: { turn: 1, step: 1, index: 0, dt: [1, 1], texts: ['历', '史', '回答'] } },
      event('assistant/chunk', 7, { turn: 1, step: 1, chunk: { type: 'finish', reason: { kind: 'stop' } } }),
      event('assistant/message', 8, { turn: 1, step: 1, message: message('assistant', '历史回答') }, { surfaceOp: 'append', sourceEventSeqs: [[4, 7]] }),
      event('step/end', 9, { turn: 1, step: 1 }),
      event('turn/end', 10, { turn: 1, reason: { kind: 'completed' } }),
      event('permission/preset', 11, { preset: 'workspace-write', origin: 'default' }),
      event('permission/preset', 12, { preset: 'read-only', origin: 'selection' }),
      event('permission/preset', 13, { preset: 'read-only', origin: 'inferred' }),
      event('subagent/descriptor', 14, { version: 2, mode: 'continuable', provider: 'in-process', label: 'legacy child', agentProvider: 'mock', agentModel: 'mock', persona: 'legacy persona', toolFilter: { deny: ['pwsh'] } }),
    ]
    const header = JSON.stringify({ type: 'session', version: 0, id, createdAt: 1, delegationDepth: 0 }) + '\n'
    const body = rows.map(row => JSON.stringify(row)).join('\n') + '\n'
    const original = compression === 'none' ? Buffer.from(header + body) : Buffer.concat([await compress(header), await compress(body)])
    await writeFile(source, original)
    const context = new Context()
    contexts.push(context)
    await context.plugin(JsonlSessionPersistence, { root, compression })
    const read = await context.sessionPersistence.open(id, 'read')
    assert.equal(read.header.version, 3)
    const migrated = (await read.read()).events
    assert.deepEqual(migrated.filter(row => row.type === 'permission/preset').map(row => row.data), rows.filter(row => row.type === 'permission/preset').map(row => row.data))
    assert.deepEqual(migrated.find(row => row.type === 'subagent/descriptor').data, { ...rows.at(-1).data, version: 3 })
    assert.ok(migrated.some(row => row.type === 'assistant/message' && row.data.message.content.some(block => block.text === '历史回答')))
    await read.close()
    await assert.rejects(access(successor), { code: 'ENOENT' })
    const write = await context.sessionPersistence.open(id, 'write')
    assert.deepEqual((await write.read()).events, migrated)
    await write.close()
    await context.sessionPersistence.flush()
    await access(successor)
    assert.deepEqual(await readFile(source), original)
    await context.fiber.dispose()
    const fresh = new Context()
    contexts.push(fresh)
    await fresh.plugin(JsonlSessionPersistence, { root, compression })
    const restored = await fresh.sessionPersistence.open(id, 'read')
    assert.equal(restored.header.version, 3)
    assert.deepEqual((await restored.read()).events, migrated)
    await restored.close()
  })
}
