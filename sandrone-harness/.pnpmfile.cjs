'use strict'

const version = '0.1.5-rc.1'

module.exports = {
  hooks: {
    readPackage(manifest) {
      for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
        for (const name of Object.keys(manifest[section] ?? {})) {
          if (name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-')) {
            manifest[section][name] = version
          }
        }
      }
      return manifest
    },
  },
}
