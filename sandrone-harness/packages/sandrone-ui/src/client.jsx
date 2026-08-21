import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  IconCloseOutline16,
  IconPaperclipOutline16,
  IconSparkle16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { installStyle } from './client.css'

export const inject = ['slots', 'theme']

const TOKEN_LAYER = Object.freeze({
  '--dsw-alias-brand-primary': { light: '#c5213d', dark: '#e07083' },
  '--dsw-alias-brand-text': { light: '#a91c35', dark: '#f0a0ad' },
  '--dsw-alias-button-primary-fill': { light: '#c5213d', dark: '#d76276' },
  '--dsw-alias-button-primary-hover': { light: '#a91c35', dark: '#f08a9a' },
  '--dsw-alias-bg-base': { light: '#faf8f4', dark: '#1d1b1a' },
  '--dsw-alias-bg-layer-1': { light: '#f0ece6', dark: '#252321' },
  '--dsw-alias-bg-layer-2': { light: '#fffdfa', dark: '#2b2927' },
  '--dsw-alias-bg-layer-3': { light: '#fffdfa', dark: '#302d2b' },
  '--dsw-alias-border-l1': { light: '#e1dbd2', dark: '#403b37' },
  '--dsw-alias-border-l2': { light: '#c9c0b6', dark: '#59504a' },
  '--dsw-alias-border-l2-darkmode-thin': { light: '#e1dbd2', dark: '#403b37' },
  '--dsw-alias-label-primary': { light: '#292522', dark: '#f2ece5' },
  '--dsw-alias-label-primary-dimmed': { light: '#4b4640', dark: '#d0c9c1' },
  '--dsw-alias-label-secondary': { light: '#5d5750', dark: '#bdb4aa' },
  '--dsw-alias-label-tertiary': { light: '#78716a', dark: '#a39a91' },
  '--dsw-alias-label-caption': { light: '#918981', dark: '#877e76' },
  '--dsw-alias-interactive-bg-hover': { light: '#f6e6e4', dark: '#442a2f' },
  '--dsw-alias-interactive-bg-hover-solid': { light: '#f2e9e2', dark: '#39312e' },
  '--dsw-alias-button-elevated-fill': { light: '#fffdfa', dark: '#2b2927' },
  '--dsw-alias-button-floating-fill': { light: '#fffdfa', dark: '#2b2927' },
  '--dsw-alias-button-floating-hover': { light: '#f6e6e4', dark: '#442a2f' },
  '--dsw-alias-button-info-fill': { light: '#c5213d', dark: '#d76276' },
  '--dsw-alias-button-info-hover': { light: '#a91c35', dark: '#f08a9a' },
  '--dsw-specific-bubble': { light: '#f3e5df', dark: '#442f2a' },
  '--dsw-specific-input-major': { light: '#fffdfa', dark: '#2b2927' },
  '--dsw-specific-selector': { light: '#f1ebe4', dark: '#393532' },
  '--dsw-specific-sidebar-fill': { light: '#f0ece6', dark: '#252321' },
  '--dsw-specific-sidebar-nav-item-active': { light: '#fffdfa', dark: '#442a2f' },
  '--dsw-specific-sidebar-nav-item-hover': { light: '#f6f0ea', dark: '#302d2b' },
})

const DESKTOP_SIDEBAR_WIDTH = 380

function markSurface() {
  const root = document.getElementById('root')
  const frame = root?.querySelector('[data-details-collapsed]') || root?.firstElementChild
  if (!root || !frame) return
  root.dataset.sandroneShell = 'true'
  frame.dataset.sandroneFrame = 'true'
  const columns = [...frame.children].filter(element => element instanceof HTMLElement)
  const sidebarColumn = columns.find(element => element.querySelector('[data-slot="sidebar"]'))
    || columns.find(element => element.querySelector('[aria-label="新建会话"], [aria-label="搜索会话"], [role="tree"]'))
  const centerColumn = columns.find(element => element.querySelector('[data-slot="conversation"]'))
    || columns.find(element => element.querySelector('[data-conversation-scroll], [data-composer-seat], [data-composer-card]'))
  const overlayColumn = columns.find(element => (
    element.matches('[data-shell-overlay]') || element.querySelector('[data-shell-overlay]')
  ))
  const detailsColumn = columns.find(element => (
    element !== sidebarColumn && element !== centerColumn && element !== overlayColumn
  ))
  sidebarColumn?.setAttribute('data-sandrone-sidebar-column', 'true')
  centerColumn?.setAttribute('data-sandrone-center', 'true')
  detailsColumn?.setAttribute('data-sandrone-details', 'true')
  overlayColumn?.setAttribute('data-sandrone-overlay', 'true')
  if (sidebarColumn) {
    const sidebarWidth = sidebarColumn.getBoundingClientRect().width
    root.style.setProperty('--sandrone-sidebar-width', `${sidebarWidth}px`)
    const sidebarCollapsed = frame.getAttribute('data-sidebar-collapsed') === 'true'
    const desktopShell = Boolean(window.sandroneDesktop)
    if (desktopShell) root.dataset.sandroneDesktop = 'true'
    // The desktop shell pins the sidebar to its brand width: stray resize
    // drags or page zoom cannot blow the frame apart, and the pin re-applies
    // on every DOM mutation so the layout heals itself.
    const pinDesktopWidth = desktopShell
      && window.innerWidth > 760
      && !sidebarCollapsed
      && sidebarWidth > 0
      && sidebarWidth !== DESKTOP_SIDEBAR_WIDTH
    const canNormalizeDesktopWidth = !desktopShell
      && window.innerWidth > 760
      && !sidebarCollapsed
      && !frame.dataset.sandroneSidebarUserResized
      && !frame.dataset.sandroneSidebarWidthNormalized
      && sidebarWidth > 0
      && sidebarWidth < DESKTOP_SIDEBAR_WIDTH
    if (pinDesktopWidth || canNormalizeDesktopWidth) {
      frame.style.setProperty('transition', 'none', 'important')
      frame.style.setProperty(
        'grid-template-columns',
        `${DESKTOP_SIDEBAR_WIDTH}px minmax(0, 1fr) 0px`,
        'important',
      )
      frame.dataset.sandroneSidebarWidthNormalized = 'true'
      root.style.setProperty('--sandrone-sidebar-width', `${DESKTOP_SIDEBAR_WIDTH}px`)
      window.requestAnimationFrame(() => frame.style.removeProperty('transition'))
    }
  }
  const sidebarRoot = sidebarColumn?.querySelector('[data-slot="sidebar"]') || sidebarColumn?.firstElementChild
  sidebarRoot?.setAttribute('data-sandrone-sidebar', 'true')
  sidebarRoot?.firstElementChild?.setAttribute('data-sandrone-sidebar', 'true')
  const sidebarHeader = sidebarRoot?.querySelector('[class*="logoRow"]') || sidebarRoot?.firstElementChild
  sidebarHeader?.setAttribute('data-sandrone-sidebar-header', 'true')
  if (sidebarHeader instanceof HTMLElement && window.innerWidth <= 760) {
    sidebarHeader.style.setProperty('height', '50px', 'important')
    sidebarHeader.style.setProperty('min-height', '50px', 'important')
  }
  if (sidebarHeader instanceof HTMLElement && window.innerWidth > 760) {
    const visualSidebarWidth = sidebarHeader.getBoundingClientRect().width
    const firstGridTrack = Number.parseFloat(getComputedStyle(frame).gridTemplateColumns)
    const measuredWidth = Math.max(
      visualSidebarWidth,
      Number.isFinite(firstGridTrack) ? firstGridTrack : 0,
    )
    if (measuredWidth > 0) root.style.setProperty('--sandrone-sidebar-width', `${measuredWidth}px`)
  }
  sidebarRoot?.querySelector('[data-slot="sidebar.workspaces"]')?.setAttribute('data-sandrone-workspaces', 'true')
  sidebarRoot?.querySelector('[data-slot="sidebar.settings"]')?.setAttribute('data-sandrone-settings', 'true')
  sidebarRoot?.querySelector('[data-slot="sidebar.workspaces"] input')?.setAttribute('placeholder', '搜索项目、会话...')
  const centerRoot = centerColumn?.querySelector('[data-slot="conversation"]')
  centerRoot?.querySelector('[data-slot="conversation.session.header"]')?.setAttribute('data-sandrone-session-header', 'true')
  centerRoot?.querySelector('[data-slot="conversation.session"]')?.setAttribute('data-sandrone-session-body', 'true')
  centerRoot?.querySelector('[data-slot="conversation.composer"], [data-composer-seat]')?.setAttribute('data-sandrone-composer', 'true')
  root.querySelectorAll('[aria-label="新建会话"]').forEach(element => element.setAttribute('data-sandrone-new-session', 'true'))
  root.querySelectorAll('[aria-label="搜索会话"], [aria-label="视图选项"], [aria-label="添加工作区"], [aria-label="新建工作区"]').forEach(element => element.setAttribute('data-sandrone-sidebar-action', 'true'))
  root.querySelectorAll('textarea').forEach(element => element.setAttribute('data-sandrone-composer-input', 'true'))
  root.querySelectorAll('[data-conversation-scroll], [data-composer-seat], [data-composer-card], [data-input-scroll], [role="tree"]').forEach(element => element.setAttribute('data-sandrone-surface-part', 'true'))
  root.querySelectorAll('[role="dialog"]').forEach(element => element.setAttribute('data-sandrone-dialog', 'true'))
}

