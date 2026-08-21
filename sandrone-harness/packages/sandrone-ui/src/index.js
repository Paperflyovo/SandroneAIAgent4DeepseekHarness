/** Host face for the browser-only Sandrone client plugin. */

const ESCALATION_FIELDS = ['sandbox_permissions', 'justification']

/**
 * Remove escalation-only arguments from a model-facing tool schema.
 *
 * In danger-full-access there is no wider mode to request. Keeping these
 * fields in the schema is actively harmful for strict OpenAI-compatible
 * adapters, which may promote every advertised property to `required`.
 */
export function stripUnavailableEscalationFields(tool) {
  if (tool === null || typeof tool !== 'object') return tool
  const parameters = tool.parameters
  if (parameters === null || typeof parameters !== 'object') return tool
  const properties = parameters.properties
  if (properties === null || typeof properties !== 'object') return tool

  const nextProperties = { ...properties }
  let changed = false
  for (const field of ESCALATION_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(nextProperties, field)) {
      delete nextProperties[field]
      changed = true
    }
  }
  if (!changed) return tool

  const nextParameters = { ...parameters, properties: nextProperties }
  if (Array.isArray(parameters.required)) {
    const required = parameters.required.filter((field) => !ESCALATION_FIELDS.includes(field))
    if (required.length === 0) delete nextParameters.required
    else nextParameters.required = required
  }
  return { ...tool, parameters: nextParameters }
}

/** Filter only the schema surface; the upstream tool implementations remain authoritative. */
export function filterToolSchemasForPolicy(tools, mode) {
  if (mode !== 'danger-full-access' || !Array.isArray(tools)) return tools
  return tools.map(stripUnavailableEscalationFields)
}

export const inject = ['sandboxPolicy']

export function apply(ctx) {
  return ctx.on('system-prompt/assemble', async (assembly, context, next) => {
    const assembled = await next()
    const agent = context?.agent
    const session = agent?.session
    if (session === undefined) return assembled

    const policy = ctx.sandboxPolicy.resolve({ session })
    if (policy.mode !== 'danger-full-access') return assembled

    return {
      ...assembled,
      tools: filterToolSchemasForPolicy(assembled.tools, policy.mode),
    }
  })
}
