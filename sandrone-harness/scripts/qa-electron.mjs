import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

import { electronExecutableRelativePath } from './lib/desktop-platform.mjs'

const execFileAsync = promisify(execFile)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const buddySelector = '[aria-label="Sandrone Buddy"], [aria-label="Open Sandrone Buddy"]'
const defaultReadyTimeoutMs = 11 * 60_000
const shutdownTimeoutMs = 45_000
const processDrainTimeoutMs = 30_000

function timestampName(date = new Date()) {
  return date.toISOString().replaceAll(':', '-').replaceAll('.', '-')
}

function bounded(value, limit = 4_000) {
  const text = String(value ?? '')
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

function redact(value) {
  return bounded(value)
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[redacted]')
    .replace(/((?:["']?)(?:api[_-]?key|access[_-]?token|authorization|password)(?:["']?)\s*[:=]\s*)(?:["'][^"']*["']|[^\s,;&]+)/gi, '$1[redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, 'sk-[redacted]')
}

function safeUrl(value) {
  try {
    const parsed = new URL(String(value))
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}${parsed.search ? '?[redacted]' : ''}`
  } catch {
    return redact(value)
  }
}

function timeoutFromEnvironment() {
  const configured = process.env.QA_ELECTRON_TIMEOUT_MS?.trim()
  if (!configured) return defaultReadyTimeoutMs
  const value = Number(configured)
  if (!Number.isInteger(value) || value < 30_000 || value > 20 * 60_000) {
    throw new Error('QA_ELECTRON_TIMEOUT_MS must be an integer between 30000 and 1200000')
  }
  return value
}

function isPathInside(candidate, parent) {
  const difference = relative(resolve(parent), resolve(candidate))
  return difference === '' || (!difference.startsWith(`..${sep}`) && difference !== '..' && !difference.includes(':'))
}

function recordCheck(report, name, passed, detail) {
  report.checks.push({ name, passed, detail })
  if (!passed) report.failures.push(`${name}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`)
}

async function pathExists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function inspectPlaywrightRoot(candidate) {
  try {
    const packageRoot = await realpath(resolve(candidate))
    const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
    if (manifest.name !== 'playwright') return null
    return { packageRoot, version: String(manifest.version ?? 'unknown') }
  } catch {
    return null
  }
}

async function bundledPlaywrightCandidates() {
  const runtimeRoot = join(homedir(), '.cache', 'codex-runtimes')
  const candidates = [
    join(runtimeRoot, 'codex-primary-runtime', 'dependencies', 'node', 'node_modules', 'playwright'),
  ]

  try {
    const localManifest = require.resolve('playwright/package.json')
    candidates.push(dirname(localManifest))
  } catch {}

  try {
    const { readdir } = await import('node:fs/promises')
    for (const entry of await readdir(runtimeRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith('codex-runtime-install-')) continue
      candidates.push(join(
        runtimeRoot,
        entry.name,
        'payload',
        'codex-primary-runtime',
        'dependencies',
        'node',
        'node_modules',
        'playwright',
      ))
    }
  } catch {}

  return [...new Set(candidates)]
}

async function loadElectronDriver() {
  const override = process.env.PLAYWRIGHT_PACKAGE_ROOT?.trim()
  const candidates = override ? [override] : await bundledPlaywrightCandidates()

  for (const candidate of candidates) {
    const inspected = await inspectPlaywrightRoot(candidate)
    if (!inspected) continue
    const loaded = require(inspected.packageRoot)
    if (!loaded?._electron) throw new Error(`Playwright at ${inspected.packageRoot} does not expose _electron`)
    return { ...inspected, electron: loaded._electron }
  }

  const hint = override
    ? `PLAYWRIGHT_PACKAGE_ROOT does not point to a Playwright package: ${override}`
    : 'Codex bundled Playwright was not found; set PLAYWRIGHT_PACKAGE_ROOT to its package directory'
  throw new Error(hint)
}

async function electronExecutable() {
  const override = process.env.ELECTRON_EXECUTABLE_PATH?.trim()
  const candidate = override || join(
    root,
    'node_modules',
    'electron',
    'dist',
    electronExecutableRelativePath(),
  )
  const executablePath = await realpath(candidate)
  const manifest = JSON.parse(await readFile(join(root, 'node_modules', 'electron', 'package.json'), 'utf8'))
  return { executablePath, version: String(manifest.version ?? 'unknown') }
}

function mergeProcessIdentities(...groups) {
  const merged = new Map()
  for (const group of groups) {
    for (const process of group) merged.set(process.pid, process)
  }
  return [...merged.values()]
}

async function electronProcesses(application, rootPid) {
  const metrics = await application.evaluate(({ app }) => app.getAppMetrics().map(metric => ({
    pid: metric.pid,
    type: metric.type,
    serviceName: metric.serviceName ?? null,
    name: metric.name ?? null,
  })))
  return mergeProcessIdentities([{ pid: rootPid, type: 'Browser', serviceName: null, name: 'Electron root' }], metrics)
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

async function originReachable(origin) {
  if (!origin) return false
  try {
    await fetch(origin, { signal: AbortSignal.timeout(1_500) })
    return true
  } catch {
    return false
  }
}

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

async function withTimeout(operation, milliseconds, message) {
  let timer
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), milliseconds)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

async function forceStopProcessTree(rootPid) {
  if (!Number.isInteger(rootPid) || rootPid < 1) return
  if (process.platform === 'win32') {
    await execFileAsync('taskkill.exe', ['/PID', String(rootPid), '/T', '/F'], {
      encoding: 'utf8',
      windowsHide: true,
    }).catch(() => {})
    return
  }
  const table = await execFileAsync('ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8' }).catch(() => null)
  const children = new Map()
  for (const line of table?.stdout.split(/\r?\n/) ?? []) {
    const [pidText, parentText] = line.trim().split(/\s+/)
    const pid = Number(pidText)
    const parent = Number(parentText)
    if (!Number.isInteger(pid) || !Number.isInteger(parent)) continue
    const siblings = children.get(parent) ?? []
    siblings.push(pid)
    children.set(parent, siblings)
  }
  const pending = [rootPid]
  const tree = []
  while (pending.length > 0) {
    const pid = pending.pop()
    tree.push(pid)
    pending.push(...(children.get(pid) ?? []))
  }
  for (const pid of tree.reverse()) {
    try { process.kill(pid, 'SIGKILL') } catch {}
  }
}

async function waitForShutdown({ identities, origin }) {
  const deadline = Date.now() + processDrainTimeoutMs
  let residualIdentities = identities
  let serverReachable = Boolean(origin)

  do {
    residualIdentities = identities.filter(process => processIsAlive(process.pid))
    serverReachable = await originReachable(origin)
    if (residualIdentities.length === 0 && !serverReachable) break
    await wait(500)
  } while (Date.now() < deadline)

  return { residualIdentities, serverReachable }
}

function loopbackOrigin(value) {
  const parsed = new URL(value)
  if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1') return null
  const port = Number(parsed.port)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return null
  if (parsed.username || parsed.password) return null
  return parsed.origin
}

async function waitForOfficialHarness(page, readyTimeoutMs) {
  const deadline = Date.now() + readyTimeoutMs
  let lastUrl = page.url()
  let lastError = null

  while (Date.now() < deadline) {
    if (page.isClosed()) throw new Error('Electron renderer closed before Harness became ready')
    lastUrl = page.url()
    if (loopbackOrigin(lastUrl)) {
      try {
        const buddyVisible = await page.locator(buddySelector).isVisible()
        const hasTheme = await page.evaluate(() => (
          getComputedStyle(document.body).getPropertyValue('--dsw-alias-brand-primary').trim().length > 0
        ))
        if (buddyVisible && hasTheme) return
      } catch (error) {
        lastError = error
      }
    }
    await wait(500)
  }

  throw new Error(`official Harness did not stabilize at a loopback UI before timeout; last URL ${safeUrl(lastUrl)}${lastError ? `; last error ${redact(lastError.message)}` : ''}`)
}

async function desktopStatus(page) {
  const status = await page.evaluate(() => window.sandroneDesktop?.getStatus())
  return {
    phase: status?.phase ?? null,
    url: status?.url ?? null,
    error: status?.error ? redact(status.error) : null,
    attempts: Number(status?.attempts ?? 0),
    logCount: Array.isArray(status?.logs) ? status.logs.length : 0,
    logs: Array.isArray(status?.logs) ? status.logs.map(redact) : [],
  }
}

async function acceptPreviewNotice(page) {
  const notice = page.getByRole('dialog').filter({ hasText: /内测声明|Preview Notice/i }).first()
  if (!await notice.isVisible()) return false
  await notice.getByRole('button', { name: /继续|Continue/i }).click()
  await notice.waitFor({ state: 'hidden', timeout: 30_000 })
  return true
}

async function deferApiKeyOnboarding(page) {
  const onboarding = page.getByRole('dialog').filter({ hasText: /添加一个 API Key|Add an API Key/i }).first()
  try {
    await onboarding.waitFor({ state: 'visible', timeout: 10_000 })
  } catch {
    return false
  }
  await onboarding.getByRole('button', { name: /稍后配置|Configure later/i }).click()
  await onboarding.waitFor({ state: 'hidden', timeout: 30_000 })
  return true
}

async function addWorkspaceThroughNativePicker(page, workspacePath) {
  // The desktop shows the OS-native directory dialog (Electron
  // dialog.showOpenDialog); automated runs resolve SANDRONE_QA_PICK_DIRECTORY
  // instead, so clicking the add-workspace button adopts the fixture path.
  const openWorkspace = page.getByRole('button', { name: /添加工作区/ }).first()
  await openWorkspace.waitFor({ state: 'visible', timeout: 30_000 })
  await openWorkspace.click()
  const workspaceTitle = page.getByText('workspace-fixture', { exact: true }).first()
  await workspaceTitle.waitFor({ state: 'visible', timeout: 30_000 })
}

async function main() {
  const startedAt = new Date()
  const outputDirectory = join(root, 'runtime', 'tmp', `qa-electron-${timestampName(startedAt)}`)
  const profileRoot = join(outputDirectory, 'profile')
  const roamingDirectory = join(profileRoot, 'roaming')
  const localDirectory = join(profileRoot, 'local')
  const chromiumUserDataDirectory = join(profileRoot, 'chromium')
  const temporaryDirectory = join(outputDirectory, 'tmp')
  const workspaceDirectory = join(outputDirectory, 'workspace-fixture')
  const reportPath = join(outputDirectory, 'report.json')
  const entrypoint = join(root, 'apps', 'desktop', 'main.cjs')
  const readyTimeoutMs = timeoutFromEnvironment()
  const report = {
    schemaVersion: 1,
    startedAt: startedAt.toISOString(),
    outputDirectory,
    profileRoot,
    environment: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      readyTimeoutMs,
    },
    checks: [],
    failures: [],
    diagnostics: { consoleErrors: [], pageErrors: [], stdout: [], stderr: [] },
    application: {},
    lifecycle: {},
  }
  let application
  let firstWindow
  let rootPid
  let origin
  let watchedProcesses = []
  let closeResult = { attempted: false, graceful: false, forced: false, error: null }

  await Promise.all([
    mkdir(roamingDirectory, { recursive: true }),
    mkdir(localDirectory, { recursive: true }),
    mkdir(chromiumUserDataDirectory, { recursive: true }),
    mkdir(temporaryDirectory, { recursive: true }),
    mkdir(workspaceDirectory, { recursive: true }),
  ])

  try {
    const [playwright, electron] = await Promise.all([loadElectronDriver(), electronExecutable()])
    report.environment.playwright = { version: playwright.version, packageRoot: playwright.packageRoot }
    report.environment.electron = { version: electron.version, executablePath: electron.executablePath }
    const launchEnvironment = {
      ...process.env,
      APPDATA: roamingDirectory,
      LOCALAPPDATA: localDirectory,
      TEMP: temporaryDirectory,
      TMP: temporaryDirectory,
      ELECTRON_USER_DATA_DIR: chromiumUserDataDirectory,
      SANDRONE_QA_PICK_DIRECTORY: workspaceDirectory,
    }
    // The QA harness itself may run under Electron-as-Node (ELECTRON_RUN_AS_NODE=1);
    // that must never leak into the desktop app under test or require('electron')
    // loses the app APIs and the process exits during launch.
    delete launchEnvironment.ELECTRON_RUN_AS_NODE

    application = await playwright.electron.launch({
      executablePath: electron.executablePath,
      args: [`--user-data-dir=${chromiumUserDataDirectory}`, entrypoint],
      cwd: root,
      env: launchEnvironment,
      timeout: 30_000,
    })
    rootPid = application.process().pid
    report.application.rootPid = rootPid
    application.process().stdout?.on('data', chunk => {
      report.diagnostics.stdout.push(redact(chunk))
      if (report.diagnostics.stdout.length > 200) report.diagnostics.stdout.shift()
    })
    application.process().stderr?.on('data', chunk => {
      report.diagnostics.stderr.push(redact(chunk))
      if (report.diagnostics.stderr.length > 200) report.diagnostics.stderr.shift()
    })

    firstWindow = await application.firstWindow({ timeout: 30_000 })
    firstWindow.on('console', message => {
      if (message.type() === 'error') report.diagnostics.consoleErrors.push(redact(message.text()))
    })
    firstWindow.on('pageerror', error => report.diagnostics.pageErrors.push(redact(error.stack ?? error.message)))

    const electronPaths = await application.evaluate(({ app }) => ({
      appPath: app.getAppPath(),
      userData: app.getPath('userData'),
      sessionData: app.getPath('sessionData'),
    }))
    report.application.paths = electronPaths
    const isolatedUserData = isPathInside(electronPaths.userData, profileRoot)
    const isolatedSessionData = isPathInside(electronPaths.sessionData, profileRoot)
    recordCheck(report, 'Electron userData is isolated under runtime/tmp', isolatedUserData, electronPaths.userData)
    recordCheck(report, 'Electron sessionData is isolated under runtime/tmp', isolatedSessionData, electronPaths.sessionData)
    if (!isolatedUserData || !isolatedSessionData) {
      throw new Error('Electron data paths escaped the isolated QA profile; stopping before desktop interaction')
    }

    recordCheck(report, 'desktop deploys Harness state under isolated userData', await pathExists(join(electronPaths.userData, 'DeepSeekHarness')), join(electronPaths.userData, 'DeepSeekHarness'))
    await waitForOfficialHarness(firstWindow, readyTimeoutMs)
    origin = loopbackOrigin(firstWindow.url())
    const initialStatus = await desktopStatus(firstWindow)
    const initialWindows = application.windows()
    report.application.initial = {
      url: safeUrl(firstWindow.url()),
      origin,
      title: await firstWindow.title(),
      status: initialStatus,
      windowCount: initialWindows.length,
    }
    recordCheck(report, 'official Harness uses an exact 127.0.0.1 HTTP origin', Boolean(origin), firstWindow.url())
    recordCheck(report, 'desktop has exactly one renderer window', initialWindows.length === 1, initialWindows.map(window => safeUrl(window.url())))
    recordCheck(report, 'desktop supervisor is ready on the visible origin', initialStatus.phase === 'ready' && initialStatus.url === origin, initialStatus)
    report.application.previewNoticeAccepted = await acceptPreviewNotice(firstWindow)
    report.application.apiKeyOnboardingDeferred = await deferApiKeyOnboarding(firstWindow)
    recordCheck(report, 'Sandrone Buddy surface is visible', await firstWindow.locator(buddySelector).first().isVisible(), buddySelector)
    await addWorkspaceThroughNativePicker(firstWindow, workspaceDirectory)
    const workspaceTitle = firstWindow.getByText('workspace-fixture', { exact: true }).first()
    await workspaceTitle.waitFor({ state: 'visible', timeout: 30_000 })
    recordCheck(report, 'workspace directory picker adopts a selected directory', await workspaceTitle.isVisible(), workspaceDirectory)
    const initialScreenshot = join(outputDirectory, 'desktop-initial.png')
    await firstWindow.screenshot({ path: initialScreenshot, fullPage: false })
    report.application.initial.screenshot = initialScreenshot

    watchedProcesses = await electronProcesses(application, rootPid)
    report.lifecycle.processesBeforeReload = watchedProcesses

    await firstWindow.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 })
    await waitForOfficialHarness(firstWindow, readyTimeoutMs)
    const reloadedOrigin = loopbackOrigin(firstWindow.url())
    const reloadedStatus = await desktopStatus(firstWindow)
    const reloadedWindows = application.windows()
    report.application.afterReload = {
      url: safeUrl(firstWindow.url()),
      origin: reloadedOrigin,
      status: reloadedStatus,
      windowCount: reloadedWindows.length,
    }
    recordCheck(report, 'reload preserves the official Harness origin', Boolean(origin) && reloadedOrigin === origin, { before: origin, after: reloadedOrigin })
    recordCheck(report, 'reload preserves the ready supervisor generation', reloadedStatus.phase === 'ready' && reloadedStatus.url === origin, reloadedStatus)
    recordCheck(report, 'reload keeps exactly one renderer window', reloadedWindows.length === 1, reloadedWindows.map(window => safeUrl(window.url())))
    recordCheck(report, 'reload restores Sandrone Buddy surface', await firstWindow.locator(buddySelector).first().isVisible(), buddySelector)
    recordCheck(report, 'reload preserves the selected workspace', await firstWindow.getByText('workspace-fixture', { exact: true }).first().isVisible(), workspaceDirectory)
    const reloadedScreenshot = join(outputDirectory, 'desktop-after-reload.png')
    await firstWindow.screenshot({ path: reloadedScreenshot, fullPage: false })
    report.application.afterReload.screenshot = reloadedScreenshot

    // Settings must render as a standalone page filling the window below the
    // 38px titlebar, not as a centered floating dialog. A renderer reload can
    // resurface the onboarding dialog, so defer it again before clicking.
    await acceptPreviewNotice(firstWindow)
    await deferApiKeyOnboarding(firstWindow)
    const settingsTrigger = firstWindow.locator('[data-sandrone-settings] button').first()
    await settingsTrigger.waitFor({ state: 'visible', timeout: 30_000 })
    await settingsTrigger.click()
    const settingsPanel = firstWindow.locator('[role="dialog"][aria-modal="true"]').first()
    await settingsPanel.waitFor({ state: 'visible', timeout: 30_000 })
    const settingsBox = await settingsPanel.boundingBox()
    const viewport = await firstWindow.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
    const panelStyle = await firstWindow.evaluate(() => {
      const element = document.querySelector('[role="dialog"][aria-modal="true"]')
      if (!element) return null
      const style = getComputedStyle(element)
      const sandroneTag = document.querySelector('style[data-plugin="@sandrone/harness-ui"]')
      return {
        className: element.className,
        top: style.top,
        height: style.height,
        width: style.width,
        maxWidth: style.maxWidth,
        borderRadius: style.borderRadius,
        sandroneCssHasPanelRule: sandroneTag ? sandroneTag.textContent.includes('[class*="VOzbGW_panel"]') : null,
        panelRuleMatches: [...document.querySelectorAll('[class*="VOzbGW_panel"]')].map(node => node.className),
      }
    })
    const settingsPageFillsWindow = Boolean(settingsBox && viewport)
      && settingsBox.x <= 4
      && Math.abs(settingsBox.y - 38) <= 4
      && Math.abs(settingsBox.width - viewport.width) <= 4
      && Math.abs(settingsBox.height - (viewport.height - 38)) <= 4
    recordCheck(report, 'settings renders as a full page below the titlebar', settingsPageFillsWindow, { box: settingsBox, viewport, panelStyle })
    const backToWorkspace = firstWindow.getByRole('button', { name: '返回工作区', exact: true })
    await backToWorkspace.waitFor({ state: 'visible', timeout: 30_000 })
    const settingsSearch = firstWindow.getByPlaceholder('搜索设置')
    await settingsSearch.waitFor({ state: 'visible', timeout: 30_000 })
    await settingsSearch.fill('其他')
    const filteredNavOk = await firstWindow.getByRole('button', { name: /通用设置/ }).isHidden()
      && await firstWindow.getByRole('button', { name: '其他', exact: true }).isVisible()
    recordCheck(report, 'settings chrome shows back-to-workspace and a filtering section search', filteredNavOk, {})
    await settingsSearch.fill('')
    const otherNav = firstWindow.getByRole('button', { name: '其他', exact: true })
    await otherNav.click()
    const gpuSwitch = firstWindow.getByRole('switch')
    await gpuSwitch.waitFor({ state: 'visible', timeout: 30_000 })
    // Wait until the async GPU state IPC resolves (fresh profile starts on).
    const gpuDeadline = Date.now() + 30_000
    for (;;) {
      if (await gpuSwitch.getAttribute('aria-checked') === 'true') break
      if (Date.now() > gpuDeadline) throw new Error('GPU switch never resolved its initial state')
      await wait(250)
    }
    const gpuGeometry = await firstWindow.evaluate(() => {
      const describe = element => {
        if (!element) return null
        const rect = element.getBoundingClientRect()
        return {
          tag: element.tagName,
          cls: String(element.className).slice(0, 40),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
          x: Math.round(rect.x),
          y: Math.round(rect.y),
        }
      }
      const row = document.querySelector('.sandrone-setting-row')
      const section = document.querySelector('.sandrone-settings-other')
      const options = row?.closest('[class*="options"]') ?? null
      return {
        switch: describe(document.querySelector('.sandrone-setting-switch')),
        row: describe(row),
        section: describe(section),
        options: describe(options),
        panel: describe(document.querySelector('[class*="VOzbGW_panel"]')),
      }
    })
    const gpuBefore = await gpuSwitch.getAttribute('aria-checked')
    await gpuSwitch.click()
    const gpuAfter = await gpuSwitch.getAttribute('aria-checked')
    const gpuSane = Boolean(gpuGeometry)
      && gpuGeometry.row !== null && gpuGeometry.row.h < 200
      && gpuGeometry.switch !== null && gpuGeometry.switch.w === 40 && gpuGeometry.switch.h === 22
    recordCheck(report, 'settings 其他 section exposes a toggling GPU acceleration switch', gpuBefore !== null && gpuAfter !== null && gpuBefore !== gpuAfter && gpuSane, { before: gpuBefore, after: gpuAfter, geometry: gpuGeometry })
    await gpuSwitch.click()
    await firstWindow.keyboard.press('Escape')
    await settingsPanel.waitFor({ state: 'hidden', timeout: 30_000 })

    // Sidebar search: SandroneCode-style flat row with a live result view and
    // a clear control. A fresh profile has no sessions, so presence (not
    // result rows) is asserted; Escape collapses the search again.
    const searchButton = firstWindow.getByRole('button', { name: '搜索会话', exact: true })
    await searchButton.click()
    const searchInput = firstWindow.getByPlaceholder('搜索项目、会话')
    await searchInput.waitFor({ state: 'visible', timeout: 30_000 })
    await searchInput.fill('zz-no-such-session')
    const searchTree = firstWindow.locator('[aria-label="搜索结果"]')
    await searchTree.waitFor({ state: 'visible', timeout: 30_000 })
    const searchClearVisible = await firstWindow.getByRole('button', { name: '清除搜索', exact: true }).isVisible()
    recordCheck(report, 'sidebar search expands with a live result view and clear control', searchClearVisible, { clearVisible: searchClearVisible })
    await firstWindow.keyboard.press('Escape')
    await searchTree.waitFor({ state: 'hidden', timeout: 30_000 })

    watchedProcesses = mergeProcessIdentities(watchedProcesses, await electronProcesses(application, rootPid))
    report.lifecycle.processesBeforeClose = watchedProcesses
  } catch (error) {
    report.fatalError = redact(error.stack ?? error.message)
    if (firstWindow && !firstWindow.isClosed()) {
      try {
        report.application.failureStatus = await desktopStatus(firstWindow)
      } catch {}
      try {
        report.application.failureDialogs = await firstWindow.locator('[role="dialog"]:visible').allTextContents()
        const failureScreenshot = join(outputDirectory, 'desktop-failure.png')
        await firstWindow.screenshot({ path: failureScreenshot, fullPage: false })
        report.application.failureScreenshot = failureScreenshot
      } catch {}
    }
  } finally {
    if (application) {
      if (rootPid) {
        try {
          watchedProcesses = mergeProcessIdentities(watchedProcesses, await electronProcesses(application, rootPid))
        } catch {}
      }
      closeResult.attempted = true
      try {
        await withTimeout(application.close(), shutdownTimeoutMs, `Electron did not close within ${shutdownTimeoutMs}ms`)
        closeResult.graceful = true
      } catch (error) {
        closeResult.error = redact(error.stack ?? error.message)
        closeResult.forced = true
        await forceStopProcessTree(rootPid)
      }
    }

    if (rootPid) {
      try {
        const shutdown = await waitForShutdown({ identities: watchedProcesses, origin })
        report.lifecycle.shutdown = shutdown
        recordCheck(report, 'Electron closes through the graceful quit path', closeResult.graceful && !closeResult.forced, closeResult)
        recordCheck(report, 'no captured Electron child process remains after close', shutdown.residualIdentities.length === 0, shutdown.residualIdentities)
        recordCheck(report, 'Harness loopback server closes with Electron', !shutdown.serverReachable, { origin, reachable: shutdown.serverReachable })
      } catch (error) {
        report.failures.push(`shutdown verification failed: ${redact(error.stack ?? error.message)}`)
      }
    }

    report.lifecycle.close = closeResult
    report.completedAt = new Date().toISOString()
    report.passed = !report.fatalError && report.failures.length === 0
    report.summary = {
      totalChecks: report.checks.length,
      passedChecks: report.checks.filter(check => check.passed).length,
      failedChecks: report.checks.filter(check => !check.passed).length,
    }
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  }

  console.log(`[qa:desktop] report: ${reportPath}`)
  console.log(`[qa:desktop] ${report.passed ? 'passed' : 'failed'} (${report.summary.passedChecks}/${report.summary.totalChecks} checks)`)
  if (!report.passed) process.exitCode = 1
}

await main()
