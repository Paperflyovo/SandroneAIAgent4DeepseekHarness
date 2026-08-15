import { createRequire } from 'node:module'
import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const readyTimeoutMs = 120_000
const buddySelector = '[aria-label="Sandrone Buddy"]'
const buddyLauncherSelector = '[aria-label="Open Sandrone Buddy"]'
const pluginStyleSelector = 'style[data-plugin="@sandrone/harness-ui"][data-plugin-css="@sandrone/harness-ui/client.css"]'
const cases = Object.freeze([
  { name: 'desktop-1440', viewport: { width: 1440, height: 900 }, colorScheme: 'light', reducedMotion: 'no-preference' },
  { name: 'compact-900', viewport: { width: 900, height: 800 }, colorScheme: 'dark', reducedMotion: 'no-preference' },
  { name: 'mobile-390', viewport: { width: 390, height: 844 }, colorScheme: 'light', reducedMotion: 'no-preference' },
  { name: 'mobile-390-reduced-motion', viewport: { width: 390, height: 844 }, colorScheme: 'dark', reducedMotion: 'reduce' },
])

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
    const query = parsed.search ? '?[redacted]' : ''
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}${query}`
  } catch {
    return redact(value)
  }
}

function harnessOrigin() {
  const configured = process.env.HARNESS_ORIGIN?.trim()
  if (!configured) throw new Error('HARNESS_ORIGIN is required, for example http://127.0.0.1:3080')
  const parsed = new URL(configured)
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('HARNESS_ORIGIN must use http or https')
  if (!['127.0.0.1', 'localhost', '::1'].includes(hostname)) throw new Error('HARNESS_ORIGIN must be a loopback origin')
  if (parsed.username || parsed.password) throw new Error('HARNESS_ORIGIN must not contain credentials')
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) throw new Error('HARNESS_ORIGIN must not contain a path, query, or hash')
  return parsed.origin
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
  } catch {
    // This project intentionally consumes Codex's bundled browser tooling.
  }

  try {
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
  } catch {
    // PLAYWRIGHT_PACKAGE_ROOT remains the portable escape hatch.
  }

  return [...new Set(candidates)]
}

async function loadPlaywright() {
  const override = process.env.PLAYWRIGHT_PACKAGE_ROOT?.trim()
  const candidates = override ? [override] : await bundledPlaywrightCandidates()

  for (const candidate of candidates) {
    const inspected = await inspectPlaywrightRoot(candidate)
    if (!inspected) continue
    const loaded = require(inspected.packageRoot)
    if (!loaded?.chromium) throw new Error(`Playwright at ${inspected.packageRoot} does not expose chromium`)
    return { ...inspected, chromium: loaded.chromium }
  }

  const hint = override
    ? `PLAYWRIGHT_PACKAGE_ROOT does not point to a Playwright package: ${override}`
    : 'Codex bundled Playwright was not found; set PLAYWRIGHT_PACKAGE_ROOT to its package directory'
  throw new Error(hint)
}

async function activateControl(locator, result, name) {
  try {
    await locator.click({ timeout: 5_000 })
    result.actions.push({ name, mode: 'pointer' })
  } catch (error) {
    await locator.evaluate(element => element.click())
    result.actions.push({
      name,
      mode: 'DOM fallback',
      note: `Pointer activation was obstructed, usually by first-run onboarding: ${redact(error.message)}`,
    })
  }
}

function recordCheck(result, name, passed, detail) {
  result.checks.push({ name, passed, detail })
  if (!passed) result.failures.push(`${name}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`)
}

function attachDiagnostics(page, diagnostics, getPhase, isActive) {
  page.on('console', message => {
    if (!isActive() || message.type() !== 'error') return
    const location = message.location()
    diagnostics.consoleErrors.push({
      phase: getPhase(),
      text: redact(message.text()),
      location: location.url ? { url: safeUrl(location.url), line: location.lineNumber, column: location.columnNumber } : null,
    })
  })
  page.on('pageerror', error => {
    if (!isActive()) return
    diagnostics.pageErrors.push({ phase: getPhase(), message: redact(error.message), stack: redact(error.stack) })
  })
  page.on('crash', () => {
    if (!isActive()) return
    diagnostics.pageErrors.push({ phase: getPhase(), message: 'Renderer page crashed', stack: '' })
  })
  page.on('requestfailed', request => {
    if (!isActive()) return
    const errorText = request.failure()?.errorText ?? 'unknown request failure'
    diagnostics.requestErrors.push({
      phase: getPhase(),
      method: request.method(),
      resourceType: request.resourceType(),
      url: safeUrl(request.url()),
      error: redact(errorText),
      ignoredForPass: /ERR_ABORTED/i.test(errorText) && getPhase().includes('reload'),
    })
  })
  page.on('response', response => {
    if (!isActive() || response.status() < 400) return
    diagnostics.httpErrors.push({
      phase: getPhase(),
      status: response.status(),
      statusText: redact(response.statusText()),
      resourceType: response.request().resourceType(),
      url: safeUrl(response.url()),
    })
  })
  page.on('websocket', socket => {
    socket.on('socketerror', error => {
      if (!isActive()) return
      diagnostics.webSocketErrors.push({ phase: getPhase(), url: safeUrl(socket.url()), error: redact(error) })
    })
  })
}

async function waitForHarness(page) {
  await page.waitForLoadState('domcontentloaded', { timeout: readyTimeoutMs })
  await page.locator(`${buddySelector}, ${buddyLauncherSelector}`).first().waitFor({ state: 'visible', timeout: readyTimeoutMs })
  await page.waitForFunction(() => (
    getComputedStyle(document.body).getPropertyValue('--dsw-alias-brand-primary').trim().length > 0
  ), undefined, { timeout: readyTimeoutMs })
  await page.waitForTimeout(200)
}

async function inspectSurface(page) {
  return page.evaluate(({ buddySelector: panelSelector, buddyLauncherSelector: launcherSelector, pluginStyleSelector: styleSelector }) => {
    const rootElement = document.documentElement
    const bodyElement = document.body
    const clientWidth = rootElement.clientWidth
    const scrollWidth = Math.max(rootElement.scrollWidth, bodyElement.scrollWidth)
    const overflowPixels = Math.max(0, scrollWidth - clientWidth)
    const offenders = []

    if (overflowPixels > 1) {
      for (const element of bodyElement.querySelectorAll('*')) {
        const style = getComputedStyle(element)
        if (style.display === 'none' || style.visibility === 'hidden') continue
        const rectangle = element.getBoundingClientRect()
        if (rectangle.width === 0 || rectangle.height === 0) continue
        if (rectangle.left >= -1 && rectangle.right <= window.innerWidth + 1) continue
        const classes = typeof element.className === 'string'
          ? element.className.trim().split(/\s+/).filter(Boolean).slice(0, 3).join('.')
          : ''
        offenders.push({
          element: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}${classes ? `.${classes}` : ''}`,
          left: Math.round(rectangle.left * 10) / 10,
          right: Math.round(rectangle.right * 10) / 10,
          width: Math.round(rectangle.width * 10) / 10,
          position: style.position,
        })
        if (offenders.length === 12) break
      }
    }

    const bodyStyle = getComputedStyle(bodyElement)
    const buddyPanel = document.querySelector(panelSelector)
    const buddyLauncher = document.querySelector(launcherSelector)
    const frame = document.querySelector('[data-sandrone-frame]')
    const center = document.querySelector('[data-sandrone-center]')
    const sidebar = document.querySelector('[data-sandrone-sidebar]')
    const composerCard = center?.querySelector('[data-composer-card]') || document.querySelector('[data-composer-card]')
    const dark = bodyElement.hasAttribute('data-ds-dark-theme')
    const brandPrimary = bodyStyle.getPropertyValue('--dsw-alias-brand-primary').trim()
    const background = bodyStyle.getPropertyValue('--dsw-alias-bg-base').trim()
    const labelPrimary = bodyStyle.getPropertyValue('--dsw-alias-label-primary').trim()

    const normalizeColor = value => {
      const probe = document.createElement('span')
      probe.style.color = value
      bodyElement.appendChild(probe)
      const normalized = getComputedStyle(probe).color
      probe.remove()
      return normalized
    }

    let buddyPreference = null
    try {
      buddyPreference = localStorage.getItem('sandrone.harness.buddy.v1')
    } catch {
      buddyPreference = 'unavailable'
    }

    return {
      location: `${location.origin}${location.pathname}`,
      viewport: { innerWidth: window.innerWidth, innerHeight: window.innerHeight, clientWidth, scrollWidth, overflowPixels },
      overflowOffenders: offenders,
      buddy: {
        panelCount: document.querySelectorAll(panelSelector).length,
        launcherCount: document.querySelectorAll(launcherSelector).length,
        preference: buddyPreference,
        animationName: buddyPanel ? getComputedStyle(buddyPanel).animationName : null,
      },
      pluginStylesheetCount: document.querySelectorAll(styleSelector).length,
      markers: {
        shell: document.querySelectorAll('[data-sandrone-shell]').length,
        frame: frame ? 1 : 0,
        sidebar: sidebar ? 1 : 0,
        sidebarHeader: document.querySelectorAll('[data-sandrone-sidebar-header]').length,
        workspaces: document.querySelectorAll('[data-sandrone-workspaces]').length,
        settings: document.querySelectorAll('[data-sandrone-settings]').length,
        topbar: document.querySelectorAll('[data-sandrone-topbar]').length,
        center: center ? 1 : 0,
        sessionBody: document.querySelectorAll('[data-sandrone-session-body]').length,
        composerInput: document.querySelectorAll('[data-sandrone-composer-input]').length,
      },
      sandroneStyles: composerCard ? (() => {
        const style = getComputedStyle(composerCard)
        return {
          borderColor: style.borderColor,
          borderWidth: style.borderWidth,
          borderRadius: style.borderRadius,
          backgroundColor: style.backgroundColor,
        }
      })() : null,
      theme: {
        activeMode: dark ? 'dark' : 'light',
        requestedSystemMode: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
        colorScheme: getComputedStyle(rootElement).colorScheme,
        brandPrimary,
        background,
        labelPrimary,
        expectedBrandPrimary: dark ? '#c8a882' : '#b99f86',
        brandMatchesSandroneLayer: normalizeColor(brandPrimary) === normalizeColor(dark ? '#c8a882' : '#b99f86'),
      },
    }
  }, { buddySelector, buddyLauncherSelector, pluginStyleSelector })
}

