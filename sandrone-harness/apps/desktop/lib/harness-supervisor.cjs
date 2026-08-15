'use strict'

const { EventEmitter } = require('node:events')

const READY_LINE = /^dsh web: (http:\/\/127\.0\.0\.1:\d+)(?:\s|$)/

function deferred() {
  let resolve
  let reject
  const promise = new Promise((accept, decline) => {
    resolve = accept
    reject = decline
  })
  return { promise, resolve, reject }
}

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

function redact(line) {
  return String(line)
    .replace(/(\bauthorization\s*[:=]\s*)(?:bearer\s+)?[^\s,;}"']+/gi, '$1[redacted]')
    .replace(/((?:["']?)(?:api[_-]?key|apikey|token|secret)(?:["']?)\s*[:=]\s*(?:["']?))[^\s,;}"']+/gi, '$1[redacted]')
    .slice(0, 4_000)
}

function validateReadyUrl(value) {
  const url = new URL(value)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') {
    throw new Error(`Harness advertised a non-loopback URL: ${value}`)
  }
  const port = Number(url.port)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Harness advertised an invalid port: ${value}`)
  }
  return url.origin
}

class HarnessSupervisor extends EventEmitter {
  constructor(options) {
    super()
    if (typeof options?.launch !== 'function') throw new TypeError('launch must be a function')
    this.launch = options.launch
    this.readinessTimeoutMs = options.readinessTimeoutMs ?? 45_000
    this.stopTimeoutMs = options.stopTimeoutMs ?? 8_000
    this.restartDelaysMs = options.restartDelaysMs ?? [400, 1_000, 2_500]
    this.stableAfterMs = options.stableAfterMs ?? 60_000
    this.maxLogLines = options.maxLogLines ?? 200
    this.status = Object.freeze({ phase: 'idle', url: null, error: null, attempts: 0 })
    this.logs = []
    this.child = null
    this.generation = 0
    this.stopping = false
    this.restartTimer = null
    this.stableTimer = null
    this.startGate = null
    this.stopGate = null
    this.restartGate = null
    this.restartAttempts = 0
    this.finalStopRequested = false
  }

  snapshot() {
    return { ...this.status, logs: [...this.logs] }
  }

  setStatus(next) {
    const sanitized = typeof next?.error === 'string' ? { ...next, error: redact(next.error) } : next
    this.status = Object.freeze({ ...this.status, ...sanitized })
    this.emit('status', this.snapshot())
  }

  appendLog(stream, value) {
    const line = redact(value)
    if (!line) return
    this.logs.push(`[${stream}] ${line}`)
    if (this.logs.length > this.maxLogLines) this.logs.splice(0, this.logs.length - this.maxLogLines)
    this.emit('log', { stream, line })
  }

  async start() {
    if (this.finalStopRequested) throw new Error('Harness supervisor has been stopped')
    if (this.stopGate) {
      await this.stopGate
      return this.start()
    }
    if (this.status.phase === 'ready' && this.status.url) return this.status.url
    if (this.startGate) return this.startGate.promise
    this.stopping = false
    this.restartAttempts = 0
    const gate = deferred()
    this.startGate = gate
    this.spawn('starting')
    return gate.promise
  }

  spawn(phase) {
    const generation = ++this.generation
    let child
    try {
      child = this.launch({ generation })
    } catch (error) {
      this.failStart(error)
      return
    }
    this.child = child
    this.setStatus({ phase, url: null, error: null, attempts: this.restartAttempts })

    let stdoutBuffer = ''
    let stderrBuffer = ''
    const consume = (stream, chunk) => {
      if (generation !== this.generation) return
      const incoming = stream === 'stdout' ? stdoutBuffer + String(chunk) : stderrBuffer + String(chunk)
      const lines = incoming.split(/\r?\n/)
      const remainder = lines.pop() ?? ''
      if (stream === 'stdout') stdoutBuffer = remainder
      else stderrBuffer = remainder
      for (const line of lines) {
        this.appendLog(stream, line)
        if (stream === 'stdout') this.acceptReadyLine(generation, line)
      }
    }

    child.stdout?.on('data', chunk => consume('stdout', chunk))
    child.stderr?.on('data', chunk => consume('stderr', chunk))
    child.once('exit', code => {
      if (generation !== this.generation) return
      if (stdoutBuffer) {
        this.appendLog('stdout', stdoutBuffer)
        this.acceptReadyLine(generation, stdoutBuffer)
      }
      if (stderrBuffer) this.appendLog('stderr', stderrBuffer)
      this.onExit(generation, code)
    })

    const readinessTimer = setTimeout(() => {
      if (generation !== this.generation || this.status.phase === 'ready') return
      this.appendLog('supervisor', `readiness timed out after ${this.readinessTimeoutMs}ms`)
      child.kill()
      this.onUnreadyFailure(new Error('DeepSeek Harness did not become ready in time'))
    }, this.readinessTimeoutMs)
    readinessTimer.unref?.()
    child.once('exit', () => clearTimeout(readinessTimer))
  }

  acceptReadyLine(generation, line) {
    if (generation !== this.generation || this.status.phase === 'ready') return
    const match = READY_LINE.exec(line.trim())
    if (!match) return
    let url
    try {
      url = validateReadyUrl(match[1])
    } catch (error) {
      this.onUnreadyFailure(error)
      this.child?.kill()
      return
    }
    this.setStatus({ phase: 'ready', url, error: null, attempts: this.restartAttempts })
    this.startGate?.resolve(url)
    this.startGate = null
    clearTimeout(this.stableTimer)
    this.stableTimer = setTimeout(() => { this.restartAttempts = 0 }, this.stableAfterMs)
    this.stableTimer.unref?.()
    this.emit('ready', url)
  }

  onExit(generation, code) {
    if (generation !== this.generation) return
    this.child = null
    clearTimeout(this.stableTimer)
    if (this.stopping) return
    this.appendLog('supervisor', `Harness exited with code ${String(code)}`)
    if (this.status.phase !== 'ready' && this.startGate) {
      this.onUnreadyFailure(new Error(`DeepSeek Harness exited before readiness (code ${String(code)})`))
      return
    }
    this.scheduleRestart(new Error(`DeepSeek Harness stopped unexpectedly (code ${String(code)})`))
  }

  onUnreadyFailure(error) {
    if (this.stopping) return
    this.scheduleRestart(error)
  }

  scheduleRestart(error) {
    if (this.restartTimer || this.child) return
    if (this.restartAttempts >= this.restartDelaysMs.length) {
      this.failStart(error)
      return
    }
    const delay = this.restartDelaysMs[this.restartAttempts]
    this.restartAttempts += 1
    this.setStatus({
      phase: 'restarting',
      url: null,
      error: String(error?.message ?? error),
      attempts: this.restartAttempts,
    })
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      if (!this.stopping) this.spawn('restarting')
    }, delay)
    this.restartTimer.unref?.()
  }

  failStart(error) {
    const normalized = error instanceof Error ? error : new Error(String(error))
    const publicError = new Error(redact(normalized.message))
    this.setStatus({ phase: 'failed', url: null, error: publicError.message, attempts: this.restartAttempts })
    this.startGate?.reject(publicError)
    this.startGate = null
    this.emit('failed', publicError)
  }

  restart() {
    if (this.finalStopRequested) return Promise.reject(new Error('Harness supervisor has been stopped'))
    if (this.restartGate) return this.restartGate
    const operation = (async () => {
      await this.stop({ final: false })
      if (this.finalStopRequested) throw new Error('Harness supervisor has been stopped')
      return this.start()
    })()
    const settled = operation.finally(() => {
      if (this.restartGate === settled) this.restartGate = null
    })
    this.restartGate = settled
    return settled
  }

  stop(options = {}) {
    const final = options.final !== false
    if (final) this.finalStopRequested = true
    if (this.stopGate) {
      if (final) this.stopping = true
      return this.stopGate
    }
    const operation = this.performStop(final)
    const settled = operation.finally(() => {
      if (this.stopGate === settled) this.stopGate = null
    })
    this.stopGate = settled
    return settled
  }

  async performStop(final) {
    this.stopping = true
    clearTimeout(this.restartTimer)
    clearTimeout(this.stableTimer)
    this.restartTimer = null
    this.stableTimer = null
    this.generation += 1
    const child = this.child
    this.child = null
    if (child) {
      const exited = deferred()
      child.once('exit', code => exited.resolve(code))
      try {
        if (typeof child.postMessage === 'function') child.postMessage({ type: 'shutdown' })
        else child.send?.({ type: 'shutdown' })
      } catch (error) {
        this.appendLog('supervisor', `graceful shutdown request failed: ${String(error)}`)
      }
      const timeout = wait(this.stopTimeoutMs).then(() => 'timeout')
      if (await Promise.race([exited.promise, timeout]) === 'timeout') {
        this.appendLog('supervisor', 'graceful shutdown timed out; terminating child')
        child.kill()
        await Promise.race([exited.promise, wait(2_000)])
      }
    }
    this.startGate?.reject(new Error('Harness startup was cancelled'))
    this.startGate = null
    this.setStatus({ phase: 'idle', url: null, error: null, attempts: 0 })
    this.stopping = final || this.finalStopRequested
  }
}

module.exports = {
  HarnessSupervisor,
  READY_LINE,
  redact,
  validateReadyUrl,
}