function installSurfaceMarkers(ctx) {
  return ctx.effect(() => {
    markSurface()
    const observedRoot = document.getElementById('root') || document.body
    let frameId = 0
    const scheduleMark = () => {
      if (frameId !== 0) return
      frameId = window.requestAnimationFrame(() => {
        frameId = 0
        markSurface()
      })
    }
    const observer = new MutationObserver(scheduleMark)
    observer.observe(observedRoot, { childList: true, subtree: true })
    const resizeObserver = new ResizeObserver(scheduleMark)
    resizeObserver.observe(observedRoot)
    let mobileAutoExpanded = false
    const expandMobileSidebar = () => {
      if (mobileAutoExpanded || window.innerWidth > 760) return
      mobileAutoExpanded = true
      const collapsedButton = document.querySelector('[data-sandrone-sidebar] [aria-label="打开侧边栏"]')
      if (collapsedButton instanceof HTMLElement) collapsedButton.click()
    }
    window.setTimeout(expandMobileSidebar, 0)
    const handleSidebarResizeStart = event => {
      // The desktop shell keeps a fixed sidebar width; only the web app
      // releases the normalization when the user drags the resize handle.
      if (window.sandroneDesktop) return
      const target = event.target
      if (!(target instanceof Element)) return
      if (!target.closest('[class*="handle"]')) return
      const frame = document.querySelector('[data-sandrone-frame]')
      if (!(frame instanceof HTMLElement)) return
      frame.dataset.sandroneSidebarUserResized = 'true'
      frame.dataset.sandroneSidebarWidthNormalized = 'true'
      frame.style.removeProperty('grid-template-columns')
    }
    document.addEventListener('pointerdown', handleSidebarResizeStart, true)
    const handleComposerEnterFallback = event => {
      if (event.defaultPrevented || event.key !== 'Enter' || event.shiftKey || event.isComposing) return
      if (!(event.target instanceof HTMLTextAreaElement) || !event.target.matches('[data-sandrone-composer-input]')) return
      window.setTimeout(() => {
        const composer = event.target.closest('[data-sandrone-composer]') || document
        const send = [...composer.querySelectorAll('button')].find(button => {
          const label = button.getAttribute('aria-label') || ''
          return /^(发送|Send)$/.test(label) && !button.disabled
        })
        if (send instanceof HTMLElement) send.click()
      }, 0)
    }
    document.addEventListener('keydown', handleComposerEnterFallback)
    window.addEventListener('resize', scheduleMark, { passive: true })
    return () => {
      observer.disconnect()
      resizeObserver.disconnect()
      document.removeEventListener('pointerdown', handleSidebarResizeStart, true)
      document.removeEventListener('keydown', handleComposerEnterFallback)
      window.removeEventListener('resize', scheduleMark)
      if (frameId !== 0) window.cancelAnimationFrame(frameId)
      document.querySelectorAll('[data-sandrone-shell], [data-sandrone-frame], [data-sandrone-sidebar-column], [data-sandrone-sidebar], [data-sandrone-sidebar-header], [data-sandrone-workspaces], [data-sandrone-settings], [data-sandrone-center], [data-sandrone-details], [data-sandrone-overlay], [data-sandrone-session-header], [data-sandrone-session-body], [data-sandrone-composer], [data-sandrone-new-session], [data-sandrone-sidebar-action], [data-sandrone-composer-input], [data-sandrone-surface-part], [data-sandrone-dialog]').forEach(element => {
        delete element.dataset.sandroneShell
        delete element.dataset.sandroneFrame
        delete element.dataset.sandroneSidebarColumn
        delete element.dataset.sandroneSidebar
        delete element.dataset.sandroneSidebarHeader
        delete element.dataset.sandroneWorkspaces
        delete element.dataset.sandroneSettings
        delete element.dataset.sandroneCenter
        delete element.dataset.sandroneDetails
        delete element.dataset.sandroneOverlay
        delete element.dataset.sandroneSessionHeader
        delete element.dataset.sandroneSessionBody
        delete element.dataset.sandroneComposer
        delete element.dataset.sandroneNewSession
        delete element.dataset.sandroneSidebarAction
        delete element.dataset.sandroneComposerInput
        delete element.dataset.sandroneSurfacePart
        delete element.dataset.sandroneDialog
        delete element.dataset.sandroneDesktop
      })
      document.getElementById('root')?.style.removeProperty('--sandrone-sidebar-width')
    }
  }, 'sandrone-ui: semantic surface markers')
}

