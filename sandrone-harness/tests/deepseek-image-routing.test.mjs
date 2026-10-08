import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'

const requireApp = createRequire(join(resolve(process.env.QA_APP_ROOT || resolve(import.meta.dirname, '..')), 'package.json'))
const [{ Context }, { default: LlmRuntime, createUserMessage }, { Config, DeepSeekAdapter, DeepSeekFileStore, DeepSeekUploadIndex, plainOptions, resolveAdapterOptions }] = await Promise.all(
  ['@deepseek-ai/cordis', '@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-llm-deepseek'].map(name => import(pathToFileURL(requireApp.resolve(name)).href)),
)

/**
 * Resolve adapter options from a config literal.
 *
 * 0.2.0 marks several fields `.volatile()`; `Config()` leaves those wrapped, and
 * `resolveAdapterOptions` validates the materialized values. Passing `Config(...)`
 * straight in fails on `defaultContextWindow` before it ever reaches the catalog,
 * so `plainOptions()` is the required step between them.
 */
const adapterOptions = value => resolveAdapterOptions(plainOptions(Config(value)))

test('renaming built-in DeepSeek models preserves inherited image capabilities', () => {
  // The 0.2.0 catalog is `deepseek-flash` (text+image) and `deepseek-v4-pro`
  // (text only); 0.1.5's `deepseek-v4-flash-vision-exp` no longer exists, so the
  // fixture pins the two entries that do and lets the third stand for an unknown id.
  // 0.2.0 also validates every config through its schema, so a raw options object is
  // no longer accepted — `adapterOptions` is the supported entry point.
  const models = adapterOptions({ models: [
    { id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash' },
    { id: 'deepseek-v4-pro', contextWindow: 500000 },
    { id: 'unknown-route' },
  ] }).models
  assert.deepEqual(models.map(model => model.inputModalities), [
    ['text', 'image'], ['text'], ['text'],
  ])
  assert.equal(models[0].name, 'DeepSeek-V4.1-Flash')
  assert.equal(models[1].contextWindow, 500000)
  // 0.2.0 dropped imagePixelBudget; imageMaxBytes remains the resolved budget.\n  assert.ok(models[0].imageMaxBytes > 0)
})

test('a catalog override never mutates the caller config', () => {
  const config = plainOptions(Config({ models: [
    { id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash' },
    { id: 'unknown-route' },
  ] }))
  const original = structuredClone(config)
  resolveAdapterOptions(config)
  assert.deepEqual(config, original)
})

test('explicit DeepSeek modality overrides remain authoritative', () => {
  const models = adapterOptions({ models: [
    { id: 'deepseek-flash', inputModalities: ['text'] },
    { id: 'custom-vision', inputModalities: ['text', 'image'] },
  ] }).models
  assert.deepEqual(models.map(model => model.inputModalities), [
    ['text'], ['text', 'image'],
  ])
})

test('renamed DeepSeek vision route uploads and sends durable images through the real LLM runtime', { timeout: 20000 }, async context => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=', 'base64')
  const digest = `sha256:${createHash('sha256').update(png).digest('hex')}`
  const attachment = { attachmentId: digest, mediaType: 'image/png', bytes: png.length, width: 1, height: 1 }
  const uploads = []
  const requests = []
  const failures = []
  const files = new Map()
  const server = createServer(async (request, response) => {
    try {
      const chunks = []
      for await (const chunk of request) chunks.push(chunk)
      const body = Buffer.concat(chunks)
      // messagesApiRoot() appends /v1 unless the path already ends with it.
      const path = String(request.url).replace(/^\/v1/u, '')
      if (path === '/files' && request.method === 'POST') {
        const form = await new Request('http://localhost/files', {
          method: 'POST', headers: { 'content-type': request.headers['content-type'] }, body,
        }).formData()
        const file = form.get('file')
        uploads.push(Buffer.from(await file.arrayBuffer()))
        // 0.2.0 validates the Files wire object strictly: `type: "file"`,
        // `mime_type`, `size_bytes`, and `created_at` as an ISO-8601 string.
        // The 0.1.5 shape (`object`/`bytes`/epoch-seconds `created_at`) is now
        // rejected as INVALID_RESPONSE, which silently degrades every request
        // back to inline base64.
        const record = { id: `file-fixture-${uploads.length}`, type: 'file', mime_type: file.type, size_bytes: file.size, filename: file.name, created_at: new Date().toISOString() }
        files.set(record.id, record)
        response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(record))
        return
      }
      if (path.startsWith('/files/')) {
        response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(files.get(path.slice(7))))
        return
      }
      // 0.2.0 makes the adapter Messages-only (`protocol` is no longer
      // configurable), so the fixture serves the Messages streaming protocol.
      assert.equal(path, '/messages')
      requests.push(JSON.parse(body.toString()))
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end([
        'event: message_start',
        'data: {"type":"message_start","message":{"id":"msg-fixture","role":"assistant","usage":{"input_tokens":1,"output_tokens":1}}}',
        '',
        'event: content_block_start',
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
        '',
        'event: content_block_delta',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"vision fixture"}}',
        '',
        'event: content_block_stop',
        'data: {"type":"content_block_stop","index":0}',
        '',
        // The Messages stream settles its stop reason here; `message_stop` alone
        // is rejected as malformed by the 0.2.0 translator.
        'event: message_delta',
        'data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":2}}',
        '',
        'event: message_stop',
        'data: {"type":"message_stop"}',
        '',
        '',
      ].join('\n'))
    } catch (error) {
      failures.push(error.message)
      response.writeHead(500).end('fixture failed')
    }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const runtime = new Context()
  context.after(async () => {
    await runtime.fiber.dispose()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  })
  let options = adapterOptions({ baseURL: `http://127.0.0.1:${server.address().port}`, models: [{ id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash' }] })
  await runtime.plugin(LlmRuntime)
  // 0.2.0 builds a throwaway `DeepSeekFileStore` per request unless `resolveFiles`
  // supplies one, and the reuse index lives on the store. The real provider
  // resolves a process-wide store, so the fixture must do the same or the same
  // image is uploaded once per request instead of being reused. The index is
  // redirected under `tmpdir()` because its default path is the user's real
  // `DSH_HOME`, which would both leak fixture records into it and let this test
  // reuse a previous run's ids instead of uploading.
  const storeRoot = await mkdtemp(join(tmpdir(), 'sandrone-image-routing-'))
  context.after(() => rm(storeRoot, { recursive: true, force: true }))
  const fileStore = new DeepSeekFileStore({ index: new DeepSeekUploadIndex(join(storeRoot, 'files-v3.json')) })
  const adapter = new DeepSeekAdapter({
    options: () => options,
    // 0.2.0 replaced the 0.1.5 `resolveApiKey` hook with `resolveAuth`, which
    // returns the credential headers captured for this request (plus an optional
    // `onRequestError` classifier). The old hook is simply never called, so
    // leaving it in place made every request fail as a transport error.
    resolveAuth: async () => ({ headers: { authorization: 'Bearer local-fixture' } }),
    resolveUserId: () => undefined,
    resolveFiles: () => fileStore,
    prepareExtensions: async () => ({ fields: {}, accept: async () => {} }),
    resolveAttachments: () => ({
      readImageRequest: async () => ({ variantId: digest, attachment, data: png, mediaType: 'image/png', bytes: png.length, width: 1, height: 1, depth: 'uchar', space: 'srgb', hasAlpha: true }),
    }),
  })
  runtime.llm.registerAdapter(['deepseek-official'], adapter)
  const message = createUserMessage({ content: [{ type: 'text', text: 'Inspect this image' }, { type: 'image', attachment }], source: { kind: 'plugin', plugin: 'test' } })
  const original = structuredClone(message)
  const run = async messages => {
    const chunks = []
    for await (const chunk of runtime.llm.stream({ provider: 'deepseek-official', model: 'deepseek-flash', messages })) chunks.push(chunk)
    assert.equal(chunks.at(-1)?.reason?.kind, 'stop', JSON.stringify(chunks.at(-1)))
  }
  await run([message])
  await run([message, createUserMessage({ content: [{ type: 'text', text: 'Inspect the same image again' }], source: { kind: 'plugin', plugin: 'test' } })])
  assert.deepEqual(failures, [])
  assert.deepEqual(uploads, [png])
  assert.equal(requests.length, 2)
  for (const request of requests) {
    // 0.2.0 references an uploaded image as an image block whose `source` is the
    // file id; 0.1.5 used a top-level `{ type: 'file', file_id }` block.
    assert.ok(request.messages.some(item => Array.isArray(item.content) && item.content.some(part => part.type === 'image' && part.source?.type === 'file' && part.source.file_id === 'file-fixture-1')))
    assert.doesNotMatch(JSON.stringify(request), /image omitted|accepts text only/)
  }
  assert.deepEqual(message, original)
  options = adapterOptions({ baseURL: options.baseURL, models: [{ id: 'deepseek-flash', inputModalities: ['text'] }] })
  await run([message])
  assert.match(JSON.stringify(requests.at(-1)), /image omitted because this model accepts text only/)
  assert.equal(uploads.length, 1)
  assert.deepEqual(message, original)
})