function checkSurface(result, label, surface, expected, caseSpec) {
  recordCheck(result, `${label}: exact viewport width`, surface.viewport.innerWidth === caseSpec.viewport.width, surface.viewport)
  recordCheck(result, `${label}: no document overflow`, surface.viewport.overflowPixels <= 1, {
    viewport: surface.viewport,
    offenders: surface.overflowOffenders,
  })
  recordCheck(result, `${label}: one Buddy surface`, surface.buddy.panelCount + surface.buddy.launcherCount === 1, surface.buddy)
  recordCheck(result, `${label}: expected Buddy state`, expected === 'panel'
    ? surface.buddy.panelCount === 1 && surface.buddy.launcherCount === 0
    : surface.buddy.panelCount === 0 && surface.buddy.launcherCount === 1, surface.buddy)
  recordCheck(result, `${label}: one plugin stylesheet`, surface.pluginStylesheetCount === 1, surface.pluginStylesheetCount)
  recordCheck(result, `${label}: Sandrone semantic markers`, surface.markers.shell === 1
    && surface.markers.frame === 1
    && surface.markers.sidebar === 1
    && surface.markers.sidebarHeader === 1
    && surface.markers.workspaces === 1
    && surface.markers.settings === 1
    && surface.markers.topbar === 1
    && surface.markers.center === 1
    && surface.markers.composerInput >= 1, surface.markers)
  if (surface.sandroneStyles) {
    recordCheck(result, `${label}: composer keeps Sandrone border`, surface.sandroneStyles.borderColor === 'rgb(200, 16, 46)'
      && surface.sandroneStyles.borderWidth === '1px', surface.sandroneStyles)
    recordCheck(result, `${label}: composer keeps compact radius`, surface.sandroneStyles.borderRadius === '14px' || surface.sandroneStyles.borderRadius === '12px', surface.sandroneStyles)
  }
  recordCheck(result, `${label}: complete semantic theme`, Boolean(
    surface.theme.brandPrimary && surface.theme.background && surface.theme.labelPrimary
  ), surface.theme)
  recordCheck(result, `${label}: Sandrone theme matches active mode`, surface.theme.brandMatchesSandroneLayer, surface.theme)
  if (caseSpec.reducedMotion === 'reduce' && expected === 'panel') {
    recordCheck(result, `${label}: reduced motion disables Buddy animation`, surface.buddy.animationName === 'none', surface.buddy.animationName)
  }
}

