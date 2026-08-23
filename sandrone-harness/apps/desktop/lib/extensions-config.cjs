'use strict'

const fs = require('node:fs')
const path = require('node:path')

const MAX_TEXT = 4_096
const MAX_SECRET = 16_384
const MAX_ENTRIES = 64

const DEFAULT_EXTENSIONS_CONFIG = Object.freeze({
  version: 1,
  buddy: Object.freeze({
    enabled: true,
    name: 'Buddy',
    personality: '安静、可靠，在编码时陪伴你。',
    tone: '简短、温和、不过度打扰',
    muted: false,
    avatar: 'cat',
  }),
  mcp: Object.freeze({ servers: Object.freeze([]) }),
  skills: Object.freeze({ disabled: Object.freeze([]) }),
  plugins: Object.freeze({ managed: Object.freeze([]) }),
  im: Object.freeze({
    enabled: false,
    platform: 'qqbot',
    appId: '',
    secret: '',
    token: '',
    serverUrl: 'ws://127.0.0.1:3456',
    defaultWorkDir: '',
    allowedUsers: Object.freeze([]),
    autoStart: false,
  }),
})

function text(value, fallback = '', limit = MAX_TEXT) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : fallback
}

function identifier(value, fallback = '') {
  const normalized = text(value, fallback, 96)
  return /^[A-Za-z0-9@/_.-]+$/.test(normalized) ? normalized : fallback
}

function stringList(value, { limit = MAX_ENTRIES, itemLimit = 512 } = {}) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map(item => text(item, '', itemLimit)).filter(Boolean))].slice(0, limit)
}

function stringMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).slice(0, MAX_ENTRIES).flatMap(([key, entry]) => {
    const safeKey = text(key, '', 128)
    const safeValue = text(entry, '', MAX_SECRET)
    return safeKey ? [[safeKey, safeValue]] : []
  }))
}

function normalizeMcpServer(value, index) {
  const server = value && typeof value === 'object' ? value : {}
  const transport = server.transport === 'streamable-http' || server.transport === 'http'
    ? 'streamable-http'
    : 'stdio'
  const name = identifier(server.name || server.serverName, `server-${index + 1}`).replace(/^@/, '').slice(0, 32)
  return {
    id: identifier(server.id, `mcp-${name}`),
    name,
    enabled: server.enabled !== false,
    transport,
    command: text(server.command, '', 512),
    args: stringList(server.args, { itemLimit: 1_024 }),
    env: stringMap(server.env),
    cwd: text(server.cwd, '', 1_024),
    url: text(server.url, '', 2_048),
    headers: stringMap(server.headers),
  }
}

function normalizeManagedPlugin(value, index) {
  const plugin = value && typeof value === 'object' ? value : {}
  const name = identifier(plugin.name, '')
  let config = {}
  if (plugin.config && typeof plugin.config === 'object' && !Array.isArray(plugin.config)) {
    const serialized = JSON.stringify(plugin.config)
    if (serialized.length <= 32_768) config = JSON.parse(serialized)
  }
  return {
    id: identifier(plugin.id, `sandrone-plugin-${index + 1}`),
    name,
    enabled: plugin.enabled !== false && Boolean(name),
    config,
  }
}

function normalizeExtensionsConfig(value) {
  const input = value && typeof value === 'object' ? value : {}
  const buddy = input.buddy && typeof input.buddy === 'object' ? input.buddy : {}
  const mcp = input.mcp && typeof input.mcp === 'object' ? input.mcp : {}
  const skills = input.skills && typeof input.skills === 'object' ? input.skills : {}
  const plugins = input.plugins && typeof input.plugins === 'object' ? input.plugins : {}
  const im = input.im && typeof input.im === 'object' ? input.im : {}
  return {
    version: 1,
    buddy: {
      enabled: buddy.enabled !== false,
      name: text(buddy.name, DEFAULT_EXTENSIONS_CONFIG.buddy.name, 50),
      personality: text(buddy.personality, DEFAULT_EXTENSIONS_CONFIG.buddy.personality, 800),
      tone: text(buddy.tone, DEFAULT_EXTENSIONS_CONFIG.buddy.tone, 600),
      muted: buddy.muted === true,
      avatar: ['cat', 'robot', 'ghost', 'owl'].includes(buddy.avatar) ? buddy.avatar : 'cat',
    },
    mcp: {
      servers: (Array.isArray(mcp.servers) ? mcp.servers : []).slice(0, MAX_ENTRIES).map(normalizeMcpServer),
    },
    skills: { disabled: stringList(skills.disabled, { itemLimit: 128 }) },
    plugins: {
      managed: (Array.isArray(plugins.managed) ? plugins.managed : []).slice(0, MAX_ENTRIES).map(normalizeManagedPlugin),
    },
    im: {
      enabled: im.enabled === true,
      platform: 'qqbot',
      appId: text(im.appId, '', 256),
      secret: text(im.secret, '', MAX_SECRET),
      token: text(im.token, '', MAX_SECRET),
      serverUrl: text(im.serverUrl, DEFAULT_EXTENSIONS_CONFIG.im.serverUrl, 2_048),
      defaultWorkDir: text(im.defaultWorkDir, '', 1_024),
      allowedUsers: stringList(im.allowedUsers, { itemLimit: 128 }),
      autoStart: im.autoStart === true,
    },
  }
}

