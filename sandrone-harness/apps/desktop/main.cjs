'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { fork } = require('node:child_process')
const { pathToFileURL } = require('node:url')
const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  screen,
  shell,
} = require('electron')
const { HarnessSupervisor } = require('./lib/harness-supervisor.cjs')
const { deployPlugin } = require('./lib/deploy-plugin.cjs')
const { classifyNavigation, isInternalHarnessUrl } = require('./lib/navigation-policy.cjs')
const { assertTrustedIpcSender } = require('./lib/ipc-policy.cjs')
const { createQuitCoordinator } = require('./lib/quit-coordinator.cjs')
const { packageBin } = require('./lib/resolve-package.cjs')

const APP_NAME = 'Sandrone AI Agent'
const ROOT = path.resolve(__dirname, '..', '..')
const RUNNER = path.join(__dirname, 'harness-runner.mjs')
const UI_BUILD_SCRIPT = path.join(ROOT, 'scripts', 'build-ui.mjs')
const PATCH = path.join(ROOT, 'profiles', 'sandrone-desktop.patch.yml')
const UI_PLUGIN = path.join(ROOT, 'packages', 'sandrone-ui')
const WINDOW_ICON = path.join(ROOT, 'build', 'icon.png')
const LOADING_PAGE = path.join(__dirname, 'loading.html')
const LOADING_URL = pathToFileURL(LOADING_PAGE).href
const NAVIGATION_RETRY_DELAYS = [500, 1_500, 4_000]
const HARNESS_READINESS_TIMEOUT_MS = 10 * 60_000

app.setName(APP_NAME)

let mainWindow = null
let activeOrigin = null
let navigationRetry = 0
let navigationTimer = null
let quitting = false
let reloadUiInFlight = null

function desktopSettingsPath() {
  return path.join(app.getPath('userData'), 'desktop-settings.json')
}

function readDesktopSettings() {
  try {
    const value = JSON.parse(fs.readFileSync(desktopSettingsPath(), 'utf8'))
    return { gpuAcceleration: value.gpuAcceleration !== false }
  } catch {
    return { gpuAcceleration: true }
  }
}

function writeDesktopSettings(settings) {
  const target = desktopSettingsPath()
  const temporary = `${target}.${process.pid}.tmp`
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(temporary, `${JSON.stringify(settings)}\n`)
    fs.renameSync(temporary, target)
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }) } catch {}
    console.error(`[sandrone-desktop] could not persist desktop settings: ${String(error)}`)
  }
}

let desktopSettings = readDesktopSettings()
// Must be called before app.whenReady: disabling GPU switches the renderer to
// software compositing, which avoids afterimage/ghosting artifacts on drivers
// with broken accelerated compositing.
if (!desktopSettings.gpuAcceleration) app.disableHardwareAcceleration()

function toggleGpuAcceleration(enabled) {
  desktopSettings = { gpuAcceleration: enabled }
  writeDesktopSettings(desktopSettings)
  syncGpuMenuState()
  const choice = dialog.showMessageBoxSync(mainWindow ?? undefined, {
    type: 'question',
    title: 'GPU 加速',
    message: 'GPU 硬件加速更改将在重启后生效。',
    detail: enabled
      ? '已启用 GPU 加速。'
      : '已禁用 GPU 加速，界面将改用软件渲染，可避免残影等合成问题。',
    buttons: ['立即重启', '稍后'],
    defaultId: 0,
    cancelId: 1,
  })
  if (choice === 0) {
    app.relaunch()
    app.quit()
  }
}

function syncGpuMenuState() {
  const item = Menu.getApplicationMenu()?.items
    .find(entry => entry.label === '视图')?.submenu?.items
    .find(entry => entry.label === 'GPU 硬件加速')
  if (item) item.checked = desktopSettings.gpuAcceleration
}

