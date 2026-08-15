import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageRoot = join(root, 'packages', 'sandrone-ui')
const output = join(packageRoot, 'lib')
const packageId = '@sandrone/harness-ui'
const headerImages = {
  light: `data:image/png;base64,${(await readFile(join(packageRoot, 'src', 'assets', 'header-bg.png'))).toString('base64')}`,
  dark: `data:image/png;base64,${(await readFile(join(packageRoot, 'src', 'assets', 'header-bg-dark.png'))).toString('base64')}`,
}

await mkdir(output, { recursive: true })
await build({
  entryPoints: [join(packageRoot, 'src', 'client.jsx')],
  outfile: join(output, 'client.js'),
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: ['chrome140'],
  sourcemap: false,
  external: [
    'react',
    'react/jsx-runtime',
    'react-dom',
    'react-dom/client',
    '@deepseek-ai/cordis',
    '@deepseek-ai/dsh-client-ui-slots',
    '@deepseek-ai/dsh-client-web-react',
    '@deepseek-ai/dsh-client-ui-primitives',
    '@deepseek-ai/dsh-client-ui-attachment',
    '@deepseek-ai/dsh-client-schema-form',
    '@deepseek-ai/dsh-client-runtime/client',
  ],
  plugins: [{
    name: 'sandrone-css-text',
    setup(build) {
      build.onLoad({ filter: /client\.css$/ }, async ({ path }) => ({
        contents: [
          `const css = ${JSON.stringify((await readFile(path, 'utf8'))
            .replaceAll('__SANDRONE_HEADER_LIGHT__', headerImages.light)
            .replaceAll('__SANDRONE_HEADER_DARK__', headerImages.dark))};`,
          'export function installStyle(ctx) {',
          "  ctx.effect(() => {",
          "    const tag = document.createElement('style');",
          `    tag.dataset.plugin = ${JSON.stringify(packageId)};`,
          `    tag.dataset.pluginCss = ${JSON.stringify(`${packageId}/client.css`)};`,
          '    tag.textContent = css;',
          '    document.head.appendChild(tag);',
          '    return () => tag.remove();',
          "  }, 'sandrone-ui: Buddy stylesheet');",
          '}',
        ].join('\n'),
        loader: 'js',
      }))
    },
  }],
  banner: {
    js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(packageId)}, factory: (require) => { var module = { exports: {} }; var exports = module.exports;`,
  },
  footer: { js: 'return module.exports; } });' },
})
await writeFile(join(output, 'index.js'), await readFile(join(packageRoot, 'src', 'index.js'), 'utf8'))

console.log(`built ${packageId}`)
