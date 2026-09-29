'use strict'

const fs = require('node:fs')

const RETRY_DELAYS_MS = [25, 50, 100, 200, 400, 400, 400, 400]
const RETRYABLE_ERRORS = new Set(['EPERM', 'EACCES', 'EBUSY'])

function renameWithRetrySync(source, destination) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      fs.renameSync(source, destination)
      return
    } catch (error) {
      if (process.platform !== 'win32' || !RETRYABLE_ERRORS.has(error.code) || attempt >= RETRY_DELAYS_MS.length) {
        throw error
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, RETRY_DELAYS_MS[attempt])
    }
  }
}

module.exports = { renameWithRetrySync }