async function runCase(browser, origin, outputDirectory, caseSpec) {
  const result = {
    name: caseSpec.name,
    viewport: caseSpec.viewport,
    requestedColorScheme: caseSpec.colorScheme,
    reducedMotion: caseSpec.reducedMotion,
    startedAt: new Date().toISOString(),
    checks: [],
    failures: [],
    actions: [],
    surfaces: {},
    screenshots: [],
    diagnostics: { consoleErrors: [], pageErrors: [], requestErrors: [], httpErrors: [], webSocketErrors: [] },
  }
  const context = await browser.newContext({
    viewport: caseSpec.viewport,
    colorScheme: caseSpec.colorScheme,
    reducedMotion: caseSpec.reducedMotion,
    locale: 'zh-CN',
  })
  const page = await context.newPage()
  let phase = 'initial-navigation'
  let diagnosticsActive = true
  attachDiagnostics(page, result.diagnostics, () => phase, () => diagnosticsActive)

  try {
    await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: readyTimeoutMs })
    await waitForHarness(page)
    result.surfaces.initial = await inspectSurface(page)
    checkSurface(result, 'initial', result.surfaces.initial, 'panel', caseSpec)

    const initialScreenshot = join(outputDirectory, `${caseSpec.name}-initial.png`)
    await page.screenshot({ path: initialScreenshot, fullPage: false })
    result.screenshots.push(initialScreenshot)

    phase = 'hide-buddy'
    await activateControl(page.locator('[aria-label="Hide Buddy"]'), result, 'hide Buddy')
    await page.locator(buddyLauncherSelector).waitFor({ state: 'visible', timeout: readyTimeoutMs })
    result.surfaces.hidden = await inspectSurface(page)
    checkSurface(result, 'hidden', result.surfaces.hidden, 'launcher', caseSpec)
    recordCheck(result, 'hidden: preference stored', result.surfaces.hidden.buddy.preference === 'hidden', result.surfaces.hidden.buddy.preference)

    phase = 'hidden-preference-reload'
    await page.reload({ waitUntil: 'domcontentloaded', timeout: readyTimeoutMs })
    await waitForHarness(page)
    result.surfaces.hiddenReload = await inspectSurface(page)
    checkSurface(result, 'hidden reload', result.surfaces.hiddenReload, 'launcher', caseSpec)
    recordCheck(result, 'hidden reload: preference restored', result.surfaces.hiddenReload.buddy.preference === 'hidden', result.surfaces.hiddenReload.buddy.preference)

    phase = 'open-buddy'
    await activateControl(page.locator(buddyLauncherSelector), result, 'open Buddy')
    await page.locator(buddySelector).waitFor({ state: 'visible', timeout: readyTimeoutMs })
    result.surfaces.reopened = await inspectSurface(page)
    checkSurface(result, 'reopened', result.surfaces.reopened, 'panel', caseSpec)
    recordCheck(result, 'reopened: preference stored', result.surfaces.reopened.buddy.preference === 'visible', result.surfaces.reopened.buddy.preference)

    result.surfaces.reloads = []
    for (let reloadIndex = 1; reloadIndex <= 3; reloadIndex += 1) {
      phase = `continuous-reload-${reloadIndex}`
      await page.reload({ waitUntil: 'domcontentloaded', timeout: readyTimeoutMs })
      await waitForHarness(page)
      const surface = await inspectSurface(page)
      result.surfaces.reloads.push(surface)
      checkSurface(result, `continuous reload ${reloadIndex}`, surface, 'panel', caseSpec)
      recordCheck(result, `continuous reload ${reloadIndex}: visible preference restored`, surface.buddy.preference === 'visible', surface.buddy.preference)
    }

    phase = 'final-screenshot'
    const finalScreenshot = join(outputDirectory, `${caseSpec.name}-final.png`)
    await page.screenshot({ path: finalScreenshot, fullPage: false })
    result.screenshots.push(finalScreenshot)
  } catch (error) {
    result.failures.push(`case execution failed during ${phase}: ${redact(error.stack ?? error.message)}`)
    try {
      const failureScreenshot = join(outputDirectory, `${caseSpec.name}-failure.png`)
      await page.screenshot({ path: failureScreenshot, fullPage: false })
      result.screenshots.push(failureScreenshot)
    } catch {
      result.failures.push('could not capture failure screenshot')
    }
  } finally {
    diagnosticsActive = false
    await context.close()
  }

  const requestFailures = result.diagnostics.requestErrors.filter(error => !error.ignoredForPass)
  const diagnosticCounts = {
    consoleErrors: result.diagnostics.consoleErrors.length,
    pageErrors: result.diagnostics.pageErrors.length,
    requestErrors: requestFailures.length,
    ignoredNavigationAborts: result.diagnostics.requestErrors.length - requestFailures.length,
    httpErrors: result.diagnostics.httpErrors.length,
    webSocketErrors: result.diagnostics.webSocketErrors.length,
  }
  const diagnosticFailureCount = diagnosticCounts.consoleErrors
    + diagnosticCounts.pageErrors
    + diagnosticCounts.requestErrors
    + diagnosticCounts.httpErrors
    + diagnosticCounts.webSocketErrors
  recordCheck(result, 'no browser, request, HTTP, or WebSocket errors', diagnosticFailureCount === 0, diagnosticCounts)
  result.completedAt = new Date().toISOString()
  result.passed = result.failures.length === 0
  return result
}

