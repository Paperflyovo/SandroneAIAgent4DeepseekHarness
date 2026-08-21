import { access, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const required = ['package.json', 'pnpm-lock.yaml', 'scripts/build-ui.mjs']
for (const relative of required) await access(join(root, relative))

const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10)
if (nodeMajor < 22) throw new Error(`Node 22+ required, found ${process.versions.node}`)
let gitStatus = ''
try {
  gitStatus = execFileSync('git', ['status', '--short'], { cwd: root, encoding: 'utf8' }).trim()
} catch (error) {
  throw new Error(`git preflight failed: ${error.message}`)
}

console.log(`[preflight] root=${root}`)
console.log(`[preflight] package=${packageJson.name}@${packageJson.version}`)
console.log(`[preflight] node=${process.versions.node}`)
console.log(`[preflight] git=${gitStatus ? 'dirty (preserved)' : 'clean'}`)
