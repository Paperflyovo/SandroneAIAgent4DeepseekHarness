import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  IconCloseOutline16,
  IconSparkle16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { installStyle } from './client.css'

export const inject = ['slots', 'theme']

const TOKEN_LAYER = Object.freeze({
  '--dsw-alias-brand-primary': { light: '#b99f86', dark: '#c8a882' },
  '--dsw-alias-brand-text': { light: '#514c46', dark: '#d4cfc8' },
  '--dsw-alias-button-primary-fill': { light: '#514c46', dark: '#d4cfc8' },
  '--dsw-alias-button-primary-hover': { light: '#2e2a26', dark: '#e8e3dc' },
  '--dsw-alias-bg-base': { light: '#f5f2ec', dark: '#1c1a18' },
  '--dsw-alias-bg-layer-1': { light: '#fbfaf7', dark: '#252220' },
  '--dsw-alias-bg-layer-2': { light: '#fffdf9', dark: '#2c2926' },
  '--dsw-alias-bg-layer-3': { light: '#fffdf9', dark: '#302d29' },
  '--dsw-alias-border-l1': { light: '#ddd6cc', dark: '#3d3832' },
  '--dsw-alias-border-l2': { light: '#c6bcb0', dark: '#544e46' },
  '--dsw-alias-border-l2-darkmode-thin': { light: '#ddd6cc', dark: '#3d3832' },
  '--dsw-alias-label-primary': { light: '#2e2a26', dark: '#d4cfc8' },
  '--dsw-alias-label-primary-dimmed': { light: '#514c46', dark: '#b5aea4' },
  '--dsw-alias-label-secondary': { light: '#514c46', dark: '#b5aea4' },
  '--dsw-alias-label-tertiary': { light: '#706a63', dark: '#9a948c' },
  '--dsw-alias-label-caption': { light: '#8b8379', dark: '#817a72' },
  '--dsw-alias-interactive-bg-hover': { light: '#e9e3da', dark: '#3a3632' },
  '--dsw-alias-interactive-bg-hover-solid': { light: '#ece7df', dark: '#35322e' },
  '--dsw-alias-button-elevated-fill': { light: '#fffdf9', dark: '#2c2926' },
  '--dsw-alias-button-floating-fill': { light: '#fffdf9', dark: '#2c2926' },
  '--dsw-alias-button-floating-hover': { light: '#e9e3da', dark: '#3a3632' },
  '--dsw-alias-button-info-fill': { light: '#514c46', dark: '#d4cfc8' },
  '--dsw-alias-button-info-hover': { light: '#2e2a26', dark: '#e8e3dc' },
  '--dsw-specific-bubble': { light: '#ece5dc', dark: '#3d3228' },
  '--dsw-specific-input-major': { light: '#fffdf9', dark: '#2c2926' },
  '--dsw-specific-selector': { light: '#ece7df', dark: '#35322e' },
  '--dsw-specific-sidebar-fill': { light: '#efeae2', dark: '#252220' },
  '--dsw-specific-sidebar-nav-item-active': { light: '#e9e3da', dark: '#3d3228' },
  '--dsw-specific-sidebar-nav-item-hover': { light: '#e9e3da', dark: '#302d29' },
})

const BUDDY_KEY = 'sandrone.harness.buddy.v1'
const DESKTOP_SIDEBAR_WIDTH = 380

function readBuddyPreference() {
  try {
    return window.localStorage.getItem(BUDDY_KEY) !== 'hidden'
  } catch {
    return true
  }
}

function writeBuddyPreference(visible) {
  try {
    window.localStorage.setItem(BUDDY_KEY, visible ? 'visible' : 'hidden')
  } catch {
    // A blocked storage area only makes the preference session-local.
  }
}

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
    const observer = new MutationObserver(() => markSurface())
    observer.observe(document.getElementById('root') || document.body, { childList: true, subtree: true })
    const resizeObserver = new ResizeObserver(() => markSurface())
    const resizeTarget = document.querySelector('[data-sandrone-sidebar-column]')
    if (resizeTarget) resizeObserver.observe(resizeTarget)
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
    return () => {
      observer.disconnect()
      resizeObserver.disconnect()
      document.removeEventListener('pointerdown', handleSidebarResizeStart, true)
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
          clickOfficial('[role="dialog"][aria-modal="true"] [class*="close"]')
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
    <section className="sandrone-settings-other" aria-label="其他">
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
    const panel = document.querySelector('[role="dialog"][aria-modal="true"]')
    if (!panel) return
    const cells = [...panel.querySelectorAll('[class*="navCell"]')]
    for (const cell of cells) {
      const label = (cell.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase()
      cell.style.display = needle && !label.includes(needle) ? 'none' : ''
    }
  }, [query])

  const closeSettings = () => {
    clickOfficial('[role="dialog"][aria-modal="true"] [class*="close"]')
  }

  const submitSearch = event => {
    if (event.key !== 'Enter') return
    const panel = document.querySelector('[role="dialog"][aria-modal="true"]')
    const cell = panel && [...panel.querySelectorAll('[class*="navCell"]')].find(node => node.style.display !== 'none')
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
        <input type="text" placeholder="搜索设置..." value={query} onChange={event => setQuery(event.target.value)} onKeyDown={submitSearch} />
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
    let root = null
    const mount = () => {
      const nav = document.querySelector('[role="dialog"][aria-modal="true"] > nav')
      if (!nav || (container && container.parentNode === nav)) return
      if (root) {
        root.unmount()
        root = null
        container?.remove()
        container = null
      }
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

function BuddyOverlay() {
  const [open, setOpen] = useState(readBuddyPreference)
  const [awake, setAwake] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => setAwake(true), 900)
    return () => window.clearTimeout(timer)
  }, [])

  const setVisible = (visible) => {
    setOpen(visible)
    writeBuddyPreference(visible)
  }

  if (!open) {
    return (
      <button
        className="sandrone-buddy-launcher"
        type="button"
        aria-label="Open Sandrone Buddy"
        title="Open Buddy"
        onClick={() => setVisible(true)}
      >
        <span aria-hidden="true" className="sandrone-buddy-face compact"><i /><i /></span>
      </button>
    )
  }

  return (
    <aside className="sandrone-buddy" aria-label="Sandrone Buddy">
      <div className="sandrone-buddy-heading">
        <span className="sandrone-buddy-kicker"><IconSparkle16 size={14} /> Buddy</span>
        <button type="button" title="Hide Buddy" aria-label="Hide Buddy" onClick={() => setVisible(false)}>
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
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'sandrone-buddy',
    order: 100,
  }, BuddyOverlay))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'sandrone-other',
    order: 100,
    label: () => '其他',
  }, GpuAccelerationSection))
  installSettingsChrome(ctx)
  installNativeDirectoryFlow(ctx)
}
