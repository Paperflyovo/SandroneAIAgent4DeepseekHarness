import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('built Sandrone client bundle provides the CommonJS loader scope', async () => {
  const bundle = await readFile(new URL('../packages/sandrone-ui/lib/client.js', import.meta.url), 'utf8')
  assert.match(bundle, /var module = \{ exports: \{\} \}; var exports = module\.exports;/)
  assert.match(bundle, /window\.__ModuleLoader__\.load\(\{ id: "@sandrone\/harness-ui"/)
  assert.match(bundle, /return module\.exports; \} \}\);/)
})
