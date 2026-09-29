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
    '@deepseek-ai/dsh-client-ui-session',
    '@deepseek-ai/dsh-api-remotes',
    '@deepseek-ai/dsh-client-ui-layout',
    '@deepseek-ai/dsh-client-ui-sidebar-right',
    '@deepseek-ai/dsh-client-ui-theme',
    '@deepseek-ai/dsh-api-session-controller',
    '@deepseek-ai/dsh-client-ui-model-selection',
  ])
  // Read the pinned family version instead of restating it: a hardcoded copy here
  // is one more place to forget on every upstream bump.
  const lock = JSON.parse(await readFile(join(root, 'docs/upstream-lock.json'), 'utf8'))
  for (const [name, version] of Object.entries(manifest.peerDependencies)) {
    if (name.startsWith('@deepseek-ai/dsh')) assert.equal(version, lock.packageFamilyVersion)
  }
})

test('source registers theme and overlay through reversible Harness effects', async () => {
  const source = await readFile(join(root, 'packages/sandrone-ui/src/client.jsx'), 'utf8')
  assert.match(source, /import\s+React,\s*\{[^}]*useEffect[^}]*useState[^}]*\}\s+from\s+['"]react['"]/)
  assert.match(source, /export\s+const\s+inject\s*=\s*\[['"]slots['"],\s*['"]theme['"],\s*['"]layout['"]\]/)
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
})

test('space actions use app-owned dialogs and a browser dev storage fallback', async () => {
  const [component, stylesheet] = await Promise.all([
    readFile(join(root, 'packages/sandrone-ui/src/client.jsx'), 'utf8'),
    readFile(join(root, 'packages/sandrone-ui/src/client.css'), 'utf8'),
  ])
  const space = component.match(/function renderMarkdownHtml[\s\S]*?function SandroneRegionLauncher/)?.[0] ?? ''
  assert.match(component, /BROWSER_SPACE_STORAGE_KEY/)
  assert.match(component, /function getSpaceApi\(\)/)
  assert.match(space, /className="sandrone-space-dialog-backdrop"/)
  assert.match(space, /root\.setAttribute\('data-sandrone-space-dialog-open', 'true'\)/)
  assert.match(space, /className="sandrone-space-native-actions"/)
  assert.match(space, /const undoEditorChange = \(\) =>/)
  assert.match(space, /const redoEditorChange = \(\) =>/)
  assert.match(space, /title="撤销 \(Ctrl\+Z\)"/)
  assert.match(space, /title="重做 \(Ctrl\+Y\)"/)
  assert.match(space, /className="sandrone-space-split-view"/)
  assert.match(space, /const flushCurrentDocument = async \(\)/)
  assert.match(space, /onClick=\{\(\) => void selectDocument\(file\)\}/)
  assert.match(space, /onDrop=\{handleEditorDrop\}/)
  assert.match(space, /onPaste=\{handleEditorPaste\}/)
  assert.match(space, /api\?\.importResourceFile/)
  assert.match(space, /restoreDeletedDocument/)
  assert.match(space, /撤销删除/)
  assert.match(space, /tableDelimiter = line =>/)
  assert.match(space, /sandrone-space-task/)
  assert.match(space, /language-\$\{escapeMarkdownHtml\(codeLanguage\)\}/)
  assert.doesNotMatch(space, /window\.(prompt|confirm)/)
  assert.match(stylesheet, /\[data-sandrone-region="space"\][\s\S]*?searchSlot/)
  assert.match(stylesheet, /\.sandrone-space-dialog-backdrop[\s\S]*?pointer-events:\s*auto/)
  assert.match(stylesheet, /html\[data-sandrone-space-dialog-open="true"\] \[data-sandrone-region-host\][\s\S]*?visibility:\s*hidden[\s\S]*?pointer-events:\s*none/)
  assert.match(stylesheet, /\.sandrone-space-split-view\s*\{[\s\S]*?grid-template-columns/)
  assert.match(stylesheet, /\.sandrone-region-menu\s*\{[\s\S]*?z-index:\s*1000/)
  assert.match(stylesheet, /\[data-sandrone-region-host\]\s*\{[\s\S]*?z-index:\s*300/)
  assert.match(stylesheet, /\.sandrone-space-tree-row, \.sandrone-space-document-row\s*\{[\s\S]*?height:\s*36px[\s\S]*?min-height:\s*36px/)
  assert.match(stylesheet, /\.sandrone-space-document-tree\s*\{[^}]*padding-left:\s*0;\s*border-left:\s*0;/)
  assert.match(stylesheet, /\.sandrone-space-folder-row\s*\{[\s\S]*?height:\s*36px/)
  assert.match(stylesheet, /\.sandrone-space-resource-row\s*\{[\s\S]*?height:\s*36px/)
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
  assert.match(stylesheet, /\[data-sandrone-frame\]\s*\{[\s\S]*?padding-top:\s*38px/)
  assert.match(stylesheet, /\[data-sandrone-session-toolbar\]\[aria-hidden="true"\][\s\S]*?display:\s*none/)
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
  assert.match(component, /function WorkspaceControl\(\{ toggleWorkspace \}\)/)
  assert.doesNotMatch(component, /function WorkspacePanel\(/)
  assert.match(component, /scope\.sidebarRight\.toggleExpanded\(\)/)
  assert.doesNotMatch(component, /SandroneImageAttach/)
  assert.match(component, /agentPreset:\s*['"]sandrone-buddy['"]/)
  assert.match(component, /binding\?\.eventSource\.getSnapshot\(\)\.entries/)
  assert.match(component, /collectBuddyActivity/)
  assert.match(component, /RIGHT_PANEL_EVENT/)
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
  assert.doesNotMatch(component, /className="sandrone-right-panel sandrone-workspace-panel"/)
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
  assert.match(component, /installProviderCapabilityFields\(remote\)/)
  assert.match(component, /remote\.settings\.mutate/)
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

test('official chat resolves local image paths through authenticated file delivery', async () => {
  const chat = await readFile(join(root, 'node_modules/@deepseek-ai/dsh-client-ui-chat/lib/client.js'), 'utf8')
  assert.match(chat, /localPathMediaUrl/)
  assert.match(chat, /api\/file\?path=/)
  assert.match(chat, /pathImages/)
})