function clickOfficial(selector) {
  const element = [...document.querySelectorAll(selector)].find(candidate => {
    if (!(candidate instanceof HTMLElement)) return false
    const style = getComputedStyle(candidate)
    const rect = candidate.getBoundingClientRect()
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
  }) || document.querySelector(selector)
  if (element instanceof HTMLElement) element.click()
}

const textOf = element => (element?.textContent || '').replace(/\s+/g, ' ').trim()

/* The titlebar arrows switch between the app's pages (settings page, active
   session, conversation view tab) without touching browser history — going
   back through window.history would land on the Electron loading page. */
function readPageState() {
  const settingsOpen = Boolean(document.querySelector('[role="dialog"][aria-modal="true"]'))
  const sessionRow = document.querySelector('[data-sandrone-workspaces] [role="treeitem"][aria-selected="true"]')
  const sessionTitle = sessionRow ? textOf(sessionRow.querySelector('[class*="title"]') || sessionRow) : ''
  const activeTab = document.querySelector('[data-sandrone-session-header] [role="tab"][aria-selected="true"]')
  const viewLabel = activeTab ? textOf(activeTab) : ''
  return { settingsOpen, sessionTitle, viewLabel }
}

function pageKey(state) {
  return `${state.settingsOpen ? '1' : '0'}|${state.sessionTitle}|${state.viewLabel}`
}

function clickSessionRow(title) {
  if (!title) return
  const rows = [...document.querySelectorAll('[data-sandrone-workspaces] [role="treeitem"][aria-selected]')]
  const row = rows.find(candidate => textOf(candidate.querySelector('[class*="title"]') || candidate) === title)
  if (row instanceof HTMLElement) row.click()
}

function clickViewTab(label) {
  if (!label) return
  const tabs = [...document.querySelectorAll('[data-sandrone-session-header] [role="tab"]')]
  const tab = tabs.find(candidate => textOf(candidate) === label)
  if (tab instanceof HTMLElement) tab.click()
}

function usePageNavigation() {
  const navigateRef = useRef(null)

  useEffect(() => {
    const root = document.getElementById('root') || document.body
    let currentKey = null
    let currentSnapshot = null
    let restoring = false
    let pending = false
    const backStack = []
    const forwardStack = []

    const settle = () => {
      pending = false
      const state = readPageState()
      const key = pageKey(state)
      if (key === currentKey) return
      if (restoring || currentKey === null) {
        currentKey = key
        currentSnapshot = state
        return
      }
      if (currentSnapshot) backStack.push(currentSnapshot)
      forwardStack.length = 0
      currentKey = key
      currentSnapshot = state
    }
    const scheduleSettle = () => {
      if (pending) return
      pending = true
      requestAnimationFrame(settle)
    }

    const restore = target => {
      if (!target) return
      const state = readPageState()
      restoring = true
      try {
        if (target.settingsOpen && !state.settingsOpen) {
          clickOfficial('[data-sandrone-settings] button')
        } else if (!target.settingsOpen && state.settingsOpen) {
          clickOfficial('[data-sandrone-settings-close]')
        }
        if (target.sessionTitle && state.sessionTitle !== target.sessionTitle) {
          clickSessionRow(target.sessionTitle)
        }
        if (target.viewLabel && state.viewLabel !== target.viewLabel) {
          clickViewTab(target.viewLabel)
        }
      } finally {
        window.setTimeout(() => {
          restoring = false
          currentSnapshot = readPageState()
          currentKey = pageKey(currentSnapshot)
        }, 250)
      }
    }

    navigateRef.current = {
      back: () => {
        const target = backStack.pop()
        if (!target) return
        forwardStack.push(currentSnapshot)
        restore(target)
      },
      forward: () => {
        const target = forwardStack.pop()
        if (!target) return
        backStack.push(currentSnapshot)
        restore(target)
      },
    }

    const observer = new MutationObserver(scheduleSettle)
    observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['aria-selected'],
    })
    scheduleSettle()
    return () => {
      observer.disconnect()
      navigateRef.current = null
    }
  }, [])

  return navigateRef
}

function WindowControls({ desktop }) {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (!desktop) return undefined
    let alive = true
    void desktop.isMaximized()
      .then(value => { if (alive) setMaximized(Boolean(value)) })
      .catch(() => {})
    const unsubscribe = desktop.onMaximizedChange(value => setMaximized(Boolean(value)))
    return () => {
      alive = false
      unsubscribe()
    }
  }, [desktop])

  if (!desktop) return null

  const toggleMaximize = () => {
    desktop.toggleMaximize()
      .then(value => setMaximized(Boolean(value)))
      .catch(() => {})
  }

  return (
    <div className="sandrone-topbar-window" aria-label="窗口控制">
      <button type="button" aria-label="最小化窗口" title="最小化" onClick={() => desktop.minimize()}>
        <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6.5h8" /></svg>
      </button>
      <button type="button" aria-label={maximized ? '还原窗口' : '最大化窗口'} title={maximized ? '还原' : '最大化'} onClick={toggleMaximize}>
        {maximized
          ? <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4 2.2h5.8V8M2.2 4H8v5.8H2.2z" /></svg>
          : <svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2.2" y="2.2" width="7.6" height="7.6" rx=".3" /></svg>}
      </button>
      <button type="button" className="sandrone-topbar-window-close" aria-label="关闭窗口" title="关闭" onClick={() => desktop.close()}>
        <svg viewBox="0 0 12 12" aria-hidden="true"><path d="m2.5 2.5 7 7m0-7-7 7" /></svg>
      </button>
    </div>
  )
}

const TOPBAR_MENUS = Object.freeze([
  { id: 'file', label: '文件' },
  { id: 'edit', label: '编辑' },
  { id: 'view', label: '视图' },
  { id: 'help', label: '帮助' },
])

function GpuAccelerationSection() {
  const [enabled, setEnabled] = useState(null)

  useEffect(() => {
    const api = window.sandroneDesktop
    if (!api || typeof api.getGpuAcceleration !== 'function') {
      setEnabled(true)
      return undefined
    }
    let alive = true
    void api.getGpuAcceleration()
      .then(value => { if (alive) setEnabled(Boolean(value)) })
      .catch(() => { if (alive) setEnabled(true) })
    return () => { alive = false }
  }, [])

  const toggle = () => {
    if (enabled === null) return
    const next = !enabled
    setEnabled(next)
    window.sandroneDesktop?.setGpuAcceleration?.(next)?.catch(() => {})
  }

  return (
    <>
      <div className="sandrone-setting-row">
        <div className="sandrone-setting-copy">
          <div className="sandrone-setting-label">启用 GPU 加速</div>
          <div className="sandrone-setting-hint">关闭后界面改用软件渲染，可避免残影等合成问题。调整后下一次启动时生效。</div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled === true}
          className={`sandrone-setting-switch${enabled ? ' is-on' : ''}`}
          disabled={enabled === null}
          onClick={toggle}
        >
          <span className="sandrone-setting-knob" aria-hidden="true" />
        </button>
      </div>
    </>
  )
}

function formatUpdateSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return ''
  return `${(bytes / 1024 / 1024).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1)} MB`
}

function updateStatusText(state) {
  switch (state.status) {
    case 'checking': return '正在连接 GitHub 检查最新版本…'
    case 'available': return `发现新版本 v${state.latestVersion}，准备下载。`
    case 'downloading': {
      const size = formatUpdateSize(state.totalBytes)
      const progress = Number.isFinite(state.percent) ? `${state.percent}%` : formatUpdateSize(state.receivedBytes)
      return `正在从 GitHub 下载 v${state.latestVersion}${progress ? ` · ${progress}` : ''}${size ? ` / ${size}` : ''}`
    }
    case 'downloaded': return `v${state.latestVersion} 已下载并校验完成，可以安装。`
    case 'installing': return '安装程序已启动，应用即将退出。'
    case 'manual': return '安装包已打开，请按系统提示完成更新。'
    case 'up-to-date': return `当前已是最新版本 v${state.currentVersion}。`
    case 'asset-unavailable': return `GitHub 已发布 v${state.latestVersion}，但没有适用于本机的安装包。`
    case 'unsupported': return '当前系统暂不支持应用内自动更新。'
    case 'error': return state.message || '检查更新失败，请稍后重试。'
    default: return `当前版本 v${state.currentVersion || '—'}。检查到新版本后会自动从 GitHub 下载。`
  }
}

function VersionUpdateRow() {
  const desktop = window.sandroneDesktop
  const [state, setState] = useState({ status: 'idle', currentVersion: null })

  useEffect(() => {
    if (!desktop?.getUpdateState) return undefined
    let alive = true
    void desktop.getUpdateState()
      .then(value => { if (alive && value) setState(value) })
      .catch(error => { if (alive) setState(current => ({ ...current, status: 'error', message: error?.message || '读取版本状态失败。' })) })
    const unsubscribe = desktop.onUpdateStatus?.(value => {
      if (alive && value) setState(value)
    })
    return () => {
      alive = false
      unsubscribe?.()
    }
  }, [desktop])

  if (!desktop?.checkForUpdates) return null

  const busy = state.status === 'checking' || state.status === 'downloading' || state.status === 'installing'
  const checkAndDownload = async () => {
    if (busy) return
    setState(current => ({ ...current, status: 'checking', message: null }))
    try {
      const result = await desktop.checkForUpdates({ force: true })
      setState(result)
      if (result.status === 'available') {
        setState(current => ({ ...current, status: 'downloading', percent: 0 }))
        setState(await desktop.downloadUpdate())
      }
    } catch (error) {
      setState(current => ({ ...current, status: 'error', message: error?.message || '检查更新失败，请稍后重试。' }))
    }
  }

  const install = async () => {
    if (state.status !== 'downloaded') return
    const handoff = desktop.platform === 'win32'
      ? '应用将退出并启动安装程序。'
      : '系统将打开安装包，你可以按系统提示完成安装。'
    const accepted = window.confirm(`安装 Sandrone AI Agent v${state.latestVersion}？\n\n${handoff}`)
    if (!accepted) return
    setState(current => ({ ...current, status: 'installing' }))
    try {
      setState(await desktop.installUpdate())
    } catch (error) {
      setState(current => ({ ...current, status: 'error', message: error?.message || '启动安装程序失败。' }))
    }
  }

  const actionLabel = state.status === 'downloaded'
    ? '打开安装包'
    : state.status === 'checking'
      ? '正在检查…'
      : state.status === 'downloading'
        ? `下载中${Number.isFinite(state.percent) ? ` ${state.percent}%` : '…'}`
        : state.status === 'installing'
          ? '正在启动…'
          : state.status === 'up-to-date'
            ? '重新检查'
            : '检查更新'

  return (
    <div className="sandrone-setting-row sandrone-update-row" data-sandrone-update-row>
      <div className="sandrone-setting-copy">
        <div className="sandrone-setting-label">版本更新</div>
        <div className={`sandrone-setting-hint${state.status === 'error' ? ' is-error' : ''}`} aria-live="polite">
          {updateStatusText(state)}
        </div>
        {state.status === 'downloading' && (
          <div
            className="sandrone-update-progress"
            role="progressbar"
            aria-label="更新下载进度"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow={Number.isFinite(state.percent) ? state.percent : undefined}
          >
            <span style={{ width: `${Number.isFinite(state.percent) ? state.percent : 8}%` }} />
          </div>
        )}
        {(state.status === 'asset-unavailable' || state.status === 'error') && state.releaseUrl && (
          <a className="sandrone-update-release-link" href={state.releaseUrl} target="_blank" rel="noreferrer">打开 GitHub 发布页</a>
        )}
      </div>
      <button
        type="button"
        className="sandrone-setting-action"
        disabled={busy || state.status === 'unsupported' || state.status === 'asset-unavailable'}
        onClick={state.status === 'downloaded' ? install : checkAndDownload}
      >
        {actionLabel}
      </button>
    </div>
  )
}

function OtherSettingsSection() {
  return (
    <section className="sandrone-settings-other" aria-label="其他">
      <GpuAccelerationSection />
      <VersionUpdateRow />
    </section>
  )
}

function insertFallbackFileText(files) {
  const textarea = document.querySelector('[data-sandrone-composer-input]')
  if (!(textarea instanceof HTMLTextAreaElement)) return
  const names = files.map(file => `[${file.name || 'image.png'}]`).join(' ')
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  if (!setter) return
  const prefix = textarea.value.trim() === '' ? '' : `${textarea.value.endsWith(' ') ? '' : ' '}`
  setter.call(textarea, `${textarea.value}${prefix}${names}`)
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
}

function dispatchFilesToOfficialInput(files) {
  const textarea = document.querySelector('[data-sandrone-composer-input]')
  if (!(textarea instanceof HTMLTextAreaElement)) return false
  try {
    const transfer = new DataTransfer()
    files.forEach(file => transfer.items.add(file))
    textarea.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData: transfer }))
    return true
  } catch {
    return false
  }
}

function SandroneImageAttach({ connection, sessionId, locked }) {
  const inputRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const choose = () => {
    if (!locked) inputRef.current?.click()
  }
  const onChange = async event => {
    const files = [...event.target.files || []].filter(file => file.type.startsWith('image/'))
    event.target.value = ''
    if (files.length === 0 || busy) return
    setBusy(true)
    try {
      // Always admit images. The selected upstream model decides whether it
      // can interpret them; a text-only model may reject them at request time.
      if (!dispatchFilesToOfficialInput(files)) insertFallbackFileText(files)
    } finally {
      setBusy(false)
    }
  }
  return (
    <span className="sandrone-image-attach">
      <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden onChange={onChange} />
      <button type="button" className="sandrone-image-attach-button" aria-label="添加图片" title="添加图片" disabled={locked || busy} onMouseDown={event => event.preventDefault()} onClick={choose}>
        <IconPaperclipOutline16 size={16} />
      </button>
    </span>
  )
}

