import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import test from 'node:test'

const root = resolve(import.meta.dirname, '..')

async function source(relative) {
  return readFile(join(root, ...relative.split('/')), 'utf8')
}

test('version-locked dependency patches remove declaration-based image rejection', async () => {
  const [hostPatch, piPatch, deepseekPatch, fsPatch, modelSelectionPatch, dshPatch, workspace] = await Promise.all([
    source('patches/@deepseek-ai__dsh-host-apiproxy@0.1.1-rc.1.patch'),
    source('patches/@deepseek-ai__dsh-llm-pi-ai@0.1.1-rc.1.patch'),
    source('patches/@deepseek-ai__dsh-llm-deepseek@0.1.1-rc.1.patch'),
    source('patches/@deepseek-ai__dsh-tool-fs@0.1.1-rc.1.patch'),
    source('patches/@deepseek-ai__dsh-client-ui-model-selection@0.1.1-rc.1.patch'),
    source('patches/@deepseek-ai__dsh@0.1.1-rc.1.patch'),
    source('pnpm-workspace.yaml'),
  ])
  assert.match(hostPatch, /^-.*MODEL_DOES_NOT_SUPPORT_IMAGES/m)
  assert.match(hostPatch, /^-.*does not accept image input, but this session already contains images/m)
  assert.match(piPatch, /^-.*does not support image input/m)
  assert.match(deepseekPatch, /^-.*does not accept image input/m)
  assert.match(fsPatch, /^-.*assertImageCapableRoute/m)
  assert.match(fsPatch, /^-.*does not declare image input/m)
  assert.match(modelSelectionPatch, /^\+.*snapshot\.status === "selecting"/m)
  assert.match(dshPatch, /^\+.*@sandrone\/harness-image-tools/m)
  for (const filename of [
    '@deepseek-ai__dsh-host-apiproxy@0.1.1-rc.1.patch',
    '@deepseek-ai__dsh-llm-pi-ai@0.1.1-rc.1.patch',
    '@deepseek-ai__dsh-llm-deepseek@0.1.1-rc.1.patch',
    '@deepseek-ai__dsh-tool-fs@0.1.1-rc.1.patch',
    '@deepseek-ai__dsh-client-ui-model-selection@0.1.1-rc.1.patch',
    '@deepseek-ai__dsh@0.1.1-rc.1.patch',
  ]) assert.match(workspace, new RegExp(filename.replaceAll('.', '\\.')))
})