async function main() {
  const startedAt = new Date()
  const outputDirectory = join(root, 'runtime', 'tmp', `qa-web-${timestampName(startedAt)}`)
  await mkdir(outputDirectory, { recursive: true })
  const reportPath = join(outputDirectory, 'report.json')
  const report = {
    schemaVersion: 1,
    startedAt: startedAt.toISOString(),
    origin: null,
    outputDirectory,
    environment: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
    },
    cases: [],
  }
  let browser

  try {
    const origin = harnessOrigin()
    report.origin = origin
    const playwright = await loadPlaywright()
    report.environment.playwright = { version: playwright.version, packageRoot: playwright.packageRoot }
    browser = await playwright.chromium.launch({ channel: 'msedge', headless: true })
    report.environment.browser = { channel: 'msedge', version: browser.version() }
    for (const caseSpec of cases) {
      console.log(`[qa:web] ${caseSpec.name}`)
      report.cases.push(await runCase(browser, origin, outputDirectory, caseSpec))
    }
  } catch (error) {
    report.fatalError = redact(error.stack ?? error.message)
  } finally {
    if (browser) await browser.close()
    report.completedAt = new Date().toISOString()
    report.passed = !report.fatalError && report.cases.length === cases.length && report.cases.every(result => result.passed)
    report.summary = {
      passedCases: report.cases.filter(result => result.passed).length,
      failedCases: report.cases.filter(result => !result.passed).length,
      totalChecks: report.cases.reduce((count, result) => count + result.checks.length, 0),
      failedChecks: report.cases.reduce((count, result) => count + result.checks.filter(check => !check.passed).length, 0),
    }
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  }

  console.log(`[qa:web] report: ${reportPath}`)
  console.log(`[qa:web] ${report.passed ? 'passed' : 'failed'} (${report.summary.passedCases}/${cases.length} cases)`)
  if (!report.passed) process.exitCode = 1
}

await main()