function installProviderImageFields(connection) {
  return () => {
    const root = document.getElementById('root') || document.body
    const pending = new Map()
    let frame = 0
    let decorating = false
    const refresh = () => {
      if (frame || decorating) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        void decorate()
      })
    }
    const snapshot = async () => {
      const response = await connection?.api?.settings?.describe?.({}).catch(() => null)
      return response?.result?.ok ? response.result.value?.namespaces?.find(item => item.ns === 'llm-pi-ai') : null
    }
    const persist = async (route, modelId, enabled) => {
      const namespace = await snapshot()
      const models = namespace?.value?.providers?.[route]?.models
      const index = Array.isArray(models) ? models.findIndex(model => String(model?.id) === modelId) : -1
      if (!namespace || index < 0) {
        pending.set(`${route}:${modelId}`, enabled)
        return false
      }
      const result = await connection.api.settings.mutate({
        ns: 'llm-pi-ai',
        ops: [{ op: 'set', path: ['providers', route, 'models', index, 'input'], value: enabled ? ['text', 'image'] : ['text'] }],
        expectedRevision: namespace.revision,
      }).catch(() => null)
      if (result?.result?.ok) pending.delete(`${route}:${modelId}`)
      return result?.result?.ok === true
    }
    const decorate = async () => {
      const panel = document.querySelector('[role="dialog"][aria-modal="true"]')
      if (!panel || !connection?.api?.settings?.describe) return
      decorating = true
      const namespace = await snapshot()
      decorating = false
      if (!namespace) return
      const routeInput = [...panel.querySelectorAll('input')].find(input => input.getAttribute('aria-label') === 'Provider ID')
      const editor = routeInput?.closest('[class*="_editor"]')
      const route = routeInput?.value?.trim()
      if (!editor || !route) return
      const provider = namespace.value?.providers?.[route]
      const rows = [...editor.querySelectorAll('[class*="_modelEntry"]')]
      rows.forEach(row => {
        const modelInput = [...row.querySelectorAll('input')].find(input => /模型 ID|Model ID/.test(input.getAttribute('aria-label') || ''))
        const modelId = modelInput?.value?.trim()
        if (!modelId) return
        const model = Array.isArray(provider?.models) ? provider.models.find(item => String(item?.id) === modelId) : null
        const key = `${route}:${modelId}`
        if (row.querySelector('[data-sandrone-provider-image-field]')) {
          if (pending.has(key) && model) void persist(route, modelId, pending.get(key)).then(saved => { if (saved) refresh() })
          return
        }
        const label = document.createElement('label')
        label.dataset.sandroneProviderImageField = 'true'
        label.className = 'sandrone-provider-image-field'
        const checkbox = document.createElement('input')
        checkbox.type = 'checkbox'
        checkbox.checked = pending.get(key) ?? (Array.isArray(model?.input) && model.input.includes('image'))
        checkbox.addEventListener('change', async () => {
          const enabled = checkbox.checked
          pending.set(key, enabled)
          checkbox.disabled = true
          const saved = await persist(route, modelId, enabled)
          checkbox.disabled = false
          if (!saved && namespace.value?.providers?.[route]) checkbox.checked = !enabled
        })
        const text = document.createElement('span')
        text.textContent = '支持图片'
        label.append(checkbox, text)
        row.append(label)
        if (pending.has(key) && model) void persist(route, modelId, pending.get(key)).then(saved => { if (saved) refresh() })
      })
    }
    const observer = new MutationObserver(refresh)
    observer.observe(root, { childList: true, subtree: true })
    refresh()
    return () => {
      observer.disconnect()
      if (frame) window.cancelAnimationFrame(frame)
      document.querySelectorAll('[data-sandrone-provider-image-field]').forEach(element => element.remove())
    }
  }
}

export function imageCapabilityModels(namespace) {
  const value = namespace?.value
  const providers = value?.providers
  if (!providers || typeof providers !== 'object') return []
  const rows = []
  for (const [route, provider] of Object.entries(providers)) {
    if (!provider || typeof provider !== 'object') continue
    const models = Array.isArray(provider.models) ? provider.models : []
    models.forEach((model, index) => {
      if (!model || typeof model !== 'object' || !model.id) return
      const input = Array.isArray(model.input) && model.input.length > 0
        ? model.input
        : (Array.isArray(provider.defaultInput) && provider.defaultInput.length > 0 ? provider.defaultInput : ['text'])
      rows.push({ route, index, modelId: String(model.id), modelName: String(model.name || model.id), input, path: ['providers', route, 'models', index, 'input'] })
    })
    const overrides = provider.modelOverrides
    if (overrides && typeof overrides === 'object') {
      for (const [modelId, override] of Object.entries(overrides)) {
        if (!override || typeof override !== 'object') continue
        const input = Array.isArray(override.input) && override.input.length > 0
          ? override.input
          : (Array.isArray(provider.defaultInput) && provider.defaultInput.length > 0 ? provider.defaultInput : ['text'])
        rows.push({ route, modelId, modelName: String(override.name || modelId), input, path: ['providers', route, 'modelOverrides', modelId, 'input'] })
      }
    }
  }
  return rows
}

function ImageCapabilitySection({ connection }) {
  const [state, setState] = useState({ status: 'loading', rows: [], revision: null, error: '' })
  const load = async () => {
    if (!connection?.api?.settings?.describe) return
    setState(current => ({ ...current, status: 'loading', error: '' }))
    try {
      const response = await Promise.race([
        connection.api.settings.describe({}),
        new Promise((_, reject) => window.setTimeout(() => reject(new Error('读取模型能力超时，请重载页面后重试')), 4000)),
      ])
      if (!response?.result?.ok) throw new Error(response?.result?.error?.message || '读取模型设置失败')
      const namespace = response.result.value?.namespaces?.find(item => item.ns === 'llm-pi-ai')
      setState({ status: namespace ? 'ready' : 'unsupported', rows: imageCapabilityModels(namespace), revision: namespace?.revision ?? null, error: '' })
    } catch (error) {
      setState(current => ({ ...current, status: 'error', error: error?.message || '读取模型设置失败' }))
    }
  }

  useEffect(() => { void load() }, [connection])

  const toggle = async (row, enabled) => {
    if (!connection?.api?.settings?.mutate || state.revision == null) return
    const input = enabled ? ['text', 'image'] : ['text']
    setState(current => ({ ...current, status: 'saving', error: '' }))
    try {
      const response = await connection.api.settings.mutate({
        ns: 'llm-pi-ai',
        ops: [{ op: 'set', path: row.path, value: input }],
        expectedRevision: state.revision,
      })
      if (!response?.result?.ok) throw new Error(response?.result?.error?.message || '保存图片能力失败')
      await load()
    } catch (error) {
      setState(current => ({ ...current, status: 'error', error: error?.message || '保存图片能力失败' }))
      await load()
    }
  }

  return (
    <section className="sandrone-image-capability" aria-label="图片输入能力">
      <div className="sandrone-setting-row sandrone-image-capability-heading">
        <div className="sandrone-setting-copy">
          <div className="sandrone-setting-label">图片输入</div>
          <div className={`sandrone-setting-hint${state.status === 'error' ? ' is-error' : ''}`} aria-live="polite">
            {state.status === 'loading' || state.status === 'saving' ? '正在读取模型能力…' : state.status === 'unsupported' ? '当前没有可配置的 OpenAI-compatible 模型。' : state.error || '只对 llm-pi-ai 自定义 provider 生效；请确认上游模型真的支持图片。'}
          </div>
        </div>
        <button type="button" className="sandrone-setting-action" onClick={() => void load()} disabled={state.status === 'loading' || state.status === 'saving'}>刷新</button>
      </div>
      {state.status === 'ready' && state.rows.length === 0 && <div className="sandrone-image-empty">请先在“模型”中添加自定义 provider 和模型。</div>}
      {state.rows.map(row => {
        const enabled = row.input.includes('image')
        return (
          <div className="sandrone-setting-row sandrone-image-model-row" key={`${row.route}:${row.modelId}:${row.path.join('.')}`}>
            <div className="sandrone-setting-copy">
              <div className="sandrone-setting-label">{row.modelName}</div>
              <div className="sandrone-setting-hint">{row.route} · {enabled ? '文本 + 图片' : '仅文本'}</div>
            </div>
            <button type="button" role="switch" aria-checked={enabled} className={`sandrone-setting-switch${enabled ? ' is-on' : ''}`} disabled={state.status === 'saving'} onClick={() => void toggle(row, !enabled)}>
              <span className="sandrone-setting-knob" aria-hidden="true" />
            </button>
          </div>
        )
      })}
      <div className="sandrone-image-capability-note">DeepSeek 官方 provider（llm-deepseek）当前为文本专用，不能通过开关强行开启图片。</div>
    </section>
  )
}

