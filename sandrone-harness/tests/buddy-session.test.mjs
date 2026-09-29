import assert from 'node:assert/strict'
import test from 'node:test'
import { openBuddyJournal } from '../packages/sandrone-ui/src/buddy-session.js'

function fixture(prompt) {
  let callbacks
  let closeCount = 0
  const controller = new AbortController()
  const history = []
  class EventSource {
    entries = []
    getSnapshot() { return { entries: this.entries } }
    replace(entries) { this.entries = entries }
    prepend(entries) { this.entries = [...entries, ...this.entries] }
    append(entry) { this.entries.push(entry) }
  }
  class Stream {
    constructor(remote, address, options) { callbacks = options }
    async open() { callbacks.publish({ type: 'replace', entries: [], hasMore: false }) }
    async dispose() { closeCount++ }
  }
  const append = (seq, type, data) => callbacks.publish({ type: 'append', entry: { event: { seq, type, data } } })
  const journal = openBuddyJournal({ session: { prompt: request => prompt(request, append) } }, 'buddy', {
    Stream, EventSource, signal: controller.signal, onHistory: messages => history.push(messages), onError() {},
  })
  return { journal, append, controller, history, callbacks, closeCount: () => closeCount }
}

test('Buddy handles a durable reply before prompt acknowledgement and restores authoritative history', async () => {
  const fixtureState = fixture(async (request, append) => {
    append(1, 'user/message', { content: request.content, source: { rpcId: request.requestId } })
    append(2, 'assistant/message', { message: { content: [{ type: 'text', text: 'reply' }] } })
    return { ok: true, value: { accepted: true } }
  })
  await fixtureState.journal.send('context\n\n用户现在对你说：hello')
  assert.deepEqual(fixtureState.history.at(-1).map(message => message.content), ['hello', 'reply'])
  fixtureState.callbacks.publish({ type: 'replace', entries: [{ event: { seq: 4, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'reconnected' }] } } } }], hasMore: false })
  assert.deepEqual(fixtureState.history.at(-1).map(message => message.content), ['reconnected'])
  await fixtureState.journal.dispose()
})

test('Buddy cancellation settles pending sends, disposes once, and blocks stale publications', async () => {
  const fixtureState = fixture(async () => ({ ok: true, value: { accepted: true } }))
  const pending = fixtureState.journal.send('hello')
  const rejected = assert.rejects(pending, { name: 'AbortError' })
  await new Promise(resolve => setImmediate(resolve))
  fixtureState.controller.abort()
  await rejected
  await fixtureState.journal.dispose()
  assert.equal(fixtureState.closeCount(), 1)
  const count = fixtureState.history.length
  fixtureState.append(9, 'assistant/message', { message: { content: [{ type: 'text', text: 'stale' }] } })
  assert.equal(fixtureState.history.length, count)
  await assert.rejects(fixtureState.journal.send('late'), { name: 'AbortError' })
})

test('Buddy ignores unrelated replies until its own admitted request and reports terminal errors', async () => {
  let activeRequest
  const fixtureState = fixture(async request => { activeRequest = request; return { ok: true, value: {} } })
  let completed = false
  const pending = fixtureState.journal.send('hello').finally(() => { completed = true })
  const rejected = assert.rejects(pending, /failed/)
  await new Promise(resolve => setImmediate(resolve))
  fixtureState.append(1, 'assistant/message', { message: { content: [{ type: 'text', text: 'unrelated' }] } })
  assert.equal(completed, false)
  fixtureState.append(2, 'user/message', { content: activeRequest.content, source: { rpcId: activeRequest.requestId } })
  fixtureState.append(3, 'agent/error', { message: 'failed' })
  await rejected
  await fixtureState.journal.dispose()
})
