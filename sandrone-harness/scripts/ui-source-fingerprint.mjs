import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const UI_BUILD_INPUTS = [
  ['src', 'client.jsx'],
  ['src', 'client.css'],
  ['src', 'index.js'],
  ['src', 'assets', 'header-bg.png'],
  ['src', 'assets', 'header-bg-dark.png'],
]

export async function fingerprintUiSources(packageRoot) {
  const hash = createHash('sha256')
  for (const segments of UI_BUILD_INPUTS) {
    const relativePath = segments.join('/')
    hash.update(relativePath)
    hash.update('\0')
    hash.update(await readFile(join(packageRoot, ...segments)))
    hash.update('\0')
  }
  return hash.digest('hex')
}