function showAboutDialog() {
  dialog.showMessageBoxSync(mainWindow ?? undefined, {
    type: 'info',
    title: `关于 ${APP_NAME}`,
    message: APP_NAME,
    detail: `DeepSeek Harness 的 Sandrone 桌面发行版。\n\nCo-authored by Paperfly_ovo & Seint\n适配层许可：MIT`,
    buttons: ['确定'],
    defaultId: 0,
  })
}

function dshHome() {
  return path.join(app.getPath('userData'), 'DeepSeekHarness')
}

function windowStatePath() {
  return path.join(app.getPath('userData'), 'window-state.json')
}

function readWindowState() {
  try {
    const value = JSON.parse(fs.readFileSync(windowStatePath(), 'utf8'))
    if (![value.x, value.y, value.width, value.height].every(Number.isFinite)) return {}
    const bounds = { x: value.x, y: value.y, width: value.width, height: value.height }
    const workArea = screen.getDisplayMatching(bounds).workArea
    const visible = bounds.x < workArea.x + workArea.width - 80
      && bounds.x + bounds.width > workArea.x + 80
      && bounds.y < workArea.y + workArea.height - 40
      && bounds.y + bounds.height > workArea.y + 40
    return visible ? { ...bounds, maximized: value.maximized === true } : {}
  } catch {
    return {}
  }
}

function writeWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const bounds = mainWindow.isMaximized() ? mainWindow.getNormalBounds() : mainWindow.getBounds()
  const target = windowStatePath()
  const temporary = `${target}.${process.pid}.tmp`
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(temporary, `${JSON.stringify({ ...bounds, maximized: mainWindow.isMaximized() })}\n`)
    fs.renameSync(temporary, target)
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }) } catch {}
    console.error(`[sandrone-desktop] could not persist window state: ${String(error)}`)
  }
}

function launchHarness() {
  const bin = packageBin('@deepseek-ai/dsh', 'dsh', path.join(ROOT, 'package.json'))
  deployPlugin({ source: UI_PLUGIN, dshHome: dshHome() })
  return fork(RUNNER, [], {
    cwd: app.getPath('home'),
    execPath: process.execPath,
    execArgv: ['--expose-internals'],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      DSH_HOME: dshHome(),
      SANDRONE_DSH_BIN: bin,
      SANDRONE_DSH_ARGS: JSON.stringify(['web', '--patch', PATCH, '--port', '0']),
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true,
  })
}

function rebuildUi() {
  return new Promise((resolve, reject) => {
    const child = fork(UI_BUILD_SCRIPT, [], {
      cwd: ROOT,
      execPath: process.execPath,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      windowsHide: true,
    })
    let stderr = ''
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('error', reject)
    child.on('exit', code => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(stderr.trim() || `build:ui exited with code ${code}`))
      }
    })
  })
}

/**
 * Ctrl+R reload. From source: rebuild the Sandrone UI bundle, redeploy it into
 * DSH_HOME, then hard-reload the renderer. Packaged builds ship no build tooling,
 * so Ctrl+R falls back to a plain hard reload of the shipped bundle.
 */
function reloadUi() {
  if (reloadUiInFlight) return reloadUiInFlight
  reloadUiInFlight = (async () => {
    if (!app.isPackaged) {
      await rebuildUi()
      deployPlugin({ source: UI_PLUGIN, dshHome: dshHome() })
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      await mainWindow.webContents.reloadIgnoringCache()
    }
  })().finally(() => {
    reloadUiInFlight = null
  })
  return reloadUiInFlight
}

function triggerReloadUi() {
  reloadUi().catch(error => {
    console.error(`[sandrone-desktop] UI reload failed: ${String(error)}`)
    dialog.showErrorBox(app.isPackaged ? '界面刷新失败' : 'Sandrone UI 重建失败', String(error))
  })
}

const supervisor = new HarnessSupervisor({
  launch: launchHarness,
  readinessTimeoutMs: HARNESS_READINESS_TIMEOUT_MS,
  stopTimeoutMs: 10_000,
  restartDelaysMs: [500, 1_500, 4_000],
  stableAfterMs: 60_000,
})

