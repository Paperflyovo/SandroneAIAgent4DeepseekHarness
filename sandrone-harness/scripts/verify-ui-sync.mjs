import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const source = await readFile(join(root, 'packages', 'sandrone-ui', 'src', 'client.css'), 'utf8')
const bundle = await readFile(join(root, 'packages', 'sandrone-ui', 'lib', 'client.js'), 'utf8')
const markers = [
  '.sandrone-settings-search',
  '.sandrone-image-attach-button',
  'sandrone-image-capability',
]
for (const marker of markers) {
  if (!source.includes(marker)) throw new Error(`source marker missing: ${marker}`)
  if (!bundle.includes(marker)) throw new Error(`compiled UI marker missing: ${marker}`)
}
console.log(`[verify:ui-sync] ${markers.length} markers present in source and bundle`)