/* Settings chrome: a back-to-workspace row and a section-search box injected
   above the official settings nav. Search hides non-matching nav entries and
   Enter activates the first remaining one. */
function SettingsChrome() {
  const [query, setQuery] = useState('')

  useEffect(() => {
    const needle = query.trim().toLowerCase()
    const panel = document.querySelector('[data-sandrone-settings-panel]')
    if (!panel) return
    const cells = [...panel.querySelectorAll('[data-sandrone-settings-nav-cell]')]
    for (const cell of cells) {
      const label = (cell.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase()
      if (needle && !label.includes(needle)) cell.setAttribute('data-sandrone-filtered', 'true')
      else cell.removeAttribute('data-sandrone-filtered')
    }
    return () => {
      for (const cell of cells) cell.removeAttribute('data-sandrone-filtered')
    }
  }, [query])

  const closeSettings = () => {
    clickOfficial('[data-sandrone-settings-close]')
  }

  const submitSearch = event => {
    if (event.key !== 'Enter') return
    const panel = document.querySelector('[data-sandrone-settings-panel]')
    const cell = panel?.querySelector('[data-sandrone-settings-nav-cell]:not([data-sandrone-filtered])')
    if (cell instanceof HTMLElement) cell.click()
  }

  return (
    <div className="sandrone-settings-chrome">
      <button type="button" className="sandrone-settings-back" onClick={closeSettings}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9.75 3.5 5.25 8l4.5 4.5M5.5 8h6" /></svg>
        返回工作区
      </button>
      <label className="sandrone-settings-search">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
        <input className="sandrone-settings-search-input" type="text" placeholder="搜索设置..." value={query} onChange={event => setQuery(event.target.value)} onKeyDown={submitSearch} />
      </label>
    </div>
  )
}

/* Directory-flow occupant backed by the OS-native folder dialog: when the
   owner opens the flow, Electron shows the system directory picker and the
   confirmed path is reported through onPicked (dismissal through onCancel). */
function NativeDirectoryFlow(props) {
  const openedRef = useRef(false)

  useEffect(() => {
    if (!props.open) {
      openedRef.current = false
      return
    }
    if (openedRef.current) return
    openedRef.current = true
    const desktop = window.sandroneDesktop
    if (!desktop || typeof desktop.pickDirectory !== 'function') {
      props.onCancel()
      return
    }
    let alive = true
    void desktop.pickDirectory()
      .then(path => {
        if (!alive) return
        if (path) props.onPicked(path)
        else props.onCancel()
      })
      .catch(() => {
        if (alive) props.onCancel()
      })
    return () => { alive = false }
  }, [props.open])

  return null
}

function installNativeDirectoryFlow(ctx) {
  const desktopAvailable = typeof window !== 'undefined'
    && Boolean(window.sandroneDesktop?.pickDirectory)
  if (!desktopAvailable) return
  // Priority -1 shadows the official native-picker client's priority-0 flow
  // registrations (single slots render the lowest priority), so the Electron
  // bridge drives every directory flow in the desktop shell.
  ctx.slots.inject('conversation.hero.workspace.directoryFlow', () => ctx.slots.inject('sidebar.workspaces.directoryFlow', function* () {
    yield ctx.slots.register({ name: 'conversation.hero.workspace.directoryFlow', priority: -1 }, NativeDirectoryFlow)
    yield ctx.slots.register({ name: 'sidebar.workspaces.directoryFlow', priority: -1 }, NativeDirectoryFlow)
  }))
}

function installSettingsChrome(ctx) {
  return ctx.effect(() => {
    let container = null
    let markedElements = []
    let root = null
    const clearMarkers = () => {
      for (const [element, attribute] of markedElements) element.removeAttribute(attribute)
      markedElements = []
    }
    const mark = (element, attribute) => {
      if (!(element instanceof Element) || element.hasAttribute(attribute)) return
      element.setAttribute(attribute, 'true')
      markedElements.push([element, attribute])
    }
    const markSettingsDescendants = (panel, nav) => {
      const navList = nav.lastElementChild
      mark(navList, 'data-sandrone-settings-nav-list')
      navList?.querySelectorAll(':scope > button').forEach(element => mark(element, 'data-sandrone-settings-nav-cell'))
      panel?.querySelectorAll('input:not([type="checkbox"]):not([type="radio"]), select, textarea').forEach(element => {
        if (!element.classList.contains('sandrone-settings-search-input')) mark(element, 'data-sandrone-settings-control')
      })
      panel?.querySelectorAll('[class*="candidate"] input[type="checkbox"]').forEach(element => {
        mark(element, 'data-sandrone-settings-candidate-checkbox')
      })
    }
    const mount = () => {
      const nav = document.querySelector('[role="presentation"] > [role="dialog"][aria-modal="true"] > nav')
      if (!nav) return
      const panel = nav.parentElement
      if (container && container.parentNode === nav) {
        markSettingsDescendants(panel, nav)
        return
      }
      if (root) {
        root.unmount()
        root = null
        container?.remove()
        container = null
        clearMarkers()
      }
      const overlay = panel?.parentElement
      const content = nav.nextElementSibling
      const header = content?.firstElementChild
      mark(panel, 'data-sandrone-settings-panel')
      mark(overlay, 'data-sandrone-settings-overlay')
      mark(panel?.previousElementSibling, 'data-sandrone-settings-mask')
      mark(nav.firstElementChild, 'data-sandrone-settings-nav-title')
      mark(content, 'data-sandrone-settings-content')
      mark(header?.firstElementChild, 'data-sandrone-settings-actions')
      mark(header?.querySelector('button'), 'data-sandrone-settings-close')
      mark(content?.lastElementChild, 'data-sandrone-settings-options')
      markSettingsDescendants(panel, nav)
      container = document.createElement('div')
      nav.insertBefore(container, nav.firstChild)
      root = createRoot(container)
      root.render(React.createElement(SettingsChrome))
    }
    const observer = new MutationObserver(mount)
    observer.observe(document.getElementById('root') || document.body, { childList: true, subtree: true })
    mount()
    return () => {
      observer.disconnect()
      root?.unmount()
      root = null
      container?.remove()
      container = null
      clearMarkers()
    }
  }, 'sandrone-ui: settings chrome')
}

function SandroneTopbar({ toggleTheme }) {
  const desktop = window.sandroneDesktop?.window
  const navigateRef = usePageNavigation()

  useEffect(() => {
    const api = window.sandroneDesktop
    if (!api || typeof api.onCommand !== 'function') return undefined
    return api.onCommand(command => {
      switch (command) {
        case 'toggle-sidebar':
          clickOfficial('[data-sandrone-sidebar] [aria-label="收起侧边栏"], [data-sandrone-sidebar] [aria-label="打开侧边栏"], [data-sandrone-sidebar] [aria-label="展开侧边栏"]')
          break
        case 'toggle-theme':
          toggleTheme()
          break
        case 'open-settings':
          clickOfficial('[data-sandrone-settings] button, [data-slot="settings.trigger"] button, [data-slot="settings.trigger"]')
          break
        case 'open-workspace':
          clickOfficial('[data-sandrone-workspaces] [aria-label="添加工作区"], [data-sandrone-workspaces] [aria-label="选择工作区"], [aria-label="添加工作区"]')
          break
        default:
          break
      }
    })
  }, [toggleTheme])

  const openMenu = (menuId, event) => {
    const rect = event.currentTarget.getBoundingClientRect()
    desktop?.showApplicationMenu(menuId, { x: Math.round(rect.left), y: Math.round(rect.bottom) })
  }

  return (
    <header className="sandrone-topbar" data-sandrone-topbar>
      <nav className="sandrone-topbar-navigation" aria-label="应用导航">
        <button type="button" className="sandrone-topbar-history" aria-label="上一个页面" title="上一页" onClick={() => navigateRef.current?.back()}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9.75 3.5 5.25 8l4.5 4.5M5.5 8h6" /></svg>
        </button>
        <button type="button" className="sandrone-topbar-history" aria-label="下一个页面" title="下一页" onClick={() => navigateRef.current?.forward()}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6.25 3.5 4.5 4.5-4.5 4.5M10.5 8h-6" /></svg>
        </button>
        <span className="sandrone-topbar-separator" aria-hidden="true" />
        {desktop ? TOPBAR_MENUS.map(item => (
          <button key={item.id} type="button" className="sandrone-topbar-menu-item" onClick={event => openMenu(item.id, event)}>
            {item.label}
          </button>
        )) : null}
      </nav>
      <div className="sandrone-topbar-drag" aria-hidden="true" />
      <WindowControls desktop={desktop} />
    </header>
  )
}

/* Sandrone's own model seat for the composer (replaces the official
   conversation.input.model entry). The official dropdown could be washed out
   by theme/CSS interference, so this picker is fully self-styled: a row
   trigger in the input bar, and a self-contained menu (model list grouped by
   provider, plus reasoning effort levels) that pops up above the row with a
   high z-index so nothing can cover it. Data and submission ride the shared
   per-session ModelDirectory (ui-model-selection's modelDirectories service). */
function SandroneModelPicker({ locked, available, directory, load, select }) {
  const [state, setState] = useState(() => directory.getSnapshot())
  const [open, setOpen] = useState(false)
  const [pane, setPane] = useState('root')
  const [busy, setBusy] = useState(false)
  const rootRef = useRef(null)

  useEffect(() => directory.subscribe(() => setState(directory.getSnapshot())), [directory])

  useEffect(() => {
    if (available) load()
  }, [available, load])

  useEffect(() => {
    if (!open) return
    const closeOutside = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false)
    }
    document.addEventListener('mousedown', closeOutside)
    return () => document.removeEventListener('mousedown', closeOutside)
  }, [open])

  if (!available) return null

  const choices = state.groups.flatMap(group =>
    group.models.map(model => ({
      group,
      model,
      selection: {
        provider: group.id,
        model: model.id,
        ...(model.reasoning?.defaultEffort === void 0 ? {} : { reasoningEffort: model.reasoning.defaultEffort }),
      },
    })),
  )
  const current = state.current
  const currentChoice = current === null ? undefined : choices.find(c =>
    c.selection.provider === current.provider && c.selection.model === current.model)
  const reasoning = currentChoice?.model.reasoning
  const effectiveEffort = current?.reasoningEffort ?? reasoning?.defaultEffort
  const effortLabel = reasoning === undefined
    ? undefined
    : effectiveEffort === undefined
      ? '提供方默认'
      : (reasoning.efforts.find(level => level.id === effectiveEffort)?.name ?? effectiveEffort)
  const modelLabel = currentChoice?.model.name ?? '选择模型'
  const triggerLabel = effortLabel === undefined ? modelLabel : `${modelLabel} · ${effortLabel}`

  const close = () => setOpen(false)

  const choose = (selection) => {
    if (current && current.provider === selection.provider && current.model === selection.model) {
      close()
      return
    }
    setBusy(true)
    select(selection).then(ok => {
      setBusy(false)
      if (ok) close()
    })
  }

  const chooseEffort = (effort) => {
    if (!current) return
    if (effectiveEffort === effort) {
      close()
      return
    }
    setBusy(true)
    select({
      provider: current.provider,
      model: current.model,
      ...(effort === undefined ? {} : { reasoningEffort: effort }),
    }).then(ok => {
      setBusy(false)
      if (ok) close()
    })
  }

  const effortChoices = reasoning === undefined ? [] : [
    ...(reasoning.defaultEffort === undefined ? [{ key: 'provider-default', effort: undefined, label: '提供方默认' }] : []),
    ...reasoning.efforts.map(level => ({ key: `effort:${level.id}`, effort: level.id, label: level.name })),
  ]

  return (
    <span
      ref={rootRef}
      className="sandrone-model-picker"
      data-sandrone-model-picker=""
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.preventDefault()
          if (pane !== 'root') setPane('root')
          else close()
        }
      }}
    >
      <button
        type="button"
        className="sandrone-model-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        title={triggerLabel}
        disabled={locked}
        onClick={() => {
          if (open) close()
          else {
            setPane('root')
            setOpen(true)
            load()
          }
        }}
      >
        <span className="sandrone-model-trigger-label">{triggerLabel}</span>
        <svg className={`sandrone-model-chevron${open ? ' open' : ''}`} viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5L6 7.5L9 4.5" /></svg>
      </button>
      {open ? (
        <div className="sandrone-model-menu" role="menu">
          {pane === 'root' ? (
            <>
              <button
                type="button"
                role="menuitem"
                className="sandrone-model-cell"
                onClick={() => {
                  setPane('models')
                  load()
                }}
              >
                <span className="sandrone-model-cell-label">模型</span>
                <span className="sandrone-model-cell-value">{modelLabel}</span>
                <svg className="sandrone-model-cell-chevron" viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 3L7.5 6L4.5 9" /></svg>
              </button>
              <button
                type="button"
                role="menuitem"
                className="sandrone-model-cell"
                disabled={reasoning === undefined}
                onClick={() => setPane('efforts')}
              >
                <span className="sandrone-model-cell-label">推理等级</span>
                <span className="sandrone-model-cell-value">{effortLabel ?? '—'}</span>
                <svg className="sandrone-model-cell-chevron" viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 3L7.5 6L4.5 9" /></svg>
              </button>
            </>
          ) : null}
          {pane === 'models' ? (
            <div className="sandrone-model-groups">
              {state.groups.map(group => (
                <section key={group.id} role="group" className="sandrone-model-group">
                  <div className="sandrone-model-group-title">{group.name}</div>
                  {group.models.map(model => {
                    const selected = !!current && current.provider === group.id && current.model === model.id
                    return (
                      <button
                        key={model.id}
                        type="button"
                        role="menuitemradio"
                        aria-checked={selected}
                        className={`sandrone-model-option${selected ? ' selected' : ''}`}
                        title={model.name}
                        disabled={busy}
                        onClick={() => choose({ provider: group.id, model: model.id })}
                      >
                        <span className="sandrone-model-option-copy">
                          <span className="sandrone-model-option-name">{model.name}</span>
                          {model.description ? <span className="sandrone-model-option-desc">{model.description}</span> : null}
                        </span>
                        <span className="sandrone-model-check">{selected ? '✓' : ''}</span>
                      </button>
                    )
                  })}
                </section>
              ))}
              {state.status === 'loading' ? <div className="sandrone-model-status">加载中…</div> : null}
              {state.groups.length === 0 && state.status !== 'loading' ? (
                <div className={`sandrone-model-status${state.error ? ' error' : ''}`}>
                  {state.error ? `加载失败：${state.error}` : '暂无可用模型'}
                </div>
              ) : null}
              {state.failures.map(failure => (
                <div key={failure.id} className="sandrone-model-status error">{failure.name}：{failure.message}</div>
              ))}
            </div>
          ) : null}
          {pane === 'efforts' ? (
            <div className="sandrone-model-groups">
              {effortChoices.map(choice => {
                const selected = effectiveEffort === choice.effort
                return (
                  <button
                    key={choice.key}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    className={`sandrone-model-option${selected ? ' selected' : ''}`}
                    disabled={busy}
                    onClick={() => chooseEffort(choice.effort)}
                  >
                    <span className="sandrone-model-option-copy">
                      <span className="sandrone-model-option-name">{choice.label}</span>
                    </span>
                    <span className="sandrone-model-check">{selected ? '✓' : ''}</span>
                  </button>
                )
              })}
            </div>
          ) : null}
        </div>
      ) : null}
    </span>
  )
}

