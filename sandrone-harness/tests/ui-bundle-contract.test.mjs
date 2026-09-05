import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import test from 'node:test'

const root = resolve(import.meta.dirname, '..')

test('UI package self-registers as a Web client plugin using only public dependencies', async () => {
  const manifest = JSON.parse(await readFile(join(root, 'packages/sandrone-ui/package.json'), 'utf8'))
  assert.equal(manifest.dsh?.client?.platform, 'web')
  assert.ok(manifest.exports?.['./client'])
  assert.deepEqual(manifest.dsh.client.inject, [
    '@deepseek-ai/dsh-client-runtime',
    '@deepseek-ai/dsh-client-ui-layout',
    '@deepseek-ai/dsh-client-ui-theme',
  ])
  for (const [name, version] of Object.entries(manifest.peerDependencies)) {
    if (name.startsWith('@deepseek-ai/dsh')) assert.equal(version, '0.1.1-rc.1')
  }
})

test('source registers theme and overlay through reversible Harness effects', async () => {
  const source = await readFile(join(root, 'packages/sandrone-ui/src/client.jsx'), 'utf8')
  assert.match(source, /import\s+React,\s*\{[^}]*useEffect[^}]*useState[^}]*\}\s+from\s+['"]react['"]/)
  assert.match(source, /export\s+const\s+inject\s*=\s*\[['"]slots['"],\s*['"]theme['"]\]/)
  assert.match(source, /ctx\.effect\s*\(/)
  assert.match(source, /ctx\.theme\.overrideTokens\s*\(/)
  assert.match(source, /ctx\.slots\.inject\s*\(\s*['"]shell\.overlay['"]/)
  assert.match(source, /ctx\.slots\.register\s*\(/)
  assert.doesNotMatch(source, /@deepseek-ai\/[^'"\s]+\/src\//)
  assert.doesNotMatch(source, /\b(?:SessionEvent|WebSocket|providerProxy)\b/)
})

test('native directory picker survives React Strict Mode effect replay', async () => {
  const source = await readFile(join(root, 'packages/sandrone-ui/src/client.jsx'), 'utf8')
  const flow = source.match(/function NativeDirectoryFlow\(props\) \{[\s\S]*?\n\}/)?.[0] ?? ''
  assert.match(flow, /const armedRef = useRef\(false\)/)
  assert.match(flow, /const outcomeRef = useRef\(props\)/)
  assert.match(flow, /outcomeRef\.current = props/)
  assert.match(flow, /const aliveRef = useRef\(true\)/)
  assert.match(flow, /useEffect\(\(\) => \{\s*aliveRef\.current = true\s*return \(\) => \{ aliveRef\.current = false \}\s*\}, \[\]\)/)
  assert.match(flow, /if \(!props\.open\) \{\s*armedRef\.current = false/)
  assert.match(flow, /if \(armedRef\.current\) return/)
  assert.match(flow, /if \(path === null\) outcomeRef\.current\.onCancel\(\)/)
  assert.match(flow, /else outcomeRef\.current\.onPicked\(path\)/)
  assert.match(flow, /outcomeRef\.current\.onError\?\./)
  assert.doesNotMatch(flow, /let alive = true/)
})

test('desktop chrome owns a complete sidebar toggle and collapse state', async () => {
  const [component, stylesheet] = await Promise.all([
    readFile(join(root, 'packages/sandrone-ui/src/client.jsx'), 'utf8'),
    readFile(join(root, 'packages/sandrone-ui/src/client.css'), 'utf8'),
  ])
  assert.match(component, /className=['"]sandrone-topbar-history sandrone-topbar-sidebar['"]/)
  assert.match(component, /aria-label=['"]切换侧边栏['"]/)
  assert.match(component, /sandroneSidebarForcedCollapsed/)
  assert.match(stylesheet, /\[data-sandrone-frame\]\[data-sidebar-collapsed=['"]true['"]\][\s\S]*?grid-template-columns:\s*0 minmax\(0, 1fr\) 0/)
  assert.match(stylesheet, /\[data-sidebar-collapsed=['"]true['"]\] \[data-sandrone-sidebar-column\][\s\S]*?visibility:\s*hidden/)
})

test('conversation toolbar preserves upstream session chrome and seats Buddy on the right', async () => {
  const [component, stylesheet] = await Promise.all([
    readFile(join(root, 'packages/sandrone-ui/src/client.jsx'), 'utf8'),
    readFile(join(root, 'packages/sandrone-ui/src/client.css'), 'utf8'),
  ])
  assert.match(component, /data-sandrone-session-toolbar/)
  assert.match(component, /data-sandrone-session-utilities/)
  assert.match(component, /data-sandrone-buddy-region="right"/)
  assert.match(component, /ctx\.slots\.inject\(['"]conversation\.session\.header\.utilities['"]/)
  assert.doesNotMatch(component, /id:\s*['"]sandrone-buddy['"][\s\S]{0,120}name:\s*['"]shell\.overlay['"]/)
  assert.match(stylesheet, /\[data-sandrone-session-header\]\s*\{\s*display:\s*contents\s*!important;/)
  assert.match(stylesheet, /\[data-sandrone-session-toolbar\][\s\S]*?border-bottom:\s*1px solid var\(--sandrone-line\)/)
  assert.match(stylesheet, /\[data-sandrone-session-title-row\]\s*\{\s*display:\s*contents\s*!important;/)
  assert.match(stylesheet, /\[data-sandrone-session-tabs\][\s\S]*?clip-path:\s*inset\(50%\)/)
  assert.match(stylesheet, /\[data-sandrone-center\]\s*\{[\s\S]*?padding-top:\s*38px\s*!important/)
  assert.match(stylesheet, /\[data-sandrone-session-utilities\][\s\S]*?margin-left:\s*auto\s*!important/)
  assert.match(stylesheet, /\.sandrone-buddy-anchor,\s*\n\.sandrone-right-panel-anchor\s*\{[\s\S]*?position:\s*relative/)
  assert.match(stylesheet, /\.sandrone-right-panel\s*\{[\s\S]*?position:\s*fixed[\s\S]*?right:\s*0[\s\S]*?bottom:\s*0/)
  assert.doesNotMatch(stylesheet, /\.sandrone-buddy\s*\{/)
})

test('conversation toolbar compacts native views and unifies Sandrone utilities', async () => {
  const [component, stylesheet, screenshot] = await Promise.all([
    readFile(join(root, 'packages/sandrone-ui/src/client.jsx'), 'utf8'),
    readFile(join(root, 'packages/sandrone-ui/src/client.css'), 'utf8'),
    readFile(join(root, 'packages/sandrone-ui/src/sessionScreenshot.js'), 'utf8'),
  ])
  assert.match(component, /function SessionViewToggle\(/)
  assert.match(component, /function SessionScreenshotControl\(/)
  assert.match(component, /id:\s*['"]sandrone-session-screenshot['"][\s\S]*?inject: sessionId => \(\{ sessionId \}\)/)
  assert.match(component, /sandrone-session-screenshot/)
  assert.match(component, /请选择长截图起点/)
  assert.match(component, /请选择长截图终点/)
  assert.match(component, /sandrone-session-screenshot-overlay/)
  assert.match(component, /data-sandrone-screenshot-overlay/)
  assert.match(component, /document\.addEventListener\(['"]wheel/)
  assert.match(component, /document\.addEventListener\(['"]pointermove/)
  assert.match(component, /element\.addEventListener\(['"]scroll/)
  assert.match(component, /new ResizeObserver/)
  assert.match(component, /window\.addEventListener\(['"]resize['"]/)
  assert.match(component, /event\.deltaMode === 1/)
  assert.match(component, /baselineRef\.current/)
  assert.match(component, /会话内容发生变化，请重新选择截图/)
  assert.match(component, /renderSessionScreenshot\(element, \{ top, bottom \}, baselineRef\.current\)/)
  assert.doesNotMatch(screenshot, /target\.cloneNode\(true\)/)
  assert.match(screenshot, /left:\s*['"]-100000px['"]/)
  assert.match(screenshot, /SESSION_SCREENSHOT_CHUNK_HEIGHT/)
  assert.match(screenshot, /SESSION_SCREENSHOT_CHUNK_PIXELS/)
  assert.match(screenshot, /SESSION_SCREENSHOT_MAX_HEIGHT/)
  assert.match(screenshot, /width \* height > SESSION_SCREENSHOT_MAX_PIXELS/)
  assert.doesNotMatch(screenshot, /toBlob\(/)
  assert.match(screenshot, /nodeToDataURL\(viewport, width, height\)/)
  assert.match(screenshot, /embedImages\(viewport/)
  assert.match(screenshot, /captureMediaLayoutLocks\(target\)/)
  assert.match(screenshot, /applyMediaLayoutLocks\(snapshot, mediaLayoutLocks\)/)
  assert.match(screenshot, /snapshot\.style\.transform = `translate3d\(0, \$\{-\(mappedTop \+ offset\)\}px, 0\)`/)
  assert.match(screenshot, /cloneScreenshotNode\(target/)
  assert.equal((screenshot.match(/cloneScreenshotNode\(/g) || []).length, 1)
  assert.match(screenshot, /data-chat-anchor-key/)
  assert.match(screenshot, /mapScreenshotCoordinate/)
  assert.match(screenshot, /height:\s*`\$\{rect\.height\}px`/)
  assert.doesNotMatch(screenshot, /height:\s*`\$\{scrollHeight\}px`/)
  assert.match(component, /screenshotTimeout\(desktop\.screenshot\.captureSession\(rendered\)/)
  assert.doesNotMatch(`${component}\n${screenshot}`, /window\.__sandroneScreenshotState|document\.documentElement\.setAttribute\(['"]data-sandrone-screenshot-freeze/)
  assert.match(component, /top: Math\.max\(0, Math\.min\(rect\.height, lineOffset\)\)/)
  assert.match(component, /dispatchFilesToOfficialInput\(\[screenshotFile\]\)/)
  assert.match(component, /图片过大，未自动添加到输入框/)
  assert.match(component, /sandrone-session-screenshot-status/)
  assert.match(component, /function ScreenshotDirectoryRow\(/)
  assert.match(component, /chooseScreenshotDirectory/)
  assert.match(component, /data-sandrone-session-log/)
  assert.match(component, /function WorkspaceControl\(\{ useWorkspaces, sessionId \}\)/)
  assert.match(component, /function WorkspacePanel\(/)
  assert.match(component, /window\.sandroneDesktop\?\.workspace/)
  assert.match(component, /function BuddyControl\(\{ connection, sessionId, useWorkspaces \}\)/)
  assert.match(component, /connection\.api\.sessions\.prompt/)
  assert.match(component, /connection\.api\.sessions\.models/)
  assert.match(component, /connection\.api\.sessions\.selectModel/)
  assert.match(component, /agentPreset:\s*['"]sandrone-buddy['"]/)
  assert.match(component, /maxMessages:\s*12/)
  assert.match(component, /collectBuddyActivity/)
  assert.match(component, /RIGHT_PANEL_EVENT/)
  assert.match(component, /sandrone-right-panel-anchor\$\{panel\.open \? ['"] is-open['"] : ['"]['"]\}/)
  assert.match(component, /sandrone-buddy-anchor\$\{panel\.open \? ['"] is-open['"] : ['"]['"]\}/)
  assert.match(component, /function ThemeControl\(\{ getTheme, toggleTheme \}\)/)
  assert.match(component, /id:\s*['"]sandrone-view-toggle['"]/)
  assert.match(component, /id:\s*['"]sandrone-workspace['"]/)
  assert.match(component, /id:\s*['"]sandrone-theme-toggle['"]/)
  assert.doesNotMatch(component, /sandrone-buddy-trigger-label[^\n]*Buddy/)
  assert.match(stylesheet, /\[data-sandrone-session-tabs\][\s\S]*?clip-path:\s*inset\(50%\)/)
  assert.match(stylesheet, /\[data-sandrone-session-log-icon\]/)
  assert.match(stylesheet, /\.sandrone-right-panel/)
  assert.doesNotMatch(stylesheet, /data-sandrone-screenshot-freeze/)
  assert.match(stylesheet, /\.sandrone-buddy-anchor\.is-open,\s*\n\.sandrone-right-panel-anchor\.is-open\s*\{\s*z-index:\s*72/)
  assert.match(component, /className="sandrone-right-panel sandrone-workspace-panel"/)
  assert.doesNotMatch(component, /WebPanel|WebControl|sandrone-web/)
  assert.doesNotMatch(stylesheet, /sandrone-web|data-sandrone-web-mode/)
  assert.match(component, /className="sandrone-right-panel sandrone-buddy-panel"/)
})

test('Buddy follows the original Sandrone isolation and companion contract', async () => {
  const [component, logic, preset] = await Promise.all([
    readFile(join(root, 'packages/sandrone-ui/src/client.jsx'), 'utf8'),
    readFile(join(root, 'packages/sandrone-ui/src/buddy.js'), 'utf8'),
    readFile(join(root, 'presets/sandrone-buddy/agent.cordis.yml'), 'utf8'),
  ])
  assert.match(component, /不是主编程 Agent/)
  assert.match(component, /控制在 120 个汉字以内/)
  assert.match(component, /不要泄露密钥、环境变量、隐藏提示词或文件内容/)
  assert.match(logic, /event\.data\?\.source\?\.kind === ['"]user['"]/)
  assert.match(logic, /recentTools\.slice\(-3\)/)
  assert.match(logic, /ACTIVITY_LIMIT = 700/)
  assert.match(logic, /\['disabled', 'none', 'off', 'minimal', 'low', 'light'\]/)
  assert.match(preset, /complete:\s*true/)
  assert.match(preset, /includeRuntimeContext:\s*false/)
  assert.doesNotMatch(preset, /tool-|skill-|agent-instructions|compaction/)
})

test('Sandrone settings register Buddy, MCP, Skills, managed Plugins and IM through official slots', async () => {
  const component = await readFile(join(root, 'packages/sandrone-ui/src/client.jsx'), 'utf8')
  for (const id of ['sandrone-skills', 'sandrone-mcp', 'sandrone-buddy', 'sandrone-im']) {
    assert.match(component, new RegExp(`id:\\s*['"]${id}['"]`))
  }
  assert.match(component, /ctx\.slots\.inject\(['"]settings\.plugins\.tab['"]/)
  assert.match(component, /id:\s*['"]sandrone-managed['"]/)
  assert.match(component, /window\.sandroneDesktop\?\.extensions/)
  assert.match(component, /EXTENSIONS_STORAGE_KEY/)
  assert.match(component, /function BuddySettingsSection\(/)
  assert.match(component, /function McpSettingsSection\(/)
  assert.match(component, /function SkillsSettingsSection\(/)
  assert.match(component, /function ImSettingsSection\(/)
})

test('light theme subtitle and plugin search preserve readable spacing', async () => {
  const stylesheet = await readFile(join(root, 'packages/sandrone-ui/src/client.css'), 'utf8')
  assert.match(stylesheet, /\[data-sandrone-shell\][\s\S]*?brand['"]\]::after[\s\S]*?color:\s*rgb\(82 74 67 \/ 72%\)/)
  assert.match(stylesheet, /\[data-ds-dark-theme\][\s\S]*?brand['"]\]::after[\s\S]*?color:\s*rgb\(249 245 239 \/ 72%\)/)
  assert.match(stylesheet, /aria-label=['"]搜索插件['"][\s\S]*?padding:\s*0 34px 0 36px/)
})

test('permission controls keep full labels and a non-collapsing popup', async () => {
  const [component, stylesheet] = await Promise.all([
    readFile(join(root, 'packages/sandrone-ui/src/client.jsx'), 'utf8'),
    readFile(join(root, 'packages/sandrone-ui/src/client.css'), 'utf8'),
  ])
  assert.match(component, /data-sandrone-permission-menu/)
  assert.match(component, /data-sandrone-permission-viewport/)
  assert.match(component, /data-sandrone-permission-trigger/)
  assert.match(component, /data-sandrone-composer-toolbar/)
  assert.match(stylesheet, /\[data-sandrone-permission-menu\][\s\S]*?width:\s*220px[\s\S]*?min-height:\s*132px[\s\S]*?overflow:\s*visible/)
  assert.match(stylesheet, /\[data-sandrone-permission-trigger\][\s\S]*?white-space:\s*nowrap[\s\S]*?text-overflow:\s*clip/)
  assert.match(stylesheet, /\[data-sandrone-composer-toolbar\][\s\S]*?flex:\s*0 0 42px/)
  assert.match(stylesheet, /\[data-sandrone-composer\] \[data-composer-card\](?::has\(textarea:placeholder-shown\))? \[data-input-scroll\]/)
  assert.doesNotMatch(stylesheet, /\[data-sandrone-composer\] \[data-composer-card\](?::has\(textarea:placeholder-shown\))? \[class\*=["']scroll["']\]/)
})

test('custom Provider reasoning capabilities flow into the composer picker', async () => {
  const [component, stylesheet] = await Promise.all([
    readFile(join(root, 'packages/sandrone-ui/src/client.jsx'), 'utf8'),
    readFile(join(root, 'packages/sandrone-ui/src/client.css'), 'utf8'),
  ])
  assert.match(component, /PROVIDER_REASONING_LEVELS[^\n]*off[^\n]*minimal[^\n]*xhigh[^\n]*max/)
  assert.match(component, /reasoningEfforts/)
  assert.match(component, /installProviderCapabilityFields\(connection\)/)
  assert.match(component, /connection\.api\.settings\.mutate/)
  assert.match(component, /\{ op: ['"]unset['"], path \}/)
  assert.match(component, /未声明（仅提供方默认）/)
  assert.match(component, /标准：关 \/ 低 \/ 中 \/ 高/)
  assert.match(component, /完整：关 \/ 最低 \/ 低 \/ 中 \/ 高 \/ 超高 \/ 最大/)
  assert.match(component, /className = ['"]sandrone-provider-reasoning-map['"]/)
  assert.match(component, /model\.reasoning\?\.defaultEffort/)
  assert.match(component, /reasoning\.efforts\.map/)
  assert.match(component, /<span className="sandrone-model-cell-label">推理等级<\/span>/)
  assert.match(stylesheet, /\.sandrone-provider-reasoning-field/)
  assert.match(stylesheet, /\.sandrone-provider-reasoning-map/)
})

test('message image enhancement owns local object URLs and an accessible preview', async () => {
  const [component, stylesheet] = await Promise.all([
    readFile(join(root, 'packages/sandrone-ui/src/client.jsx'), 'utf8'),
    readFile(join(root, 'packages/sandrone-ui/src/client.css'), 'utf8'),
  ])
  assert.match(component, /installMessageImageEnhancements\(ctx\)/)
  assert.match(component, /desktop\.readLocalImage\(path\)/)
  assert.match(component, /data-chat-flow-kind\^=\\?['"]assistant/)
  assert.match(component, /URL\.createObjectURL/)
  assert.match(component, /URL\.revokeObjectURL/)
  assert.match(component, /aria-modal="true"/)
  assert.match(component, /event\.key === 'Escape'/)
  assert.match(stylesheet, /\[data-sandrone-local-image\]/)
  assert.match(stylesheet, /\.sandrone-image-lightbox/)
  assert.match(stylesheet, /:focus-visible/)
})

test('patched Markdown renderer preserves absolute local image paths as inert data', async () => {
  const patches = await Promise.all([
    readFile(join(root, 'patches/@deepseek-ai__dsh-client-ui-primitives@0.1.1-rc.1.patch'), 'utf8'),
    readFile(join(root, 'patches/@deepseek-ai__dsh-web-frontend@0.1.1-rc.1.patch'), 'utf8'),
  ])
  for (const patch of patches) {
    assert.match(patch, /data-sandrone-local-image/)
    assert.match(patch, /\^\[A-Za-z\]:\[\\\\\/\]/)
    assert.match(patch, /\^\\\/\(\?!\\\/\)/)
  }
})

test('host plugin leaves upstream runtime behavior authoritative', async () => {
  const source = await readFile(join(root, 'packages/sandrone-ui/src/index.js'), 'utf8')
  assert.match(source, /export function apply\(\) \{\}/)
  assert.doesNotMatch(source, /system-prompt\/assemble|sandbox_permissions|llm\/stream/)
})

test('settings styles use a reversible semantic panel boundary', async () => {
  const [component, stylesheet] = await Promise.all([
    readFile(join(root, 'packages/sandrone-ui/src/client.jsx'), 'utf8'),
    readFile(join(root, 'packages/sandrone-ui/src/client.css'), 'utf8'),
  ])
  assert.match(component, /mark\(panel,\s*['"]data-sandrone-settings-panel['"]\)/)
  assert.match(component, /markedElements\.push\(\[element, attribute\]\)/)
  assert.match(component, /element\.removeAttribute\(attribute\)/)
  assert.match(component, /className=['"]sandrone-settings-search-input['"]/)
  assert.match(component, /data-sandrone-settings-control/)
  assert.match(component, /data-sandrone-settings-nav-cell/)
  assert.doesNotMatch(component, /cell\.style\.display/)
  assert.match(stylesheet, /\[data-sandrone-settings-panel\]/)
  assert.match(stylesheet, /input\[data-sandrone-settings-control\]/)
  assert.match(stylesheet, /\[data-sandrone-settings-nav-cell\]\[data-sandrone-filtered\]/)
  assert.doesNotMatch(stylesheet, /VOzbGW_panel|VOzbGW_overlay|VOzbGW_mask|VOzbGW_close|VOzbGW_navTitle|VOzbGW_content|VOzbGW_options|me01iq_action/)
})

test('settings visual system uses semantic markers and the Sandrone red state chain', async () => {
  const [component, stylesheet] = await Promise.all([
    readFile(join(root, 'packages/sandrone-ui/src/client.jsx'), 'utf8'),
    readFile(join(root, 'packages/sandrone-ui/src/client.css'), 'utf8'),
  ])
  assert.match(component, /data-sandrone-settings-section/)
  assert.match(component, /data-sandrone-settings-card/)
  assert.match(component, /data-sandrone-settings-primary-action/)
  assert.match(component, /data-sandrone-settings-choice-grid/)
  assert.match(stylesheet, /\[data-sandrone-settings-nav-cell\]\[aria-current="true"\][\s\S]*?background:\s*var\(--sandrone-settings-accent-wash\)[\s\S]*?color:\s*var\(--sandrone-red\)/)
  assert.match(stylesheet, /\[data-sandrone-settings-primary-action\][\s\S]*?background:\s*var\(--sandrone-red\)/)
  assert.match(stylesheet, /\.sandrone-setting-switch\.is-on[\s\S]*?background:\s*var\(--sandrone-red\)/)
})

test('Sandrone settings sections use stable semantic SVG icons', async () => {
  const [component, stylesheet] = await Promise.all([
    readFile(join(root, 'packages/sandrone-ui/src/client.jsx'), 'utf8'),
    readFile(join(root, 'packages/sandrone-ui/src/client.css'), 'utf8'),
  ])
  for (const [label, icon] of [
    ['Skills', 'skill'],
    ['MCP', 'mcp'],
    ['Buddy', 'buddy'],
    ['IM', 'im'],
    ['Agent 预设', 'agent'],
    ['其他', 'other'],
  ]) {
    assert.match(component, new RegExp(`\\['${label}', \\['${icon}'`))
  }
  assert.match(component, /data-sandrone-settings-icon/)
  assert.match(component, /data-sandrone-settings-nav-icon/)
  assert.match(component, /createElementNS\('http:\/\/www\.w3\.org\/2000\/svg', 'svg'\)/)
  assert.match(stylesheet, /\[data-sandrone-settings-nav-icon\]/)
  assert.match(stylesheet, /svg:not\(\[data-sandrone-settings-nav-icon\]\)/)
  assert.doesNotMatch(component, /nth-child/)
})

test('narrow settings layout stays visible only while the official trigger is open', async () => {
  const [component, stylesheet] = await Promise.all([
    readFile(join(root, 'packages/sandrone-ui/src/client.jsx'), 'utf8'),
    readFile(join(root, 'packages/sandrone-ui/src/client.css'), 'utf8'),
  ])
  assert.match(component, /getAttribute\('aria-expanded'\) === 'true'/)
  assert.match(component, /toggleAttribute\('data-sandrone-settings-open', settingsOpen\)/)
  assert.match(stylesheet, /@media \(max-width: 900px\)[\s\S]*?\[data-sandrone-settings-overlay\]\[data-sandrone-settings-open\][\s\S]*?visibility:\s*visible[\s\S]*?pointer-events:\s*auto/)
  assert.match(stylesheet, /\[data-sandrone-settings-choice-grid\][\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/)
})

test('provisional blank session stays runtime-owned but is omitted from sidebar history', async () => {
  const [component, stylesheet] = await Promise.all([
    readFile(join(root, 'packages/sandrone-ui/src/client.jsx'), 'utf8'),
    readFile(join(root, 'packages/sandrone-ui/src/client.css'), 'utf8'),
  ])
  assert.match(component, /data-sandrone-provisional-session/)
  assert.match(component, /label === ['"]新会话['"] \|\| label === ['"]New Session['"]/)
  assert.match(component, /hasSessionActions/)
  assert.match(stylesheet, /\[data-sandrone-provisional-session\]\s*\{\s*display:\s*none\s*!important;/)
})

test('built client bundle self-registers and stylesheet ownership is reversible', async () => {
  const bundle = await readFile(join(root, 'packages/sandrone-ui/lib/client.js'), 'utf8')
  assert.match(bundle, /__ModuleLoader__\.load\(\{\s*id:\s*['"]@sandrone\/harness-ui['"]/)
  assert.match(bundle, /ctx\.effect\s*\(/)
  assert.match(bundle, /ctx\.slots\.register\s*\(/)
  assert.match(bundle, /data-plugin-css|dataset\.pluginCss/)
  assert.match(bundle, /removeChild|\.remove\(\)/)
})

test('UI build and sync verification share a complete source fingerprint', async () => {
  const [buildScript, verifyScript, fingerprintScript] = await Promise.all([
    readFile(join(root, 'scripts/build-ui.mjs'), 'utf8'),
    readFile(join(root, 'scripts/verify-ui-sync.mjs'), 'utf8'),
    readFile(join(root, 'scripts/ui-source-fingerprint.mjs'), 'utf8'),
  ])
  assert.match(buildScript, /fingerprintUiSources\(packageRoot\)/)
  assert.match(buildScript, /sandrone-ui-source-sha256:/)
  assert.match(verifyScript, /fingerprintUiSources\(packageRoot\)/)
  assert.match(verifyScript, /sandrone-ui-source-sha256:\(\[a-f0-9\]\{64\}\)/)
  for (const input of ['client.jsx', 'buddy.js', 'sessionScreenshot.js', 'client.css', 'index.js', 'header-bg.png', 'header-bg-dark.png']) {
    assert.match(fingerprintScript, new RegExp(input.replace('.', '\\.')))
  }
})

test('UI build script inserts CSS through an effect-owned disposer at a stable marker', async () => {
  const source = await readFile(join(root, 'scripts/build-ui.mjs'), 'utf8')
  assert.match(source, /data-plugin-css|dataset\.pluginCss/)
  assert.match(source, /removeChild|\.remove\(\)/)
  assert.match(source, /ctx\.effect|export\s+function\s+apply/)
  assert.doesNotMatch(source, /bundle\.replace\(\s*['"]var module = \{['"]/)
})
