import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fingerprintUiSources } from './ui-source-fingerprint.mjs'

const root = resolve(import.meta.dirname, '..')
const packageRoot = join(root, 'packages', 'sandrone-ui')
const bundle = await readFile(join(packageRoot, 'lib', 'client.js'), 'utf8')
const expectedFingerprint = await fingerprintUiSources(packageRoot)
const fingerprintMatch = bundle.match(/sandrone-ui-source-sha256:([a-f0-9]{64})/)

if (!fingerprintMatch) throw new Error('compiled UI fingerprint missing; rebuild with pnpm run build:ui')
if (fingerprintMatch[1] !== expectedFingerprint) {
  throw new Error(`compiled UI is stale: expected ${expectedFingerprint}, found ${fingerprintMatch[1]}`)
}

console.log(`[verify:ui-sync] source fingerprint ${expectedFingerprint} matches bundle`)
