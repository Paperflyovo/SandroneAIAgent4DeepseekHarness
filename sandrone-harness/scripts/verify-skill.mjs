import { access, readFile, readdir, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const skillsRoot = join(root, 'skills')
const supportedFrontmatter = new Set(['name', 'description', 'metadata'])

function frontmatter(source) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(source)
  if (!match) return null
  const fields = new Map()
  for (const line of match[1].split(/\r?\n/)) {
    if (/^\s/.test(line)) continue
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

async function countFiles(path) {
  let count = 0
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.isDirectory()) count += await countFiles(join(path, entry.name))
    else if (entry.isFile()) count += 1
  }
  return count
}

async function verifySkillRoot(skillRoot) {
  const errors = []
  const skillName = skillRoot.split(/[\\/]/).at(-1)
  const skillPath = join(skillRoot, 'SKILL.md')
  if (!(await exists(skillPath))) return { skillName, files: 0, lines: 0, links: 0, errors: ['SKILL.md is missing'] }

  const source = await readFile(skillPath, 'utf8')
  const fields = frontmatter(source)
  if (!fields) errors.push('SKILL.md has no valid YAML frontmatter block')
  else {
    const unsupported = [...fields.keys()].filter(key => !supportedFrontmatter.has(key))
    if (unsupported.length > 0) errors.push(`SKILL.md frontmatter has unsupported fields: ${unsupported.join(', ')}`)
    if (fields.get('name') !== skillName) errors.push(`SKILL.md name must be ${skillName}`)
    if (!fields.get('description')) errors.push('SKILL.md description is required')
  }

  const lines = source.split(/\r?\n/).length
  if (lines > 500) errors.push(`SKILL.md exceeds the 500-line progressive-disclosure budget (${lines})`)

  const links = [...source.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map(match => match[1])
  for (const relative of links) {
    if (/^[a-z]+:/i.test(relative) || relative.startsWith('#')) continue
    if (!(await exists(join(skillRoot, relative)))) errors.push(`SKILL.md reference is missing: ${relative}`)
  }

  const referencesRoot = join(skillRoot, 'references')
  if (await exists(referencesRoot)) {
    for (const referenceName of (await readdir(referencesRoot)).sort()) {
      const referencePath = join(referencesRoot, referenceName)
      if (!(await stat(referencePath)).isFile()) continue
      const relative = `references/${referenceName}`
      if (!links.includes(relative)) errors.push(`bundled reference is not routed from SKILL.md: ${relative}`)
    }
  }

  const agentPath = join(skillRoot, 'agents', 'openai.yaml')
  if (!(await exists(agentPath))) errors.push('agents/openai.yaml is missing')
  else {
    const agentMetadata = await readFile(agentPath, 'utf8')
    if (!agentMetadata.includes('display_name:')) errors.push('agents/openai.yaml has no display_name')
    if (!agentMetadata.includes(`$${skillName}`)) errors.push('agents/openai.yaml default_prompt does not invoke the Skill')
  }

  return { skillName, files: await countFiles(skillRoot), lines, links, errors }
}

export async function verifySkills() {
  const entries = await readdir(skillsRoot, { withFileTypes: true })
  const roots = entries.filter(entry => entry.isDirectory()).map(entry => join(skillsRoot, entry.name)).sort()
  const reports = []
  for (const skillRoot of roots) reports.push(await verifySkillRoot(skillRoot))
  return reports
}

export async function verifySkill(skillName = 'sandrone-harness-frontend-lifecycle') {
  return verifySkillRoot(join(skillsRoot, skillName))
}

async function main() {
  const reports = await verifySkills()
  const failures = reports.filter(report => report.errors.length > 0)
  if (failures.length > 0) {
    console.error(failures.flatMap(report => [
      `${report.skillName} verification failed:`,
      ...report.errors.map(error => `- ${error}`),
    ]).join('\n'))
    process.exitCode = 1
  } else {
    const files = reports.reduce((total, report) => total + report.files, 0)
    const links = reports.reduce((total, report) => total + report.links.length, 0)
    console.log(`Skill verification passed (${reports.length} skills, ${files} files, ${links} routed references)`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main()