function BuddyOverlay() {
  const [open, setOpen] = useState(false)
  const [awake, setAwake] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => setAwake(true), 900)
    return () => window.clearTimeout(timer)
  }, [])

  if (!open) {
    return (
      <button
        className="sandrone-buddy-trigger"
        type="button"
        aria-label="Open Sandrone Buddy"
        title="Buddy"
        onClick={() => setOpen(true)}
      >
        <span aria-hidden="true" className="sandrone-buddy-face compact"><i /><i /></span>
      </button>
    )
  }

  return (
    <span className="sandrone-buddy-anchor">
      <aside className="sandrone-buddy" aria-label="Sandrone Buddy">
        <div className="sandrone-buddy-heading">
          <span className="sandrone-buddy-kicker"><IconSparkle16 size={14} /> Buddy</span>
          <button type="button" title="Hide Buddy" aria-label="Hide Buddy" onClick={() => setOpen(false)}>
            <IconCloseOutline16 size={15} />
          </button>
        </div>
        <button
          className={`sandrone-buddy-body${awake ? ' is-awake' : ''}`}
          type="button"
          title="Say hello"
          onClick={() => setAwake(value => !value)}
        >
          <span aria-hidden="true" className="sandrone-buddy-face"><i /><i /><b /></span>
          <span><strong>{awake ? 'Still with you' : 'Quietly watching'}</strong><small>Tap to check in</small></span>
        </button>
        <p>Official Harness handles the work. Buddy only keeps you company.</p>
      </aside>
    </span>
  )
}

