import { contentText } from './buddy.js'

export function remoteValue(result) {
  if (!result?.ok) throw new Error(result?.error?.message || 'Harness 请求失败')
  return result.value
}

export function buddyMessages(entries) {
  return entries.flatMap(entry => {
    const event = entry?.event
    if (event?.type === 'assistant/message') {
      const content = contentText(event.data?.message?.content)
      return content ? [{ id: String(event.seq), role: 'buddy', content }] : []
    }
    if (event?.type !== 'user/message') return []
    const text = contentText(event.data?.content)
    const marker = '\n\n用户现在对你说：'
    const content = text.includes(marker) ? text.slice(text.lastIndexOf(marker) + marker.length) : text
    return content ? [{ id: String(event.seq), role: 'user', content }] : []
  }).slice(-40)
}

export function openBuddyJournal(remote, sessionId, { Stream, EventSource, signal, onHistory, onError }) {
  const source = new EventSource()
  const listeners = new Set()
  let disposed = false
  let failure
  let closing
  const publish = () => {
    if (disposed) return
    onHistory(buddyMessages(source.getSnapshot().entries))
    for (const listener of listeners) listener()
  }
  const stream = new Stream(remote, { kind: 'session', sessionId }, {
    publish(change) {
      if (disposed) return
      if (change.type === 'replace') source.replace(change.entries, change.hasMore)
      else if (change.type === 'prepend') source.prepend(change.entries, change.hasMore)
      else if (change.type === 'append') source.append(change.entry)
      else return
      publish()
    },
    failed(error) {
      if (disposed) return
      failure = error instanceof Error ? error : new Error(error?.message || String(error))
      onError(failure)
      for (const listener of listeners) listener()
    },
  })
  const dispose = () => {
    if (closing) return closing
    disposed = true
    signal.removeEventListener('abort', abort)
    for (const listener of listeners) listener()
    listeners.clear()
    closing = Promise.resolve(stream.dispose())
    return closing
  }
  const abort = () => { void dispose().catch(() => {}) }
  signal.addEventListener('abort', abort, { once: true })
  const ready = signal.aborted
    ? dispose().then(() => signal.throwIfAborted())
    : stream.open({ maxMessages: 40 })
  const send = async content => {
    await ready
    signal.throwIfAborted()
    if (disposed) throw new DOMException('Buddy 请求已取消', 'AbortError')
    const before = Math.max(-1, ...source.getSnapshot().entries.map(entry => entry.event.seq))
    const requestId = crypto.randomUUID()
    remoteValue(await remote.session.prompt({ sessionId, requestId, mode: 'queue', content: [{ type: 'text', text: content }], clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }, signal))
    signal.throwIfAborted()
    return new Promise((resolve, reject) => {
      const finish = error => {
        clearTimeout(timer)
        listeners.delete(check)
        if (error) reject(error)
        else resolve()
      }
      const check = () => {
        if (disposed || signal.aborted) return finish(new DOMException('Buddy 请求已取消', 'AbortError'))
        if (failure) return finish(failure)
        const entries = source.getSnapshot().entries
        const admitted = entries.find(entry => entry.event.seq > before && entry.event.type === 'user/message' && entry.event.data?.source?.rpcId === requestId)
        if (!admitted) return
        const reply = entries.find(entry => entry.event.seq > admitted.event.seq && entry.event.type === 'assistant/message')
        const terminal = entries.find(entry => entry.event.seq > admitted.event.seq && ['agent/error', 'turn/end'].includes(entry.event.type))
        if (reply) finish()
        else if (terminal) finish(new Error(terminal.event.data?.message || 'Buddy 本轮未生成回复'))
      }
      const timer = setTimeout(() => finish(new Error('Buddy 回复等待超时，稍后可重新打开查看')), 120_000)
      listeners.add(check)
      check()
    })
  }
  return { ready, send, dispose }
}