function readExtensionsConfig(filePath) {
  try {
    return normalizeExtensionsConfig(JSON.parse(fs.readFileSync(filePath, 'utf8')))
  } catch {
    return normalizeExtensionsConfig(DEFAULT_EXTENSIONS_CONFIG)
  }
}

function writeExtensionsConfig(filePath, value) {
  const normalized = normalizeExtensionsConfig(value)
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(normalized, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    fs.renameSync(temporary, filePath)
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }) } catch {}
    throw error
  }
  return normalized
}

function yamlScalar(value) {
  return JSON.stringify(String(value))
}

function yamlObject(value, indent) {
  const lines = []
  for (const [key, entry] of Object.entries(value)) {
    if (Array.isArray(entry)) {
      lines.push(`${indent}${key}: [${entry.map(yamlScalar).join(', ')}]`)
    } else if (entry && typeof entry === 'object') {
      lines.push(`${indent}${key}:`)
      lines.push(...yamlObject(entry, `${indent}  `))
    } else if (typeof entry === 'boolean' || typeof entry === 'number') {
      lines.push(`${indent}${key}: ${entry}`)
    } else {
      lines.push(`${indent}${key}: ${yamlScalar(entry)}`)
    }
  }
  return lines
}

function buildExtensionsPatch(config) {
  const normalized = normalizeExtensionsConfig(config)
  const entries = []
  for (const server of normalized.mcp.servers.filter(item => item.enabled)) {
    const serverConfig = server.transport === 'stdio'
      ? { serverName: server.name, transport: 'stdio', command: server.command, args: server.args, env: server.env, ...(server.cwd ? { cwd: server.cwd } : {}) }
      : { serverName: server.name, transport: 'streamable-http', url: server.url, headers: server.headers }
    if ((server.transport === 'stdio' && !server.command) || (server.transport === 'streamable-http' && !server.url)) continue
    entries.push({ id: server.id, name: '@deepseek-ai/dsh-mcp-client', config: serverConfig })
  }
  for (const plugin of normalized.plugins.managed.filter(item => item.enabled && item.name)) {
    entries.push({ id: plugin.id, name: plugin.name, config: plugin.config })
  }
  if (entries.length === 0) return '[]\n'
  const lines = ['- insert:']
  for (const entry of entries) {
    lines.push(`    - id: ${yamlScalar(entry.id)}`)
    lines.push(`      name: ${yamlScalar(entry.name)}`)
    if (Object.keys(entry.config).length > 0) {
      lines.push('      config:')
      lines.push(...yamlObject(entry.config, '        '))
    }
  }
  return `${lines.join('\n')}\n`
}

function writeExtensionsPatch(filePath, config) {
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  try {
    fs.writeFileSync(temporary, buildExtensionsPatch(config), 'utf8')
    fs.renameSync(temporary, filePath)
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }) } catch {}
    throw error
  }
  return filePath
}

function readSkillMeta(skillFile) {
  const source = fs.readFileSync(skillFile, 'utf8').slice(0, 16_384)
  const name = source.match(/^name:\s*(.+)$/m)?.[1]?.trim()
  const description = source.match(/^description:\s*["']?(.+?)["']?\s*$/m)?.[1]?.trim()
  return { name, description }
}

function scanSkills({ bundledRoot, dshHome, config }) {
  const disabled = new Set(normalizeExtensionsConfig(config).skills.disabled)
  const roots = [
    { root: bundledRoot, source: 'sandrone' },
    { root: path.join(dshHome, 'skills'), source: 'dsh' },
  ]
  const rows = new Map()
  for (const { root, source } of roots) {
    if (!fs.existsSync(root)) continue
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const skillFile = path.join(root, entry.name, 'SKILL.md')
      if (!fs.existsSync(skillFile)) continue
      let meta = {}
      try { meta = readSkillMeta(skillFile) } catch {}
      const key = `${source}:${entry.name}`
      rows.set(key, {
        key,
        name: meta.name || entry.name,
        directory: entry.name,
        description: meta.description || '未提供说明',
        source,
        path: skillFile,
        managed: source === 'sandrone',
        enabled: source !== 'sandrone' || !disabled.has(entry.name),
      })
    }
  }
  return [...rows.values()].sort((left, right) => left.name.localeCompare(right.name))
}

module.exports = {
  DEFAULT_EXTENSIONS_CONFIG,
  buildExtensionsPatch,
  normalizeExtensionsConfig,
  readExtensionsConfig,
  scanSkills,
  writeExtensionsConfig,
  writeExtensionsPatch,
}