export function apply(ctx) {
  ctx.effect(
    () => ctx.theme.overrideTokens('@sandrone/harness-ui', TOKEN_LAYER),
    'sandrone-ui: semantic theme layer',
  )
  installSurfaceMarkers(ctx)
  installStyle(ctx)
  const toggleTheme = () => {
    const active = ctx.theme.getTheme().active.colorScheme
    ctx.theme.setTheme(active === 'dark' ? 'light' : 'dark')
  }
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'sandrone-topbar',
    order: -100,
    inject: () => ({ toggleTheme }),
  }, SandroneTopbar))
  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right',
    id: 'sandrone-buddy',
    order: 90,
  }, BuddyOverlay))
  ctx.inject(['connection'], (connection) => {
    ctx.effect(installProviderImageFields(connection), 'sandrone-ui: provider image capability fields')
    ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
      name: 'conversation.input.left',
      id: 'sandrone-image-attach',
      order: -100,
      inject: (sessionId) => ({ connection, sessionId }),
    }, SandroneImageAttach))
  })
  // Own model seat: registering through the modelDirectories service scope
  // guarantees our entry lands after ui-model-selection's. The shipped entry
  // sits at priority 0; shadowing needs a DIFFERENT priority and the lowest
  // one renders — so register explicitly at -100.
  ctx.inject(['modelDirectories', 'sessions'], (scope) => {
    scope.slots.inject('conversation.input.model', () => scope.slots.register({
      name: 'conversation.input.model',
      id: 'sandrone-model-picker',
      priority: -100,
      inject: (sessionId) => {
        const directory = scope.modelDirectories.directoryFor(sessionId)
        const available = scope.sessions.subagentAddress(sessionId) === void 0
        return {
          available,
          directory: directory.store,
          load: () => {
            if (available) directory.load().catch(() => {})
          },
          select: (selection) => available ? directory.select(selection).then(() => true, () => false) : Promise.resolve(false),
        }
      },
    }, SandroneModelPicker))
  })
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'sandrone-other',
    order: 100,
    label: () => '其他',
  }, OtherSettingsSection))
  installSettingsChrome(ctx)
  installNativeDirectoryFlow(ctx)
}
