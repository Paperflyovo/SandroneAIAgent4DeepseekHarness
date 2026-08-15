import { access, readFile, readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const skillName = 'sandrone-harness-frontend-lifecycle'
const skillRoot = join(root, 'skills', skillName)
const skillPath = join(skillRoot, 'SKILL.md')

function frontmatter(source) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(source)
  if (!match) return null
  const fields = new Map()
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(':')
    if (separator < 1) continue
    fields.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim())
  }
  return fields
}

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export async function verifySkill() {
  const errors = []
  const source = await readFile(skillPath, 'utf8')
  const fields = frontmatter(source)
  if (!fields) errors.push('SKILL.md has no valid YAML frontmatter block')
  else {
    const keys = [...fields.keys()]
    if (keys.some(key => key !== 'name' && key !== 'description')) {
      errors.push(`SKILL.md frontmatter has unsupported fields: ${keys.filter(key => key !== 'name' && key !== 'description').join(', ')}`)
    }
    if (fields.get('name') !== skillName) errors.push(`SKILL.md name must be ${skillName}`)
    if (!fields.get('description')?.includes('DeepSeek Harness')) errors.push('SKILL.md description must identify its DeepSeek Harness trigger')
  }

  const lines = source.split(/\r?\n/).length
  if (lines > 500) errors.push(`SKILL.md exceeds the 500-line progressive-disclosure budget (${lines})`)

  const links = [...source.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map(match => match[1])
  if (links.length === 0) errors.push('SKILL.md does not route readers to any bundled reference')
  for (const relative of links) {
    if (/^[a-z]+:/i.test(relative) || relative.startsWith('#')) continue
    if (!(await exists(join(skillRoot, relative)))) errors.push(`SKILL.md reference is missing: ${relative}`)
  }

  const referenceNames = (await readdir(join(skillRoot, 'references'))).sort()
  for (const expected of ['deepseek-runtime-evidence.md', 'review-checklist.md', 'spatiotemporal-composability.md']) {
    if (!referenceNames.includes(expected)) errors.push(`required Skill reference is missing: references/${expected}`)
  }

  const agentMetadata = await readFile(join(skillRoot, 'agents', 'openai.yaml'), 'utf8')
  if (!agentMetadata.includes('display_name: "Sandrone Harness Frontend Lifecycle"')) errors.push('agents/openai.yaml display_name is stale')
  if (!agentMetadata.includes(`$${skillName}`)) errors.push('agents/openai.yaml default_prompt does not invoke the Skill')

  return { skillRoot, files: 2 + referenceNames.length, lines, links, errors }
}

async function main() {
  const report = await verifySkill()
  if (report.errors.length > 0) {
    console.error(['Skill verification failed:', ...report.errors.map(error => `- ${error}`)].join('\n'))
    process.exitCode = 1
  } else {
    console.log(`Skill verification passed (${report.files} files, ${report.links.length} routed references)`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main()
