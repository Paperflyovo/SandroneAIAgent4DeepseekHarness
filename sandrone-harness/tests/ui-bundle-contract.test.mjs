import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import test from 'node:test'

const root = resolve(import.meta.dirname, '..')

test('UI package self-registers as a Web client plugin using only public dependencies', async () => {
  const manifest = JSON.parse(await readFile(join(root, 'packages/sandrone-ui/package.json'), 'utf8'))
  assert.equal(manifest.dsh?.client?.platform, 'web')
  assert.ok(manifest.exports?.['./client'])
  assert.deepEqual(manifest.dsh.client.inject, [
    '@deepseek-ai/dsh-client-runtime',
    '@deepseek-ai/dsh-client-ui-layout',
    '@deepseek-ai/dsh-client-ui-theme',
  ])
  for (const [name, version] of Object.entries(manifest.peerDependencies)) {
    if (name.startsWith('@deepseek-ai/dsh')) assert.equal(version, '0.1.0-rc.6')
  }
})

test('source registers theme and overlay through reversible Harness effects', async () => {
  const source = await readFile(join(root, 'packages/sandrone-ui/src/client.jsx'), 'utf8')
  assert.match(source, /import\s+React,\s*\{[^}]*useEffect[^}]*useState[^}]*\}\s+from\s+['"]react['"]/)
  assert.match(source, /export\s+const\s+inject\s*=\s*\[['"]slots['"],\s*['"]theme['"]\]/)
  assert.match(source, /ctx\.effect\s*\(/)
  assert.match(source, /ctx\.theme\.overrideTokens\s*\(/)
  assert.match(source, /ctx\.slots\.inject\s*\(\s*['"]shell\.overlay['"]/)
  assert.match(source, /ctx\.slots\.register\s*\(/)
  assert.doesNotMatch(source, /@deepseek-ai\/[^'"\s]+\/src\//)
  assert.doesNotMatch(source, /\b(?:SessionEvent|WebSocket|providerProxy)\b/)
})

test('built client bundle self-registers and stylesheet ownership is reversible', async () => {
  const bundle = await readFile(join(root, 'packages/sandrone-ui/lib/client.js'), 'utf8')
  assert.match(bundle, /__ModuleLoader__\.load\(\{\s*id:\s*['"]@sandrone\/harness-ui['"]/)
  assert.match(bundle, /ctx\.effect\s*\(/)
  assert.match(bundle, /ctx\.slots\.register\s*\(/)
  assert.match(bundle, /data-plugin-css|dataset\.pluginCss/)
  assert.match(bundle, /removeChild|\.remove\(\)/)
})

test('UI build script inserts CSS through an effect-owned disposer at a stable marker', async () => {
  const source = await readFile(join(root, 'scripts/build-ui.mjs'), 'utf8')
  assert.match(source, /data-plugin-css|dataset\.pluginCss/)
  assert.match(source, /removeChild|\.remove\(\)/)
  assert.match(source, /ctx\.effect|export\s+function\s+apply/)
  assert.doesNotMatch(source, /bundle\.replace\(\s*['"]var module = \{['"]/)
})
