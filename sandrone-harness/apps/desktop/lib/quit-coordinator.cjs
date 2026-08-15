'use strict'

function createQuitCoordinator(options) {
  if (typeof options?.shutdown !== 'function') throw new TypeError('shutdown must be a function')
  if (typeof options?.finish !== 'function') throw new TypeError('finish must be a function')
  const onError = typeof options.onError === 'function' ? options.onError : () => {}
  let quitPromise = null
  let complete = false

  return Object.freeze({
    handle(event) {
      if (complete) return quitPromise ?? Promise.resolve()
      event?.preventDefault?.()
      if (quitPromise) return quitPromise
      quitPromise = Promise.resolve()
        .then(options.shutdown)
        .catch(error => onError(error))
        .finally(() => {
          complete = true
          options.finish()
        })
      return quitPromise
    },
    snapshot() {
      return Object.freeze({ requested: quitPromise !== null, complete })
    },
  })
}

module.exports = { createQuitCoordinator }
