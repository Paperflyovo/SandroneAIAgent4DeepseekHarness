import { pathToFileURL } from 'node:url'

const dshBin = process.env.SANDRONE_DSH_BIN
const encodedArgs = process.env.SANDRONE_DSH_ARGS
if (!dshBin || !encodedArgs) throw new Error('Harness runner is missing its launch contract')

const args = JSON.parse(encodedArgs)
if (!Array.isArray(args) || args.some(value => typeof value !== 'string')) {
  throw new TypeError('SANDRONE_DSH_ARGS must be a JSON string array')
}

delete process.env.SANDRONE_DSH_BIN
delete process.env.SANDRONE_DSH_ARGS
process.env.ELECTRON_RUN_AS_NODE = '1'
process.argv = [process.execPath, dshBin, ...args]

const shutdown = message => {
  if (message?.type === 'shutdown') process.emit('SIGTERM')
}

process.parentPort?.on('message', event => shutdown(event?.data))
process.on('message', shutdown)

await import(pathToFileURL(dshBin).href)
