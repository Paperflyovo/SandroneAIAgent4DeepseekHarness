import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'

import supervisorModule from '../apps/desktop/lib/harness-supervisor.cjs'

const { HarnessSupervisor, redact, validateReadyUrl } = supervisorModule

class FakeStream extends EventEmitter {}

class FakeChild extends EventEmitter {
  constructor() {
    super()
    this.stdout = new FakeStream()
    this.stderr = new FakeStream()
    this.kills = 0
    this.messages = []
  }

  postMessage(message) {
    this.messages.push(message)
    queueMicrotask(() => this.emit('exit', 0))
  }

  kill() {
    this.kills += 1
    queueMicrotask(() => this.emit('exit', 1))
  }
}

function tick(milliseconds = 0) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

test('readiness accepts only an exact loopback HTTP origin', () => {
  assert.equal(validateReadyUrl('http://127.0.0.1:3080/path?q=1'), 'http://127.0.0.1:3080')
  assert.throws(() => validateReadyUrl('https://127.0.0.1:3080'), /non-loopback/)
  assert.throws(() => validateReadyUrl('http://localhost:3080'), /non-loopback/)
  assert.throws(() => validateReadyUrl('http://127.0.0.1:0'), /invalid port/)
})

test('supervisor resolves readiness split across stdout chunks and ignores stale generations', async t => {
  const children = []
  const supervisor = new HarnessSupervisor({
    launch: () => {
      const child = new FakeChild()
      children.push(child)
      return child
    },
    readinessTimeoutMs: 1_000,
    restartDelaysMs: [0],
    stableAfterMs: 1_000,
  })
  t.after(() => supervisor.stop())

  const started = supervisor.start()
  children[0].stdout.emit('data', 'dsh web: http://127.0.')
  children[0].stdout.emit('data', '0.1:43123\n')
  assert.equal(await started, 'http://127.0.0.1:43123')

  const first = children[0]
  first.emit('exit', 9)
  await tick(10)
  assert.equal(children.length, 2)
  first.stdout.emit('data', 'dsh web: http://127.0.0.1:49999\n')
  assert.notEqual(supervisor.snapshot().url, 'http://127.0.0.1:49999')
  children[1].stdout.emit('data', 'dsh web: http://127.0.0.1:43124\n')
  assert.equal(supervisor.snapshot().url, 'http://127.0.0.1:43124')
})

test('unexpected exit restarts only within the configured budget', async t => {
  const children = []
  const supervisor = new HarnessSupervisor({
    launch: () => {
      const child = new FakeChild()
      children.push(child)
      return child
    },
    readinessTimeoutMs: 1_000,
    restartDelaysMs: [0, 0],
    stableAfterMs: 10_000,
  })
  t.after(() => supervisor.stop())
  const failed = new Promise(resolve => supervisor.once('failed', resolve))
  const startup = supervisor.start()
  children[0].emit('exit', 2)
  await tick(5)
  children[1].emit('exit', 2)
  await tick(5)
  children[2].emit('exit', 2)
  await assert.rejects(startup, /exited before readiness/)
  await failed
  assert.equal(children.length, 3)
  assert.equal(supervisor.snapshot().phase, 'failed')
})

test('stop requests graceful shutdown and prevents a stale exit from restarting', async () => {
  const children = []
  const supervisor = new HarnessSupervisor({
    launch: () => {
      const child = new FakeChild()
      children.push(child)
      return child
    },
    readinessTimeoutMs: 1_000,
    restartDelaysMs: [0],
    stopTimeoutMs: 50,
  })
  const started = supervisor.start()
  children[0].stdout.emit('data', 'dsh web: http://127.0.0.1:41000\n')
  await started
  await supervisor.stop()
  await tick(5)
  assert.deepEqual(children[0].messages, [{ type: 'shutdown' }])
  assert.equal(children.length, 1)
  assert.equal(supervisor.snapshot().phase, 'idle')
})

test('manual restart isolates the old generation and deduplicates concurrent requests', async () => {
  const children = []
  const supervisor = new HarnessSupervisor({
    launch: () => {
      const child = new FakeChild()
      children.push(child)
      return child
    },
    readinessTimeoutMs: 1_000,
    restartDelaysMs: [0],
    stopTimeoutMs: 50,
  })
  const started = supervisor.start()
  children[0].stdout.emit('data', 'dsh web: http://127.0.0.1:41000\n')
  await started
  const oldChild = children[0]
  const firstRestart = supervisor.restart()
  const secondRestart = supervisor.restart()
  assert.equal(firstRestart, secondRestart)
  await tick()
  assert.equal(children.length, 2)
  oldChild.stdout.emit('data', 'dsh web: http://127.0.0.1:49999\n')
  oldChild.emit('exit', 9)
  assert.notEqual(supervisor.snapshot().url, 'http://127.0.0.1:49999')
  children[1].stdout.emit('data', 'dsh web: http://127.0.0.1:41001\n')
  assert.equal(await firstRestart, 'http://127.0.0.1:41001')
  await supervisor.stop()
})

test('a final stop wins a race with restart and permanently prevents relaunch', async () => {
  const children = []
  const supervisor = new HarnessSupervisor({
    launch: () => {
      const child = new FakeChild()
      children.push(child)
      return child
    },
    readinessTimeoutMs: 1_000,
    stopTimeoutMs: 50,
  })
  const started = supervisor.start()
  children[0].stdout.emit('data', 'dsh web: http://127.0.0.1:42000\n')
  await started
  const restart = supervisor.restart()
  const stop = supervisor.stop()
  await stop
  await assert.rejects(restart, /has been stopped/)
  await assert.rejects(supervisor.start(), /has been stopped/)
  await assert.rejects(supervisor.restart(), /has been stopped/)
  assert.equal(children.length, 1)
  assert.equal(supervisor.snapshot().phase, 'idle')
})

test('a final stop suppresses an old exit even while a non-final stop is already running', async () => {
  const children = []
  const supervisor = new HarnessSupervisor({
    launch: () => {
      const child = new FakeChild()
      child.postMessage = message => { child.messages.push(message) }
      children.push(child)
      return child
    },
    readinessTimeoutMs: 1_000,
    restartDelaysMs: [0],
    stopTimeoutMs: 50,
  })
  const started = supervisor.start()
  children[0].stdout.emit('data', 'dsh web: http://127.0.0.1:42001\n')
  await started
  const restart = supervisor.restart()
  const finalStop = supervisor.stop()
  children[0].emit('exit', 0)
  await finalStop
  await assert.rejects(restart, /has been stopped/)
  await tick(5)
  assert.equal(children.length, 1)
  assert.equal(supervisor.snapshot().phase, 'idle')
})

test('redaction removes common credential forms and bounds log size', () => {
  const output = redact('api_key=alpha token:beta secret = gamma Authorization: Bearer delta {"apiKey":"epsilon"}')
  for (const secret of ['alpha', 'beta', 'gamma', 'delta', 'epsilon']) assert.doesNotMatch(output, new RegExp(secret))
  assert.equal(redact('x'.repeat(5_000)).length, 4_000)
})

test('startup failures redact credentials before publishing status over IPC', async () => {
  const supervisor = new HarnessSupervisor({
    launch: () => { throw new Error('launch failed: token=top-secret') },
    restartDelaysMs: [],
  })
  await assert.rejects(supervisor.start(), /launch failed/)
  assert.doesNotMatch(supervisor.snapshot().error, /top-secret/)
})