function sendStatus(status = supervisor.snapshot()) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send('desktop:status', status)
}

function sendMaximizedState() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send('desktop:maximized-changed', mainWindow.isMaximized())
}

function sendDesktopCommand(command) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send('desktop:command', command)
}

async function showLoadingPage() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const current = mainWindow.webContents.getURL()
  if (current === LOADING_URL) return
  await mainWindow.loadFile(LOADING_PAGE)
}

async function loadHarness(url) {
  if (!mainWindow || mainWindow.isDestroyed() || quitting) return
  activeOrigin = new URL(url).origin
  await mainWindow.loadURL(activeOrigin)
}

function clearNavigationRetry() {
  clearTimeout(navigationTimer)
  navigationTimer = null
  navigationRetry = 0
}

function scheduleNavigationRetry() {
  if (navigationTimer || !activeOrigin || quitting) return
  const delay = NAVIGATION_RETRY_DELAYS[Math.min(navigationRetry, NAVIGATION_RETRY_DELAYS.length - 1)]
  navigationRetry += 1
  navigationTimer = setTimeout(() => {
    navigationTimer = null
    if (supervisor.snapshot().phase === 'ready' && activeOrigin) {
      void loadHarness(activeOrigin).catch(() => scheduleNavigationRetry())
    }
  }, delay)
  navigationTimer.unref?.()
}

function installNavigationPolicy(window) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    const action = classifyNavigation(url, { internalOrigin: activeOrigin, trustedFileUrl: LOADING_URL })
    if (action === 'internal') void window.loadURL(url)
    else if (action === 'external') void shell.openExternal(url)
    return { action: 'deny' }
  })
  const guard = (event, url) => {
    const action = classifyNavigation(url, { internalOrigin: activeOrigin, trustedFileUrl: LOADING_URL })
    if (action === 'internal' || action === 'trusted-file') return
    event.preventDefault()
    if (action === 'external') void shell.openExternal(url)
  }
  window.webContents.on('will-navigate', guard)
  window.webContents.on('will-redirect', guard)
  window.webContents.on('will-attach-webview', event => event.preventDefault())
}

function installPermissionPolicy(window) {
  const allowed = new Set(['clipboard-sanitized-write'])
  const trusted = webContents => webContents === window.webContents
    && isInternalHarnessUrl(webContents.getURL(), activeOrigin)
  window.webContents.session.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => (
    trusted(webContents)
      && details?.isMainFrame === true
      && isInternalHarnessUrl(requestingOrigin, activeOrigin)
      && allowed.has(permission)
  ))
  window.webContents.session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(
      trusted(webContents)
        && details?.isMainFrame === true
        && isInternalHarnessUrl(details.requestingUrl, activeOrigin)
        && allowed.has(permission),
    )
  })
  window.webContents.session.setDevicePermissionHandler(() => false)
}

