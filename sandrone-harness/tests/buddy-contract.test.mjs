import assert from 'node:assert/strict'
import test from 'node:test'

import {
  chooseBuddyModel,
  collectBuddyActivity,
  lowestBuddyEffort,
  summarizeBuddyActivity,
} from '../packages/sandrone-ui/src/buddy.js'

test('Buddy activity keeps only bounded visible main-session signals', () => {
  const events = [
    { event: { type: 'session/title', data: { title: '重构设置页面' } } },
    { event: { type: 'user/message', data: { source: { kind: 'plugin' }, content: [{ type: 'text', text: '隐藏系统注入' }] } } },
    { event: { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '把侧边栏收好' }] } } },
    { event: { type: 'assistant/message', data: { message: { content: [{ type: 'reasoning', text: '不要泄露这段推理' }, { type: 'text', text: '正在修复布局。' }] } } } },
    { event: { type: 'tool/call', data: { name: 'Read', arguments: '{"secret":"ignored"}' } } },
    { event: { type: 'tool/call', data: { name: 'Edit', arguments: '{}' } } },
    { event: { type: 'todo/write', data: { todos: [{ content: '修复侧边栏', status: 'in_progress' }, { content: '完成构建', status: 'pending' }] } } },
  ]
  const activity = collectBuddyActivity(events, { values: { title: '旧标题' } })
  assert.equal(activity.sessionTitle, '重构设置页面')
  assert.equal(activity.latestUserMessage, '把侧边栏收好')
  assert.equal(activity.latestAssistantReply, '正在修复布局。')
  assert.deepEqual(activity.recentTools, ['Read', 'Edit'])
  assert.equal(activity.activeTaskCount, 2)
  assert.match(activity.latestTaskStatus, /修复侧边栏/)
  assert.doesNotMatch(activity.summary, /隐藏系统注入|不要泄露这段推理|secret/)
  assert.ok(activity.summary.length <= 700)
})

test('Buddy selects a fast model from the main session provider and lowest reasoning', () => {
  const selected = chooseBuddyModel({
    current: { provider: 'custom-route', model: 'deepseek-v4-pro', reasoningEffort: 'high' },
    groups: [{
      id: 'custom-route',
      models: [
        { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] } },
        { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', reasoning: { efforts: [{ id: 'disabled', name: '关闭' }, { id: 'low', name: 'Low' }] } },
      ],
    }],
  })
  assert.deepEqual(selected, { provider: 'custom-route', model: 'deepseek-v4-flash', reasoningEffort: 'disabled' })
})

test('Buddy falls back to the exact current model when no fast candidate exists', () => {
  const selected = chooseBuddyModel({
    current: { provider: 'custom-route', model: 'private-model' },
    groups: [{ id: 'custom-route', models: [{ id: 'private-model', name: 'Private Model' }] }],
  })
  assert.deepEqual(selected, { provider: 'custom-route', model: 'private-model' })
  assert.equal(lowestBuddyEffort({ reasoning: { efforts: [{ id: 'low', name: 'Low' }] } }), 'low')
  assert.equal(summarizeBuddyActivity({ latestUserMessage: 'x'.repeat(500) }).length <= 700, true)
})
