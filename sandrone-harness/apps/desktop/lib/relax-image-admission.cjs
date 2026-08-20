'use strict'

const fs = require('node:fs')
const path = require('node:path')

function patchFile(file, replacements) {
  if (!fs.existsSync(file)) return false
  let source = fs.readFileSync(file, 'utf8')
  let changed = false
  for (const [from, to] of replacements) {
    if (!source.includes(from) || source.includes(to)) continue
    source = source.replace(from, to)
    changed = true
  }
  if (changed) {
    try { fs.writeFileSync(file, source) } catch { return false }
  }
  return changed
}

function relaxImageAdmission(root) {
  const host = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-host-apiproxy', 'lib', 'index.js')
  const piAi = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-llm-pi-ai', 'lib', 'index.js')
  const deepseek = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-llm-deepseek', 'lib', 'index.js')
  patchFile(host, [
    [
      'if (modelInfo.inputModalities !== void 0 && !modelInfo.inputModalities.includes("image")) return err(request, {',
      'if (false && modelInfo.inputModalities !== void 0 && !modelInfo.inputModalities.includes("image")) return err(request, {',
    ],
    [
      'if (info.inputModalities !== void 0 && !info.inputModalities.includes("image")) return err(request, {',
      'if (false && info.inputModalities !== void 0 && !info.inputModalities.includes("image")) return err(request, {',
    ],
  ])
  patchFile(piAi, [[
    'if (containsImage && !model.input.includes("image")) throw new LlmError(`pi-ai model "${model.id}" does not support image input`, "UNSUPPORTED_CONTENT");',
    'if (false && containsImage && !model.input.includes("image")) throw new LlmError(`pi-ai model "${model.id}" does not support image input`, "UNSUPPORTED_CONTENT");',
  ]])
  patchFile(deepseek, [[
    'if (contentHasImage(blocks)) throw new LlmError("The DeepSeek chat-completions adapter does not support image content.", "UNSUPPORTED_CONTENT");',
    'if (false && contentHasImage(blocks)) throw new LlmError("The DeepSeek chat-completions adapter does not support image content.", "UNSUPPORTED_CONTENT");',
  ]])
}

module.exports = { relaxImageAdmission }