test('installed adapters and filesystem tool admit durable images', async () => {
  const [host, pi, deepseek, fsTool, modelSelection, standardPreset] = await Promise.all([
    source('node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js'),
    source('node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js'),
    source('node_modules/@deepseek-ai/dsh-llm-deepseek/lib/index.js'),
    source('node_modules/@deepseek-ai/dsh-tool-fs/lib/index.js'),
    source('node_modules/@deepseek-ai/dsh-client-ui-model-selection/lib/client.js'),
    source('node_modules/@deepseek-ai/dsh/config/agent-presets/standard/agent.cordis.yml'),
  ])
  assert.doesNotMatch(host, /MODEL_DOES_NOT_SUPPORT_IMAGES|does not accept image input, but this session already contains images/)
  assert.doesNotMatch(pi, /pi-ai model .* does not support image input/)
  assert.match(pi, /const DEFAULT_INPUT = \["text", "image"\]/)
  assert.doesNotMatch(deepseek, /DeepSeek model .* does not accept image input/)
  assert.match(pi, /type:\s*['"]image['"][\s\S]*?Buffer\.from\(stored\.data\)\.toString\(['"]base64['"]\)[\s\S]*?mimeType:\s*stored\.ref\.mediaType/)
  assert.match(deepseek, /type:\s*['"]image_url['"][\s\S]*?data:\$\{stored\.ref\.mediaType\};base64,\$\{Buffer\.from\(stored\.data\)\.toString\(['"]base64['"]\)\}/)
  assert.doesNotMatch(fsTool, /assertImageCapableRoute|does not declare image input/)
  assert.match(fsTool, /Image admission is provider-owned/)
  assert.match(modelSelection, /snapshot\.routable === false \|\| snapshot\.status === "selecting"/)
  assert.match(standardPreset, /@sandrone\/harness-image-tools/)
})

test('unknown third-party pi-ai models default to image-capable requests', async () => {
  const [{ Config }, { transformMessages }] = await Promise.all([
    import('@deepseek-ai/dsh-llm-pi-ai'),
    import('@earendil-works/pi-ai/api/transform-messages'),
  ])
  const parsed = Config({
    providers: {
      gateway: {
        api: 'openai-responses',
        baseURL: 'https://gateway.example.test',
        models: [{ id: 'gpt-5.6-terra' }],
      },
      textOnly: {
        api: 'openai-responses',
        baseURL: 'https://text.example.test',
        defaultInput: ['text'],
        models: [{ id: 'text-model' }],
      },
    },
  })
  assert.deepEqual(parsed.providers.gateway.defaultInput, ['text', 'image'])
  assert.deepEqual(parsed.providers.textOnly.defaultInput, ['text'])

  const image = { type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' }
  const [message] = transformMessages(
    [{ role: 'user', content: [image] }],
    { input: parsed.providers.gateway.defaultInput },
    (id) => id,
  )
  assert.deepEqual(message.content, [image])
})

test('remote image tool rejects private targets and recognizes supported image magic', async () => {
  const { detectImageMediaType, isPublicAddress, parseRemoteImageUrl, resolvePublicTarget } = await import('../packages/sandrone-image-tools/src/index.js')
  assert.equal(isPublicAddress('8.8.8.8'), true)
  for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '::1', 'fc00::1']) {
    assert.equal(isPublicAddress(address), false)
  }
  assert.throws(() => parseRemoteImageUrl('file:///tmp/a.png'), /http or https/)
  assert.throws(() => parseRemoteImageUrl('http://user:pass@example.com/a.png'), /credentials/)
  assert.throws(() => parseRemoteImageUrl('http://localhost/a.png'), /localhost/)
  await assert.rejects(
    resolvePublicTarget(new URL('https://example.test/a.png'), async () => [{ address: '127.0.0.1', family: 4 }]),
    /non-public address/,
  )
  assert.equal(detectImageMediaType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'image/png')
  assert.equal(detectImageMediaType(Buffer.from('GIF89a')), 'image/gif')
  assert.equal(detectImageMediaType(Buffer.from('not an image')), undefined)
})

test('remote image tool downloads a pinned public target through Node lookup overloads', async () => {
  const { downloadRemoteImage, pinnedLookup } = await import('../packages/sandrone-image-tools/src/index.js')
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const calls = []
  const value = await downloadRemoteImage('https://images.example.test/avatar', {
    lookup: async () => [{ address: '8.8.8.8', family: 4 }],
    request: async (url, target) => {
      calls.push({ url: url.href, target })
      return { statusCode: 200, headers: {}, data: png }
    },
  })
  assert.deepEqual(calls, [{ url: 'https://images.example.test/avatar', target: { address: '8.8.8.8', family: 4 } }])
  assert.equal(value.mediaType, 'image/png')
  const lookup = pinnedLookup({ address: '8.8.8.8', family: 4 })
  await new Promise((resolve, reject) => lookup('images.example.test', (error, address, family) => {
    if (error) reject(error)
    else {
      assert.equal(address, '8.8.8.8')
      assert.equal(family, 4)
      resolve()
    }
  }))
  await new Promise((resolve, reject) => lookup('images.example.test', { all: true }, (error, addresses) => {
    if (error) reject(error)
    else {
      assert.deepEqual(addresses, [{ address: '8.8.8.8', family: 4 }])
      resolve()
    }
  }))
})
