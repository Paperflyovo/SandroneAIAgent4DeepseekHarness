import assert from 'node:assert/strict'
import test from 'node:test'

import {
  apply,
  filterToolSchemasForPolicy,
  stripUnavailableEscalationFields,
} from '../packages/sandrone-ui/src/index.js'

function escalationTool() {
  return {
    name: 'pwsh',
    description: 'Run PowerShell.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        sandbox_permissions: { type: 'string' },
        justification: { type: 'string' },
      },
      required: ['command', 'sandbox_permissions', 'justification'],
    },
  }
}

test('danger-full-access hides escalation arguments from strict tool schemas', () => {
  const source = escalationTool()
  const filtered = filterToolSchemasForPolicy([source], 'danger-full-access')

  assert.notStrictEqual(filtered, source)
  assert.notStrictEqual(filtered[0], source)
  assert.deepEqual(filtered[0].parameters.properties, {
    command: { type: 'string' },
  })
  assert.deepEqual(filtered[0].parameters.required, ['command'])
  assert.ok('sandbox_permissions' in source.parameters.properties)
  assert.deepEqual(source.parameters.required, ['command', 'sandbox_permissions', 'justification'])
})

test('confined policies keep escalation arguments available', () => {
  const tools = [escalationTool()]
  assert.strictEqual(filterToolSchemasForPolicy(tools, 'workspace-write'), tools)
  assert.strictEqual(filterToolSchemasForPolicy(tools, 'read-only'), tools)
})

test('tools without escalation arguments preserve their identity', () => {
  const tool = {
    name: 'read',
    description: 'Read a file.',
    parameters: { type: 'object', properties: { filePath: { type: 'string' } } },
  }
  assert.strictEqual(stripUnavailableEscalationFields(tool), tool)
})

test('plugin resolves the current session policy before filtering schemas', async () => {
  const source = escalationTool()
  const session = { id: 'session-1' }
  let listener
  let resolvedRequest
  const ctx = {
    on(event, callback) {
      assert.equal(event, 'system-prompt/assemble')
      listener = callback
      return () => {}
    },
    sandboxPolicy: {
      resolve(request) {
        resolvedRequest = request
        return { mode: 'danger-full-access', workspaceRoot: 'C:\\workspace' }
      },
    },
  }

  apply(ctx)
  const assembly = { sections: [], contexts: [], tools: [source], variables: {} }
  const result = await listener(assembly, { agent: { session } }, async () => assembly)

  assert.deepEqual(resolvedRequest, { session })
  assert.equal(result.tools[0].parameters.properties.sandbox_permissions, undefined)
})

test('agentless assemblies are left untouched', async () => {
  let listener
  const ctx = {
    on(_event, callback) {
      listener = callback
      return () => {}
    },
    sandboxPolicy: {
      resolve() {
        assert.fail('agentless assembly must not resolve a session policy')
      },
    },
  }
  apply(ctx)
  const assembly = { sections: [], contexts: [], tools: [escalationTool()], variables: {} }
  assert.strictEqual(await listener(assembly, {}, async () => assembly), assembly)
})
