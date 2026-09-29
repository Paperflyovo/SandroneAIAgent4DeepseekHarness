import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'

const requireApp = createRequire(join(resolve(process.env.QA_APP_ROOT || resolve(import.meta.dirname, '..')), 'package.json'))
const [{ Context }, { default: LlmRuntime, createUserMessage }, { Config, DeepSeekAdapter, resolveAdapterOptions }] = await Promise.all(
  ['@deepseek-ai/cordis', '@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-llm-deepseek'].map(name => import(pathToFileURL(requireApp.resolve(name)).href)),
)

test('renaming built-in DeepSeek models preserves inherited image capabilities', () => {
  for (const parse of [value => value, Config]) {
    const config = parse({ models: [
      { id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash' },
      { id: 'deepseek-v4-flash-vision-exp', contextWindow: 500000 },
      { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro' },
      { id: 'unknown-route' },
    ] })
    const original = structuredClone(config)
    const models = resolveAdapterOptions(config).models
    assert.deepEqual(models.map(model => model.inputModalities), [
      ['text', 'image'], ['text', 'image'], ['text'], ['text'],
    ])
    assert.equal(models[0].name, 'DeepSeek-V4.1-Flash')
    assert.equal(models[1].contextWindow, 500000)
    assert.ok(models[0].imagePixelBudget > 0 && models[0].imageMaxBytes > 0)
    assert.deepEqual(config, original)
  }
})

test('explicit DeepSeek modality overrides remain authoritative', () => {
  const config = Config({ models: [
    { id: 'deepseek-flash', inputModalities: ['text'] },
    { id: 'custom-vision', inputModalities: ['text', 'image'] },
  ] })
  assert.deepEqual(resolveAdapterOptions(config).models.map(model => model.inputModalities), [
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
      if (request.url === '/files' && request.method === 'POST') {
        const form = await new Request('http://localhost/files', {
          method: 'POST', headers: { 'content-type': request.headers['content-type'] }, body,
        }).formData()
        const file = form.get('file')
        uploads.push(Buffer.from(await file.arrayBuffer()))
        const record = { id: `file-fixture-${uploads.length}`, object: 'file', bytes: file.size, filename: file.name, purpose: 'user_data', created_at: Math.floor(Date.now() / 1000), expires_at: Math.floor(Date.now() / 1000) + 604800 }
        files.set(record.id, record)
        response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(record))
        return
      }
      if (request.url.startsWith('/files/')) {
        response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(files.get(request.url.slice(7))))
        return
      }
      assert.equal(request.url, '/chat/completions')
      requests.push(JSON.parse(body.toString()))
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end('data: {"choices":[{"delta":{"role":"assistant","content":"vision fixture"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')
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
  let options = resolveAdapterOptions(Config({ baseURL: `http://127.0.0.1:${server.address().port}`, models: [{ id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash' }] }))
  await runtime.plugin(LlmRuntime)
  const adapter = new DeepSeekAdapter({
    options: () => options,
    resolveApiKey: async () => 'local-fixture',
    resolveUserId: () => undefined,
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
    assert.ok(request.messages.some(item => Array.isArray(item.content) && item.content.some(part => part.type === 'file' && part.file_id === 'file-fixture-1')))
    assert.doesNotMatch(JSON.stringify(request), /image omitted|accepts text only/)
  }
  assert.deepEqual(message, original)
  options = resolveAdapterOptions(Config({ baseURL: options.baseURL, models: [{ id: 'deepseek-flash', inputModalities: ['text'] }] }))
  await run([message])
  assert.match(JSON.stringify(requests.at(-1)), /image omitted because this model accepts text only/)
  assert.equal(uploads.length, 1)
  assert.deepEqual(message, original)
})