function createApplicationMenu() {
  const isMac = process.platform === 'darwin'
  const template = [
    ...(isMac ? [{
      label: APP_NAME,
      submenu: [
        { role: 'about', label: `关于 ${APP_NAME}` },
        { type: 'separator' },
        { role: 'services', label: '服务' },
        { type: 'separator' },
        { role: 'hide', label: `隐藏 ${APP_NAME}` },
        { role: 'hideOthers', label: '隐藏其他应用' },
        { role: 'unhide', label: '全部显示' },
        { type: 'separator' },
        { role: 'quit', label: `退出 ${APP_NAME}` },
      ],
    }] : []),
    {
      label: '文件',
      submenu: [
        { label: '打开工作区', click: () => sendDesktopCommand('open-workspace') },
        { label: '设置', accelerator: 'CmdOrCtrl+,', click: () => sendDesktopCommand('open-settings') },
        { type: 'separator' },
        { role: 'close', label: '关闭窗口' },
        ...(!isMac ? [{ role: 'quit', label: '退出' }] : []),
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' }, { type: 'separator' },
        { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' }, { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { label: '后退', accelerator: isMac ? 'Command+[' : 'Alt+Left', click: () => mainWindow?.webContents.navigationHistory.goBack() },
        { label: '前进', accelerator: isMac ? 'Command+]' : 'Alt+Right', click: () => mainWindow?.webContents.navigationHistory.goForward() },
        { type: 'separator' },
        { label: '切换侧边栏', accelerator: 'CmdOrCtrl+B', click: () => sendDesktopCommand('toggle-sidebar') },
        { label: '切换夜间模式', click: () => sendDesktopCommand('toggle-theme') },
        { label: 'GPU 硬件加速', type: 'checkbox', checked: desktopSettings.gpuAcceleration, click: item => toggleGpuAcceleration(item.checked) },
        { type: 'separator' },
        { label: app.isPackaged ? '刷新界面' : '刷新界面（重建 UI）', accelerator: 'CmdOrCtrl+R', click: triggerReloadUi },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
    ...(isMac ? [{ role: 'windowMenu', label: '窗口' }] : []),
    {
      label: '帮助',
      submenu: [
        { label: `关于 ${APP_NAME}`, click: showAboutDialog },
        { label: 'DeepSeek Harness', click: () => shell.openExternal('https://github.com/deepseek-ai/deepseek-harness') },
        { type: 'separator' },
        { label: '开发者工具', accelerator: 'F12', click: () => mainWindow?.webContents.toggleDevTools() },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

const APPLICATION_MENU_LABELS = Object.freeze({ file: '文件', edit: '编辑', view: '视图', help: '帮助' })

function popupApplicationMenu(menuId, position) {
  const label = typeof menuId === 'string' ? APPLICATION_MENU_LABELS[menuId] : undefined
  if (label === undefined) return false
  const item = Menu.getApplicationMenu()?.items.find(entry => entry.label === label)
  if (!item?.submenu || !mainWindow || mainWindow.isDestroyed()) return false
  const options = { window: mainWindow }
  if (Number.isFinite(position?.x)) options.x = Math.max(0, Math.round(position.x))
  if (Number.isFinite(position?.y)) options.y = Math.max(0, Math.round(position.y))
  item.submenu.popup(options)
  return true
}

function createWindow() {
  const saved = readWindowState()
  mainWindow = new BrowserWindow({
    x: saved.x,
    y: saved.y,
    width: saved.width ?? 1280,
    height: saved.height ?? 820,
    minWidth: 900,
    minHeight: 620,
    show: false,
    frame: false,
    title: APP_NAME,
    icon: WINDOW_ICON,
    backgroundColor: '#f5f2ec',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
  })
  installNavigationPolicy(mainWindow)
  installPermissionPolicy(mainWindow)
  // Desktop layout is pinned at 100%: pinch/Ctrl+wheel zoom would shrink the
  // CSS viewport and trip the mobile media queries, collapsing the frame.
  mainWindow.webContents.setVisualZoomLevelLimits(1, 1)
  if (saved.maximized) mainWindow.maximize()
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  // Frameless shell: keep the OS-facing title constant so the taskbar and
  // Alt-Tab never show "<会话名> - DeepSeek Harness" page titles.
  mainWindow.on('page-title-updated', event => event.preventDefault())
  mainWindow.on('maximize', sendMaximizedState)
  mainWindow.on('unmaximize', sendMaximizedState)
  mainWindow.on('close', writeWindowState)
  mainWindow.on('closed', () => { mainWindow = null })
  mainWindow.webContents.on('did-finish-load', () => {
    if (isInternalHarnessUrl(mainWindow?.webContents.getURL(), activeOrigin)) clearNavigationRetry()
  })
  mainWindow.webContents.on('did-fail-load', (_event, code, _description, url, isMainFrame) => {
    if (!isMainFrame || code === -3 || !isInternalHarnessUrl(url, activeOrigin)) return
    void showLoadingPage().finally(scheduleNavigationRetry)
  })
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    if (quitting || details.reason === 'clean-exit') return
    void showLoadingPage().finally(scheduleNavigationRetry)
  })
  void mainWindow.loadFile(LOADING_PAGE)
}

function registerIpc() {
  const assertTrusted = event => assertTrustedIpcSender(event, mainWindow, {
    internalOrigin: activeOrigin,
    trustedFileUrl: LOADING_URL,
  })
  ipcMain.handle('desktop:get-status', event => {
    assertTrusted(event)
    return supervisor.snapshot()
  })
  ipcMain.handle('desktop:restart-harness', async event => {
    assertTrusted(event)
    activeOrigin = null
    await showLoadingPage()
    await supervisor.restart()
    return supervisor.snapshot()
  })
  ipcMain.handle('desktop:show-application-menu', (event, menuId, position) => {
    assertTrusted(event)
    return popupApplicationMenu(menuId, position)
  })
  ipcMain.handle('desktop:get-gpu-acceleration', event => {
    assertTrusted(event)
    return desktopSettings.gpuAcceleration
  })
  ipcMain.handle('desktop:set-gpu-acceleration', (event, value) => {
    assertTrusted(event)
    desktopSettings = { gpuAcceleration: value === true }
    writeDesktopSettings(desktopSettings)
    syncGpuMenuState()
    return desktopSettings.gpuAcceleration
  })
  ipcMain.handle('desktop:pick-directory', async event => {
    assertTrusted(event)
    // QA override: automated runs cannot drive the native OS dialog, so the
    // fixture path resolves directly when the environment asks for it.
    const fixture = process.env.SANDRONE_QA_PICK_DIRECTORY?.trim()
    if (fixture) return fixture
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择文件夹',
      buttonLabel: '选择文件夹',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })
  ipcMain.handle('desktop:window-minimize', event => {
    assertTrusted(event)
    mainWindow?.minimize()
  })
  ipcMain.handle('desktop:window-toggle-maximize', event => {
    assertTrusted(event)
    if (!mainWindow) return false
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
    return mainWindow.isMaximized()
  })
  ipcMain.handle('desktop:window-close', event => {
    assertTrusted(event)
    mainWindow?.close()
  })
  ipcMain.handle('desktop:window-is-maximized', event => {
    assertTrusted(event)
    return mainWindow?.isMaximized() ?? false
  })
}

const quitCoordinator = createQuitCoordinator({
  shutdown: async () => {
    clearNavigationRetry()
    writeWindowState()
    await supervisor.stop()
  },
  onError: error => {
    console.error(`[sandrone-desktop] Harness shutdown failed: ${String(error)}`)
  },
  finish: () => app.quit(),
})

supervisor.on('status', status => {
  sendStatus(status)
  if (status.phase !== 'ready') {
    activeOrigin = null
    if (status.phase === 'restarting' || status.phase === 'failed') void showLoadingPage()
  }
})
supervisor.on('ready', url => {
  clearNavigationRetry()
  void loadHarness(url).catch(error => {
    console.error(`[sandrone-desktop] could not load Harness UI: ${String(error)}`)
    void showLoadingPage().finally(scheduleNavigationRetry)
  })
})

const hasLock = app.requestSingleInstanceLock()
if (!hasLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })
  app.whenReady().then(async () => {
    app.setAppUserModelId('ai.sandrone.deepseek-harness')
    registerIpc()
    createApplicationMenu()
    createWindow()
    await supervisor.start()
  }).catch(error => {
    console.error(`[sandrone-desktop] startup failed: ${String(error)}`)
  })
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length > 0) return
    createWindow()
    const status = supervisor.snapshot()
    if (status.phase === 'ready' && status.url) void loadHarness(status.url)
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', event => {
  if (!quitCoordinator.snapshot().complete) quitting = true
  void quitCoordinator.handle(event)
})
