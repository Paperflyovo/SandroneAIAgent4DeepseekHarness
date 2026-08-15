import React, { useEffect, useState } from 'react'
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
    const canNormalizeDesktopWidth = window.innerWidth > 760
      && !sidebarCollapsed
      && !frame.dataset.sandroneSidebarUserResized
      && !frame.dataset.sandroneSidebarWidthNormalized
      && sidebarWidth > 0
      && sidebarWidth < DESKTOP_SIDEBAR_WIDTH
    if (canNormalizeDesktopWidth) {
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

function SandroneTopbar({ toggleTheme }) {
  const [title, setTitle] = useState('新会话')

  useEffect(() => {
    const readTitle = () => {
      const header = document.querySelector('[data-sandrone-session-header]')
      const next = header?.textContent?.replace(/\s+/g, ' ').trim()
      if (next) setTitle(next.slice(0, 80))
    }
    readTitle()
    const observer = new MutationObserver(readTitle)
    observer.observe(document.getElementById('root') || document.body, { childList: true, subtree: true, characterData: true })
    return () => observer.disconnect()
  }, [])

  return (
    <header className="sandrone-topbar" data-sandrone-topbar>
      <div className="sandrone-topbar-leading">
        <button type="button" className="sandrone-topbar-nav" aria-label="上一个页面" onClick={() => window.history.back()}>←</button>
        <button type="button" className="sandrone-topbar-nav" aria-label="下一个页面" onClick={() => window.history.forward()}>→</button>
        <button type="button" className="sandrone-topbar-menu" aria-label="展开或收起侧边栏" onClick={() => clickOfficial('[data-sandrone-sidebar] [aria-label="收起侧边栏"], [data-sandrone-sidebar] [aria-label="打开侧边栏"], [data-sandrone-sidebar] [aria-label="展开侧边栏"]')}>☰</button>
        <div className="sandrone-topbar-title" title={title}>{title}</div>
        <span className="sandrone-topbar-sync"><i /> 已同步</span>
      </div>
      <nav className="sandrone-topbar-actions" aria-label="工作台操作">
        <button type="button" aria-label="搜索项目和会话" title="搜索项目和会话" onClick={() => clickOfficial('[data-sandrone-workspaces] [aria-label="搜索会话"], [aria-label="搜索会话"]')}>⌕</button>
        <button type="button" aria-label="刷新工作台" title="刷新工作台" onClick={() => window.location.reload()}>↻</button>
        <button type="button" aria-label="打开工作区" title="打开工作区" onClick={() => clickOfficial('[data-sandrone-workspaces] [aria-label="添加工作区"], [data-sandrone-workspaces] [aria-label="选择工作区"], [aria-label="添加工作区"]')}>▣</button>
        <button type="button" aria-label="打开设置" title="打开设置" onClick={() => clickOfficial('[data-sandrone-settings] button, [data-slot="settings.trigger"] button, [data-slot="settings.trigger"]')}>⚙</button>
        <button type="button" aria-label="切换夜间模式" title="切换夜间模式" onClick={toggleTheme}>☾</button>
      </nav>
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
}
