import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { SessionEventStream, MutableSessionEventSource } from '@deepseek-ai/dsh-api-session-controller/client'
import { openBuddyJournal, remoteValue } from './buddy-session.js'
import {
  IconCloseOutline16,
  IconSparkle16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  chooseBuddyModel,
  collectBuddyActivity,
} from './buddy.js'
import { installStyle } from './client.css'
import { renderSessionScreenshot, screenshotTimeout } from './sessionScreenshot.js'

export const inject = ['slots', 'theme', 'layout']

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

const BROWSER_SPACE_STORAGE_KEY = 'sandrone.space.v1'
const SPACE_TREE_ORDER_KEY = 'sandrone.space.tree-order.v1'

function browserSpaceSnapshot() {
  try {
    const value = JSON.parse(window.localStorage.getItem(BROWSER_SPACE_STORAGE_KEY) || '{}')
    return {
      spaces: Array.isArray(value.spaces) ? value.spaces : [],
      documents: value.documents && typeof value.documents === 'object' ? value.documents : {},
      resources: value.resources && typeof value.resources === 'object' ? value.resources : {},
      folders: value.folders && typeof value.folders === 'object' ? value.folders : {},
      trash: value.trash && typeof value.trash === 'object' ? value.trash : {},
    }
  } catch {
    return { spaces: [], documents: {}, resources: {}, folders: {}, trash: {} }
  }
}

function writeBrowserSpaceSnapshot(snapshot) {
  window.localStorage.setItem(BROWSER_SPACE_STORAGE_KEY, JSON.stringify(snapshot))
}

function browserSpaceId(name, spaces) {
  const base = String(name || '').trim().toLocaleLowerCase().replace(/[^a-z0-9\u4e00-\u9fff_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'space'
  let id = base
  for (let index = 2; spaces.some(space => space.id === id); index += 1) id = `${base}-${index}`
  return id
}

const BROWSER_SPACE_API = Object.freeze({
  getRoot: async () => 'browser-local-storage',
  list: async () => browserSpaceSnapshot().spaces,
  create: async name => {
    const snapshot = browserSpaceSnapshot()
    const displayName = String(name || '').trim()
    if (!displayName) throw new Error('空间名称不能为空')
    const now = new Date().toISOString()
    const metadata = { version: 1, id: browserSpaceId(displayName, snapshot.spaces), name: displayName, createdAt: now, updatedAt: now }
    snapshot.spaces = [...snapshot.spaces, metadata]
    snapshot.documents[metadata.id] = {}
    snapshot.resources[metadata.id] = {}
    snapshot.folders[metadata.id] = []
    writeBrowserSpaceSnapshot(snapshot)
    return metadata
  },
  rename: async (id, name) => {
    const snapshot = browserSpaceSnapshot()
    const displayName = String(name || '').trim()
    if (!displayName) throw new Error('空间名称不能为空')
    const metadata = snapshot.spaces.find(space => space.id === id)
    if (!metadata) throw new Error('空间不存在')
    metadata.name = displayName
    metadata.updatedAt = new Date().toISOString()
    writeBrowserSpaceSnapshot(snapshot)
    return metadata
  },
  remove: async id => {
    const snapshot = browserSpaceSnapshot()
    snapshot.spaces = snapshot.spaces.filter(space => space.id !== id)
    delete snapshot.documents[id]
    delete snapshot.resources[id]
    delete snapshot.folders[id]
    Object.keys(snapshot.trash).forEach(key => { if (snapshot.trash[key]?.spaceId === id) delete snapshot.trash[key] })
    writeBrowserSpaceSnapshot(snapshot)
    return { ok: true }
  },
  get: async id => browserSpaceSnapshot().spaces.find(space => space.id === id) || null,
  documents: async id => Object.keys(browserSpaceSnapshot().documents[id] || {}).sort((left, right) => left.localeCompare(right)),
  folders: async id => [...(browserSpaceSnapshot().folders[id] || [])].sort((left, right) => left.localeCompare(right)),
  createDirectory: async (id, relativePath) => {
    const snapshot = browserSpaceSnapshot()
    const normalized = String(relativePath || '').replaceAll('\\', '/').replace(/^\/+|\/+$/g, '')
    if (!normalized) throw new Error('文件夹名称不能为空')
    if (!snapshot.folders[id]) snapshot.folders[id] = []
    if (!snapshot.folders[id].includes(normalized)) snapshot.folders[id].push(normalized)
    writeBrowserSpaceSnapshot(snapshot)
    return { path: normalized }
  },
  resources: async id => Object.keys(browserSpaceSnapshot().resources[id] || {}).sort((left, right) => left.localeCompare(right)).map(path => ({ path, size: Math.floor((browserSpaceSnapshot().resources[id][path].length * 3) / 4), updatedAt: null })),
  search: async query => {
    const needle = String(query || '').trim().toLocaleLowerCase()
    if (!needle) return []
    const snapshot = browserSpaceSnapshot()
    const spaces = snapshot.spaces
    const results = []
    for (const space of spaces) {
      for (const path of Object.keys(snapshot.documents[space.id] || {}).sort()) {
        if (results.length >= 500) return results
        const content = String(snapshot.documents[space.id][path] || '')
        const pathIndex = path.toLocaleLowerCase().indexOf(needle)
        const contentIndex = content.toLocaleLowerCase().indexOf(needle)
        if (pathIndex < 0 && contentIndex < 0) continue
        const source = contentIndex >= 0 ? content : path
        const matchIndex = contentIndex >= 0 ? contentIndex : pathIndex
        const start = Math.max(0, matchIndex - 72)
        const end = Math.min(source.length, matchIndex + needle.length + 120)
        const snippet = source.slice(start, end).replace(/\s+/g, ' ').trim()
        results.push({ spaceId: space.id, spaceName: space.name, path, snippet: `${start > 0 ? '…' : ''}${snippet}${end < source.length ? '…' : ''}` })
      }
    }
    return results
  },
  readMarkdown: async (id, relativePath) => ({ path: relativePath, content: browserSpaceSnapshot().documents[id]?.[relativePath] || '' }),
  writeMarkdown: async (id, relativePath, content) => {
    const snapshot = browserSpaceSnapshot()
    if (!snapshot.documents[id]) snapshot.documents[id] = {}
    snapshot.documents[id][relativePath] = content
    snapshot.spaces = snapshot.spaces.map(space => space.id === id ? { ...space, updatedAt: new Date().toISOString() } : space)
    writeBrowserSpaceSnapshot(snapshot)
    return { path: relativePath, content }
  },
  createMarkdown: async (id, relativePath) => {
    const snapshot = browserSpaceSnapshot()
    if (!snapshot.documents[id]) snapshot.documents[id] = {}
    if (Object.prototype.hasOwnProperty.call(snapshot.documents[id], relativePath)) throw new Error('Markdown 文件已存在')
    snapshot.documents[id][relativePath] = '# 新文档\n\n'
    snapshot.spaces = snapshot.spaces.map(space => space.id === id ? { ...space, updatedAt: new Date().toISOString() } : space)
    writeBrowserSpaceSnapshot(snapshot)
    return { path: relativePath, content: snapshot.documents[id][relativePath] }
  },
  renameMarkdown: async (id, relativePath, nextRelativePath) => {
    const snapshot = browserSpaceSnapshot()
    if (!snapshot.documents[id] || !Object.prototype.hasOwnProperty.call(snapshot.documents[id], relativePath)) throw new Error('Markdown 文件不存在')
    if (relativePath !== nextRelativePath && Object.prototype.hasOwnProperty.call(snapshot.documents[id], nextRelativePath)) throw new Error('Markdown 文件已存在')
    snapshot.documents[id][nextRelativePath] = snapshot.documents[id][relativePath]
    if (relativePath !== nextRelativePath) delete snapshot.documents[id][relativePath]
    snapshot.spaces = snapshot.spaces.map(space => space.id === id ? { ...space, updatedAt: new Date().toISOString() } : space)
    writeBrowserSpaceSnapshot(snapshot)
    return { path: nextRelativePath, content: snapshot.documents[id][nextRelativePath] }
  },
  removeMarkdown: async (id, relativePath) => {
    const snapshot = browserSpaceSnapshot()
    if (snapshot.documents[id] && Object.prototype.hasOwnProperty.call(snapshot.documents[id], relativePath)) {
      const trashId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      snapshot.trash[trashId] = { spaceId: id, path: relativePath, content: snapshot.documents[id][relativePath] }
      delete snapshot.documents[id][relativePath]
      writeBrowserSpaceSnapshot(snapshot)
      return { ok: true, trashId }
    }
    writeBrowserSpaceSnapshot(snapshot)
    return { ok: true }
  },
  restoreMarkdown: async (id, relativePath, trashId) => {
    const snapshot = browserSpaceSnapshot()
    const entry = snapshot.trash[trashId]
    if (!entry || entry.spaceId !== id || entry.path !== relativePath) throw new Error('回收站记录与文档不匹配')
    if (!snapshot.documents[id]) snapshot.documents[id] = {}
    if (Object.prototype.hasOwnProperty.call(snapshot.documents[id], relativePath)) throw new Error('同名 Markdown 已存在')
    snapshot.documents[id][relativePath] = entry.content
    delete snapshot.trash[trashId]
    writeBrowserSpaceSnapshot(snapshot)
    return { path: relativePath, content: entry.content }
  },
  readResource: async (id, relativePath) => {
    const value = browserSpaceSnapshot().resources[id]?.[relativePath]
    if (!value) return { ok: false, error: '资源不存在' }
    return { ok: true, path: relativePath, bytes: Uint8Array.from(atob(value), character => character.charCodeAt(0)) }
  },
  renameResource: async (id, relativePath, nextRelativePath) => {
    const snapshot = browserSpaceSnapshot()
    if (!snapshot.resources[id]?.[relativePath]) throw new Error('资源不存在')
    if (relativePath !== nextRelativePath && snapshot.resources[id][nextRelativePath]) throw new Error('资源已存在')
    snapshot.resources[id][nextRelativePath] = snapshot.resources[id][relativePath]
    if (relativePath !== nextRelativePath) delete snapshot.resources[id][relativePath]
    const oldReference = `res/${relativePath}`
    const newReference = `res/${nextRelativePath}`
    Object.keys(snapshot.documents[id] || {}).forEach(path => {
      snapshot.documents[id][path] = String(snapshot.documents[id][path] || '').split(oldReference).join(newReference)
    })
    writeBrowserSpaceSnapshot(snapshot)
    return { path: nextRelativePath }
  },
  deleteResource: async (id, relativePath) => {
    const snapshot = browserSpaceSnapshot()
    if (snapshot.resources[id]) delete snapshot.resources[id][relativePath]
    writeBrowserSpaceSnapshot(snapshot)
    return { ok: true }
  },
  importResourceFile: async (id, file) => {
    if (!file || typeof file.arrayBuffer !== 'function') return null
    if (file.size > 4 * 1024 * 1024) throw new Error('浏览器 dev 模式单个资源不能超过 4 MB')
    const name = String(file.name || `resource-${Date.now()}`).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim() || `resource-${Date.now()}`
    const bytes = new Uint8Array(await file.arrayBuffer())
    const snapshot = browserSpaceSnapshot()
    if (!snapshot.resources[id]) snapshot.resources[id] = {}
    snapshot.resources[id][name] = bytesToBase64(bytes)
    writeBrowserSpaceSnapshot(snapshot)
    return { path: name, size: bytes.byteLength }
  },
  importResource: async () => null,
})

function getSpaceApi() {
  return window.sandroneDesktop?.space || BROWSER_SPACE_API
}

function markSurface() {
  const root = document.getElementById('root')
  const frame = root?.querySelector('[data-rightbar-col]')?.parentElement
  if (!root || !frame) return
  root.dataset.sandroneShell = 'true'
  frame.dataset.sandroneFrame = 'true'
  const frameRect = frame.getBoundingClientRect()
  const framePaddingTop = Number.parseFloat(getComputedStyle(frame).paddingTop) || 0
  const contentTop = frameRect.top + framePaddingTop
  root.style.setProperty('--sandrone-frame-top', `${Math.round(contentTop)}px`)
  const columns = [...frame.children].filter(element => element instanceof HTMLElement)
  const sidebarColumn = columns.find(element => element.querySelector('[data-slot="sidebar"]'))
    || columns.find(element => element.querySelector('[aria-label="新建会话"], [aria-label="搜索会话"], [role="tree"]'))
  const centerColumn = columns.find(element => element.querySelector('[data-slot="main.conversation"]'))
    || columns.find(element => element.querySelector('[data-conversation-scroll], [data-composer-seat], [data-composer-card]'))
  const overlayColumn = columns.find(element => (
    element.matches('[data-shell-overlay]') || element.querySelector('[data-shell-overlay]')
  ))
  const detailsColumn = frame.querySelector('[data-rightbar-col]')
  sidebarColumn?.setAttribute('data-sandrone-sidebar-column', 'true')
  centerColumn?.setAttribute('data-sandrone-center', 'true')
  detailsColumn?.setAttribute('data-sandrone-details', 'true')
  overlayColumn?.setAttribute('data-sandrone-overlay', 'true')
  if (sidebarColumn) {
    const sidebarWidth = sidebarColumn.getBoundingClientRect().width
    const sidebarCollapsed = frame.getAttribute('data-sidebar-collapsed') === 'true'
    root.dataset.sandroneSidebarCollapsed = sidebarCollapsed ? 'true' : 'false'
    root.style.setProperty('--sandrone-sidebar-width', sidebarCollapsed ? '0px' : `${sidebarWidth}px`)
    const desktopShell = Boolean(window.sandroneDesktop)
    if (desktopShell) root.dataset.sandroneDesktop = 'true'

  }
  const sidebarRoot = sidebarColumn?.querySelector('[data-slot="sidebar"]') || sidebarColumn?.firstElementChild
  sidebarRoot?.setAttribute('data-sandrone-sidebar', 'true')
  sidebarRoot?.firstElementChild?.setAttribute('data-sandrone-sidebar', 'true')
  const sidebarHeader = sidebarRoot?.querySelector('[class*="logoRow"]') || sidebarRoot?.firstElementChild
  sidebarHeader?.setAttribute('data-sandrone-sidebar-header', 'true')
  if (sidebarHeader instanceof HTMLElement && window.innerWidth > 760 && frame.getAttribute('data-sidebar-collapsed') !== 'true') {
    const visualSidebarWidth = sidebarHeader.getBoundingClientRect().width
    const firstGridTrack = Number.parseFloat(getComputedStyle(frame).gridTemplateColumns)
    const measuredWidth = Math.max(
      visualSidebarWidth,
      Number.isFinite(firstGridTrack) ? firstGridTrack : 0,
    )
    if (measuredWidth > 0) root.style.setProperty('--sandrone-sidebar-width', `${measuredWidth}px`)
  }
  const workspaceSurface = sidebarRoot?.querySelector('[data-slot="sidebar.workspaces"]')
  workspaceSurface?.setAttribute('data-sandrone-workspaces', 'true')
  const regionHost = workspaceSurface?.querySelector('[class*="sectionHeader"]')
  regionHost?.setAttribute('data-sandrone-region-host', 'true')
  if (regionHost instanceof HTMLElement) {
    const hostBottom = regionHost.getBoundingClientRect().bottom
    root.style.setProperty('--sandrone-space-sidebar-offset', `${Math.max(0, Math.round(hostBottom - contentTop))}px`)
  }
  sidebarRoot?.querySelector('[data-slot="sidebar.settings"]')?.setAttribute('data-sandrone-settings', 'true')
  sidebarRoot?.querySelector('[data-slot="sidebar.workspaces"] input')?.setAttribute('placeholder', '搜索项目、会话...')
  const centerRoot = centerColumn?.querySelector('[data-slot="main.conversation"]')
  const sessionHeaderSlot = centerRoot?.querySelector('[data-slot="conversation.session.header"]')
  const sessionToolbar = sessionHeaderSlot?.querySelector('header')
  const sessionTitleRow = sessionToolbar?.firstElementChild
  const sessionTitleCluster = sessionTitleRow?.firstElementChild
  const sessionCrumbs = sessionTitleCluster?.querySelector('nav')
  const sessionActions = sessionCrumbs?.nextElementSibling
  const sessionUtilities = sessionToolbar?.querySelector('[data-slot="conversation.session.header.utilities"]')?.parentElement
  sessionHeaderSlot?.setAttribute('data-sandrone-session-header', 'true')
  sessionToolbar?.setAttribute('data-sandrone-session-toolbar', 'true')
  sessionTitleRow?.setAttribute('data-sandrone-session-title-row', 'true')
  sessionTitleCluster?.setAttribute('data-sandrone-session-title-cluster', 'true')
  sessionCrumbs?.setAttribute('data-sandrone-session-crumbs', 'true')
  sessionActions?.setAttribute('data-sandrone-session-actions', 'true')
  sessionUtilities?.setAttribute('data-sandrone-session-utilities', 'true')
  sessionToolbar?.querySelector('[role="tablist"]')?.setAttribute('data-sandrone-session-tabs', 'true')
  sessionUtilities?.querySelectorAll('button').forEach(button => {
    if (!/Session log|会话日志/i.test(textOf(button))) return
    button.setAttribute('data-sandrone-session-log', 'true')
    button.setAttribute('aria-label', '下载 Session 日志')
    button.setAttribute('title', '下载 Session 日志')
    if (!button.querySelector('[data-sandrone-session-log-icon]')) {
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      icon.setAttribute('viewBox', '0 0 18 18')
      icon.setAttribute('aria-hidden', 'true')
      icon.setAttribute('data-sandrone-session-log-icon', '')
      icon.innerHTML = '<path d="M9 2.75v8M6.15 8.15 9 11l2.85-2.85"/><path d="M3.75 13.1v1.15h10.5V13.1"/>'
      button.append(icon)
    }
  })
  centerRoot?.querySelector('[data-slot="conversation.session"]')?.setAttribute('data-sandrone-session-body', 'true')
  centerRoot?.querySelector('[data-slot="conversation.composer"], [data-composer-seat]')?.setAttribute('data-sandrone-composer', 'true')
  root.querySelectorAll('[aria-label="新建会话"]').forEach(element => element.setAttribute('data-sandrone-new-session', 'true'))
  root.querySelectorAll('[role="treeitem"]').forEach(element => {
    const label = (element.textContent || '').replace(/\s+/g, ' ').trim()
    const hasSessionActions = element.querySelector('[aria-label^="会话“"], [aria-label^="Session actions"]') !== null
    if ((label === '新会话' || label === 'New Session') && !hasSessionActions) {
      element.setAttribute('data-sandrone-provisional-session', 'true')
    } else {
      element.removeAttribute('data-sandrone-provisional-session')
    }
  })
  root.querySelectorAll('[aria-label="搜索会话"], [aria-label="视图选项"], [aria-label="添加工作区"], [aria-label="新建工作区"]').forEach(element => element.setAttribute('data-sandrone-sidebar-action', 'true'))
  root.querySelectorAll('button').forEach(element => {
    const label = textOf(element)
    if (!['仅可查看', '可写入工作区', '完全权限', 'Read Only', 'Workspace Write', 'Full access'].includes(label)) return
    if (!element.closest('[data-sandrone-composer]')) return
    element.setAttribute('data-sandrone-permission-trigger', 'true')
    element.closest('[class*="row"]')?.setAttribute('data-sandrone-composer-toolbar', 'true')
    const permissionRoot = element.parentElement
    const menu = permissionRoot?.querySelector('[role="menu"]')
    menu?.setAttribute('data-sandrone-permission-menu', 'true')
    menu?.querySelector('[role="presentation"]')?.setAttribute('data-sandrone-permission-viewport', 'true')
  })
  root.querySelectorAll('[data-composer-card] [contenteditable]').forEach(element => element.setAttribute('data-sandrone-composer-input', 'true'))
  root.querySelectorAll('[data-conversation-scroll], [data-composer-seat], [data-composer-card], [data-input-scroll], [role="tree"]').forEach(element => element.setAttribute('data-sandrone-surface-part', 'true'))
  root.querySelectorAll('[role="dialog"]').forEach(element => element.setAttribute('data-sandrone-dialog', 'true'))
}

function installSurfaceMarkers(ctx) {
  return ctx.effect(() => {
    markSurface()
    const observedRoot = document.getElementById('root') || document.body
    let frameId = 0
    let settleTimer = 0
    const scheduleMark = () => {
      if (frameId === 0) {
        frameId = window.requestAnimationFrame(() => {
          frameId = 0
          markSurface()
        })
      }
      if (settleTimer !== 0) window.clearTimeout(settleTimer)
      settleTimer = window.setTimeout(() => {
        settleTimer = 0
        markSurface()
      }, 500)
    }
    const observer = new MutationObserver(scheduleMark)
    observer.observe(observedRoot, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-sidebar-collapsed', 'data-rightbar-collapsed'] })
    const resizeObserver = new ResizeObserver(scheduleMark)
    resizeObserver.observe(observedRoot)
    window.addEventListener('resize', scheduleMark, { passive: true })
    return () => {
      observer.disconnect()
      resizeObserver.disconnect()
      window.removeEventListener('resize', scheduleMark)
      if (frameId !== 0) window.cancelAnimationFrame(frameId)
      if (settleTimer !== 0) window.clearTimeout(settleTimer)
      document.querySelectorAll('[data-sandrone-session-log-icon]').forEach(element => element.remove())
      document.querySelectorAll('[data-sandrone-shell], [data-sandrone-frame], [data-sandrone-sidebar-column], [data-sandrone-sidebar], [data-sandrone-sidebar-header], [data-sandrone-workspaces], [data-sandrone-region-host], [data-sandrone-settings], [data-sandrone-center], [data-sandrone-details], [data-sandrone-overlay], [data-sandrone-session-header], [data-sandrone-session-toolbar], [data-sandrone-session-title-row], [data-sandrone-session-title-cluster], [data-sandrone-session-crumbs], [data-sandrone-session-actions], [data-sandrone-session-utilities], [data-sandrone-session-tabs], [data-sandrone-session-body], [data-sandrone-composer], [data-sandrone-new-session], [data-sandrone-sidebar-action], [data-sandrone-permission-menu], [data-sandrone-permission-viewport], [data-sandrone-permission-trigger], [data-sandrone-composer-toolbar], [data-sandrone-composer-input], [data-sandrone-surface-part], [data-sandrone-dialog]').forEach(element => {
        delete element.dataset.sandroneShell
        delete element.dataset.sandroneFrame
        delete element.dataset.sandroneSidebarColumn
        delete element.dataset.sandroneSidebar
        delete element.dataset.sandroneSidebarHeader
        delete element.dataset.sandroneWorkspaces
        delete element.dataset.sandroneRegionHost
        delete element.dataset.sandroneSettings
        delete element.dataset.sandroneCenter
        delete element.dataset.sandroneDetails
        delete element.dataset.sandroneOverlay
        delete element.dataset.sandroneSessionHeader
        delete element.dataset.sandroneSessionToolbar
        delete element.dataset.sandroneSessionTitleRow
        delete element.dataset.sandroneSessionTitleCluster
        delete element.dataset.sandroneSessionCrumbs
        delete element.dataset.sandroneSessionActions
        delete element.dataset.sandroneSessionUtilities
        delete element.dataset.sandroneSessionTabs
        delete element.dataset.sandroneSessionBody
        delete element.dataset.sandroneComposer
        delete element.dataset.sandroneNewSession
        delete element.dataset.sandroneSidebarAction
        delete element.dataset.sandronePermissionMenu
        delete element.dataset.sandronePermissionViewport
        delete element.dataset.sandronePermissionTrigger
        delete element.dataset.sandroneComposerToolbar
        delete element.dataset.sandroneComposerInput
        delete element.dataset.sandroneSurfacePart
        delete element.dataset.sandroneDialog
        delete element.dataset.sandroneDesktop
      })
      const rootElement = document.getElementById('root')
      rootElement?.style.removeProperty('--sandrone-sidebar-width')
      rootElement?.style.removeProperty('--sandrone-frame-top')
      rootElement?.style.removeProperty('--sandrone-space-sidebar-offset')
    }
  }, 'sandrone-ui: semantic surface markers')
}

function installMessageImageEnhancements(ctx) {
  if (typeof window === 'undefined') return
  const desktop = window.sandroneDesktop
  return ctx.effect(() => {
    const localImages = new Map()
    let frameId = 0
    let lightboxPath = null

    const lightbox = document.createElement('div')
    lightbox.className = 'sandrone-image-lightbox'
    lightbox.hidden = true
    lightbox.innerHTML = `
      <button class="sandrone-image-lightbox-backdrop" type="button" aria-label="关闭图片预览"></button>
      <section class="sandrone-image-lightbox-panel" role="dialog" aria-modal="true" aria-label="图片预览">
        <div class="sandrone-image-lightbox-toolbar">
          <span class="sandrone-image-lightbox-title"></span>
          <button class="sandrone-image-lightbox-reveal" type="button">定位原图</button>
          <button class="sandrone-image-lightbox-close" type="button" aria-label="关闭图片预览">×</button>
        </div>
        <div class="sandrone-image-lightbox-stage"><img alt="" /></div>
      </section>`
    document.body.appendChild(lightbox)
    const lightboxImage = lightbox.querySelector('img')
    const lightboxTitle = lightbox.querySelector('.sandrone-image-lightbox-title')
    const revealButton = lightbox.querySelector('.sandrone-image-lightbox-reveal')
    const closeButton = lightbox.querySelector('.sandrone-image-lightbox-close')
    let returnFocus = null

    const closeLightbox = () => {
      if (lightbox.hidden) return
      lightbox.hidden = true
      lightboxPath = null
      lightboxImage.removeAttribute('src')
      document.documentElement.removeAttribute('data-sandrone-image-preview-open')
      if (returnFocus instanceof HTMLElement && returnFocus.isConnected) returnFocus.focus()
      returnFocus = null
    }
    const openLightbox = (src, alt, path, trigger) => {
      if (!src) return
      returnFocus = trigger instanceof HTMLElement ? trigger : null
      lightboxPath = path || null
      lightboxImage.src = src
      lightboxImage.alt = alt || '图片预览'
      lightboxTitle.textContent = alt || (path ? path.split(/[\\/]/).pop() : '图片预览')
      revealButton.hidden = !lightboxPath || typeof desktop?.revealLocalImage !== 'function'
      lightbox.hidden = false
      document.documentElement.dataset.sandroneImagePreviewOpen = 'true'
      closeButton.focus()
    }

    const enhanceRemoteImage = image => {
      if (!(image instanceof HTMLImageElement) || image.dataset.sandroneMessageImage) return
      image.dataset.sandroneMessageImage = 'remote'
      image.tabIndex = 0
      image.setAttribute('role', 'button')
      image.setAttribute('aria-label', `${image.alt || '图片'}，点击放大`)
    }

    const enhanceLocalImage = placeholder => {
      if (!(placeholder instanceof HTMLElement) || placeholder.dataset.sandroneLocalImageState) return
      const path = placeholder.getAttribute('data-sandrone-local-image')
      if (!path) return
      placeholder.dataset.sandroneLocalImageState = 'loading'
      const alt = placeholder.textContent?.trim() || path.split(/[\\/]/).pop() || '本地图片'
      placeholder.textContent = '正在加载本地图片…'
      if (typeof desktop?.readLocalImage !== 'function') {
        placeholder.dataset.sandroneLocalImageState = 'unavailable'
        placeholder.textContent = `${alt}（本地图片仅可在桌面端预览）`
        return
      }
      void desktop.readLocalImage(path).then(result => {
        if (!placeholder.isConnected || placeholder.getAttribute('data-sandrone-local-image') !== path) return
        if (!result?.ok || !result.bytes) {
          placeholder.dataset.sandroneLocalImageState = 'error'
          placeholder.textContent = `${alt}（${result?.error || '图片加载失败'}）`
          return
        }
        const objectUrl = URL.createObjectURL(new Blob([result.bytes], { type: result.mimeType || 'application/octet-stream' }))
        localImages.set(placeholder, objectUrl)
        placeholder.dataset.sandroneLocalImageState = 'ready'
        placeholder.textContent = ''
        const preview = document.createElement('button')
        preview.type = 'button'
        preview.className = 'sandrone-message-image-preview'
        preview.dataset.sandroneImageSrc = objectUrl
        preview.dataset.sandroneImagePath = path
        preview.dataset.sandroneImageAlt = alt
        preview.setAttribute('aria-label', `${alt}，点击放大`)
        const image = document.createElement('img')
        image.src = objectUrl
        image.alt = alt
        image.loading = 'lazy'
        image.decoding = 'async'
        preview.appendChild(image)
        const caption = document.createElement('span')
        caption.className = 'sandrone-message-image-caption'
        caption.textContent = result.name || alt
        const reveal = document.createElement('button')
        reveal.type = 'button'
        reveal.className = 'sandrone-message-image-reveal'
        reveal.dataset.sandroneImagePath = path
        reveal.textContent = '定位原图'
        placeholder.append(preview, caption, reveal)
      }).catch(() => {
        if (!placeholder.isConnected) return
        placeholder.dataset.sandroneLocalImageState = 'error'
        placeholder.textContent = `${alt}（图片加载失败）`
      })
    }

    const scan = () => {
      frameId = 0
      const session = document.querySelector('[data-sandrone-session-body]')
      session?.querySelectorAll('[data-chat-flow-kind^="assistant"] img').forEach(enhanceRemoteImage)
      session?.querySelectorAll('[data-chat-flow-kind^="assistant"] [data-sandrone-local-image]').forEach(enhanceLocalImage)
      for (const [element, objectUrl] of localImages) {
        if (element.isConnected) continue
        URL.revokeObjectURL(objectUrl)
        localImages.delete(element)
      }
    }
    const scheduleScan = () => {
      if (frameId !== 0) return
      frameId = window.requestAnimationFrame(scan)
    }
    const activatePreview = target => {
      const localPreview = target.closest?.('.sandrone-message-image-preview')
      if (localPreview instanceof HTMLElement) {
        openLightbox(localPreview.dataset.sandroneImageSrc, localPreview.dataset.sandroneImageAlt, localPreview.dataset.sandroneImagePath, localPreview)
        return true
      }
      if (target instanceof HTMLImageElement && target.dataset.sandroneMessageImage === 'remote') {
        openLightbox(target.currentSrc || target.src, target.alt, null, target)
        return true
      }
      return false
    }
    const onClick = event => {
      const target = event.target
      if (!(target instanceof Element)) return
      const reveal = target.closest('.sandrone-message-image-reveal')
      if (reveal instanceof HTMLElement) {
        void desktop?.revealLocalImage?.(reveal.dataset.sandroneImagePath)
        return
      }
      activatePreview(target)
    }
    const onKeyDown = event => {
      if (event.key === 'Escape') {
        closeLightbox()
        return
      }
      if (event.key !== 'Enter' && event.key !== ' ') return
      if (activatePreview(event.target)) event.preventDefault()
    }
    const observer = new MutationObserver(scheduleScan)
    observer.observe(document.getElementById('root') || document.body, { childList: true, subtree: true })
    document.addEventListener('click', onClick)
    document.addEventListener('keydown', onKeyDown)
    lightbox.querySelector('.sandrone-image-lightbox-backdrop').addEventListener('click', closeLightbox)
    closeButton.addEventListener('click', closeLightbox)
    revealButton.addEventListener('click', () => {
      if (lightboxPath) void desktop?.revealLocalImage?.(lightboxPath)
    })
    scan()
    return () => {
      observer.disconnect()
      document.removeEventListener('click', onClick)
      document.removeEventListener('keydown', onKeyDown)
      if (frameId !== 0) window.cancelAnimationFrame(frameId)
      for (const objectUrl of localImages.values()) URL.revokeObjectURL(objectUrl)
      localImages.clear()
      lightbox.remove()
      document.documentElement.removeAttribute('data-sandrone-image-preview-open')
    }
  }, 'sandrone-ui: message image previews')
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

function ScreenshotDirectoryRow() {
  const desktop = window.sandroneDesktop
  const [directory, setDirectory] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    if (!desktop?.getScreenshotDirectory) return undefined
    void desktop.getScreenshotDirectory().then(value => { if (alive) setDirectory(String(value || '')) }).catch(() => {})
    return () => { alive = false }
  }, [desktop])

  if (!desktop?.chooseScreenshotDirectory) return null
  const choose = async () => {
    if (busy) return
    setBusy(true)
    try {
      const value = await desktop.chooseScreenshotDirectory()
      if (value) setDirectory(String(value))
    } finally {
      setBusy(false)
    }
  }
  return <div className="sandrone-setting-row sandrone-screenshot-directory-row">
    <div className="sandrone-setting-copy">
      <div className="sandrone-setting-label">截图默认保存路径</div>
      <div className="sandrone-setting-hint sandrone-setting-path" title={directory || '未设置'}>{directory || '读取中…'}</div>
    </div>
    <button type="button" className="sandrone-setting-action" disabled={busy} onClick={choose}>{busy ? '选择中…' : '选择文件夹'}</button>
  </div>
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
      <ScreenshotDirectoryRow />
    </section>
  )
}

const EXTENSIONS_STORAGE_KEY = 'sandrone.harness.extensions.v1'
const DEFAULT_EXTENSIONS_CONFIG = {
  version: 1,
  buddy: { enabled: true, name: 'Buddy', personality: '安静、可靠，在编码时陪伴你。', tone: '简短、温和、不过度打扰', muted: false, avatar: 'cat' },
  mcp: { servers: [] },
  skills: { disabled: [] },
  plugins: { managed: [] },
  im: { enabled: false, platform: 'qqbot', appId: '', secret: '', token: '', serverUrl: 'ws://127.0.0.1:3456', defaultWorkDir: '', allowedUsers: [], autoStart: false },
}

function normalizeClientExtensions(value) {
  const input = value && typeof value === 'object' ? value : {}
  return {
    version: 1,
    buddy: { ...DEFAULT_EXTENSIONS_CONFIG.buddy, ...(input.buddy || {}) },
    mcp: { servers: Array.isArray(input.mcp?.servers) ? input.mcp.servers : [] },
    skills: { disabled: Array.isArray(input.skills?.disabled) ? input.skills.disabled : [] },
    plugins: { managed: Array.isArray(input.plugins?.managed) ? input.plugins.managed : [] },
    im: { ...DEFAULT_EXTENSIONS_CONFIG.im, ...(input.im || {}), platform: 'qqbot' },
  }
}

async function readExtensionsConfig() {
  const desktop = window.sandroneDesktop?.extensions
  if (desktop?.getConfig) {
    try { return normalizeClientExtensions(await desktop.getConfig()) } catch {}
  }
  try { return normalizeClientExtensions(JSON.parse(window.localStorage.getItem(EXTENSIONS_STORAGE_KEY) || 'null')) } catch { return normalizeClientExtensions(DEFAULT_EXTENSIONS_CONFIG) }
}

async function persistExtensionsConfig(value) {
  const next = normalizeClientExtensions(value)
  const desktop = window.sandroneDesktop?.extensions
  let saved = next
  if (desktop?.saveConfig) {
    try { saved = normalizeClientExtensions(await desktop.saveConfig(next)) } catch {}
  }
  window.localStorage.setItem(EXTENSIONS_STORAGE_KEY, JSON.stringify(saved))
  window.dispatchEvent(new CustomEvent('sandrone:extensions-config', { detail: saved }))
  return saved
}

function useExtensionsConfig() {
  const [config, setConfig] = useState(() => normalizeClientExtensions(DEFAULT_EXTENSIONS_CONFIG))
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    readExtensionsConfig().then(value => { if (active) setConfig(value) }, cause => { if (active) setError(String(cause)) }).finally(() => { if (active) setLoading(false) })
    const onChanged = event => setConfig(normalizeClientExtensions(event.detail))
    window.addEventListener('sandrone:extensions-config', onChanged)
    const removeDesktopListener = window.sandroneDesktop?.extensions?.onChanged?.(value => setConfig(normalizeClientExtensions(value)))
    return () => {
      active = false
      window.removeEventListener('sandrone:extensions-config', onChanged)
      removeDesktopListener?.()
    }
  }, [])

  const save = async next => {
    setSaving(true)
    setError('')
    try {
      const saved = await persistExtensionsConfig(typeof next === 'function' ? next(config) : next)
      setConfig(saved)
      return saved
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      return null
    } finally {
      setSaving(false)
    }
  }
  return { config, setConfig, loading, saving, error, save }
}

function SettingsPage({ eyebrow, title, description, actions, notice, error, children }) {
  return (
    <section className="sandrone-extension-page" data-sandrone-settings-section>
      <header className="sandrone-extension-heading">
        <div><span>{eyebrow}</span><h2>{title}</h2><p>{description}</p></div>
        {actions ? <div className="sandrone-extension-heading-actions">{actions}</div> : null}
      </header>
      {notice ? <div className="sandrone-extension-notice">{notice}</div> : null}
      {error ? <div className="sandrone-extension-error" role="alert">{error}</div> : null}
      {children}
    </section>
  )
}

function SettingSwitch({ checked, onChange, label, disabled }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`sandrone-setting-switch${checked ? ' is-on' : ''}`} disabled={disabled} onClick={() => onChange(!checked)}>
      <span />
    </button>
  )
}

function parseJsonObject(value) {
  if (!value.trim()) return {}
  const parsed = JSON.parse(value)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new TypeError('必须填写 JSON 对象')
  return parsed
}

function BuddySettingsSection() {
  const { config, setConfig, loading, saving, error, save } = useExtensionsConfig()
  const buddy = config.buddy
  const update = (key, value) => setConfig(current => ({ ...current, buddy: { ...current.buddy, [key]: value } }))
  return (
    <SettingsPage eyebrow="SANDRONE COMPANION" title="Buddy" description="定制横向会话栏里的开发伙伴，不改动 DeepSeek 的任务执行逻辑。" error={error} actions={<button data-sandrone-settings-primary-action disabled={loading || saving} onClick={() => save(config)}>{saving ? '保存中…' : '保存 Buddy'}</button>}>
      <div className="sandrone-buddy-settings-hero" data-sandrone-settings-card>
        <span className="sandrone-buddy-face settings"><i /><i /><b /></span>
        <div><strong>{buddy.name || 'Buddy'}</strong><small>{buddy.tone || '安静陪伴'}</small></div>
        <SettingSwitch checked={buddy.enabled} disabled={loading} label="启用 Buddy" onChange={value => update('enabled', value)} />
      </div>
      <div className="sandrone-extension-grid two">
        <label className="sandrone-extension-field"><span>名称</span><input value={buddy.name} maxLength={50} onChange={event => update('name', event.target.value)} /></label>
        <label className="sandrone-extension-field"><span>外观</span><select value={buddy.avatar} onChange={event => update('avatar', event.target.value)}><option value="cat">角色小猫</option><option value="robot">机械伙伴</option><option value="ghost">幽灵伙伴</option><option value="owl">猫头鹰</option></select></label>
        <label className="sandrone-extension-field wide"><span>人格</span><textarea rows="4" maxLength={800} value={buddy.personality} onChange={event => update('personality', event.target.value)} /></label>
        <label className="sandrone-extension-field wide"><span>说话语气</span><input maxLength={600} value={buddy.tone} onChange={event => update('tone', event.target.value)} /></label>
      </div>
    </SettingsPage>
  )
}

function McpSettingsSection() {
  const { config, setConfig, loading, saving, error, save } = useExtensionsConfig()
  const servers = config.mcp.servers
  const setServers = next => setConfig(current => ({ ...current, mcp: { servers: next } }))
  const updateServer = (index, patch) => setServers(servers.map((server, itemIndex) => itemIndex === index ? { ...server, ...patch } : server))
  const add = () => setServers([...servers, { id: `mcp-${Date.now()}`, name: `server-${servers.length + 1}`, enabled: true, transport: 'stdio', command: '', args: [], env: {}, cwd: '', url: '', headers: {} }])
  const updateJson = (index, key, value) => {
    try { updateServer(index, { [key]: parseJsonObject(value), [`${key}Error`]: '' }) } catch (cause) { updateServer(index, { [`${key}Draft`]: value, [`${key}Error`]: cause.message }) }
  }
  return (
    <SettingsPage eyebrow="MODEL CONTEXT PROTOCOL" title="MCP" description="一个服务器对应一个 DeepSeek MCP 插件实例，启停和修改会写入启动 patch。" error={error} notice="保存后重启 Harness 生效；MCP 自身仍由 DeepSeek 官方客户端负责连接、重连与工具注册。" actions={<><button className="sandrone-extension-secondary" onClick={add}>添加服务器</button><button data-sandrone-settings-primary-action disabled={loading || saving} onClick={() => save(config)}>{saving ? '保存中…' : '保存配置'}</button></>}>
      <div className="sandrone-extension-stack">
        {servers.map((server, index) => <article key={server.id || index} className="sandrone-mcp-card" data-sandrone-settings-card>
          <header><div><strong>{server.name || '未命名服务器'}</strong><small>{server.transport === 'streamable-http' ? 'Streamable HTTP' : 'stdio'}</small></div><div><SettingSwitch checked={server.enabled !== false} label={`启用 ${server.name}`} onChange={enabled => updateServer(index, { enabled })} /><button className="sandrone-extension-danger" onClick={() => setServers(servers.filter((_, itemIndex) => itemIndex !== index))}>移除</button></div></header>
          <div className="sandrone-extension-grid two compact">
            <label className="sandrone-extension-field"><span>服务器名称</span><input value={server.name || ''} onChange={event => updateServer(index, { name: event.target.value })} placeholder="github" /></label>
            <label className="sandrone-extension-field"><span>传输方式</span><select value={server.transport || 'stdio'} onChange={event => updateServer(index, { transport: event.target.value })}><option value="stdio">stdio</option><option value="streamable-http">Streamable HTTP</option></select></label>
            {server.transport === 'streamable-http' ? <><label className="sandrone-extension-field wide"><span>服务器 URL</span><input value={server.url || ''} onChange={event => updateServer(index, { url: event.target.value })} placeholder="http://127.0.0.1:3000/mcp" /></label><label className="sandrone-extension-field wide"><span>请求头 JSON</span><textarea rows="3" className={server.headersError ? 'is-invalid' : ''} value={server.headersDraft ?? JSON.stringify(server.headers || {}, null, 2)} onChange={event => updateJson(index, 'headers', event.target.value)} />{server.headersError ? <small className="sandrone-extension-field-error">{server.headersError}</small> : null}</label></> : <><label className="sandrone-extension-field"><span>命令</span><input value={server.command || ''} onChange={event => updateServer(index, { command: event.target.value })} placeholder="npx" /></label><label className="sandrone-extension-field"><span>参数（每行一个）</span><textarea rows="3" value={(server.args || []).join('\n')} onChange={event => updateServer(index, { args: event.target.value.split('\n').filter(Boolean) })} /></label><label className="sandrone-extension-field"><span>工作目录</span><input value={server.cwd || ''} onChange={event => updateServer(index, { cwd: event.target.value })} /></label><label className="sandrone-extension-field"><span>环境变量 JSON</span><textarea rows="3" className={server.envError ? 'is-invalid' : ''} value={server.envDraft ?? JSON.stringify(server.env || {}, null, 2)} onChange={event => updateJson(index, 'env', event.target.value)} />{server.envError ? <small className="sandrone-extension-field-error">{server.envError}</small> : null}</label></>}
          </div>
        </article>)}
        {servers.length === 0 ? <div className="sandrone-extension-empty">还没有 MCP 服务器。添加后，工具会以 <code>mcp__服务器__工具</code> 的形式交给模型。</div> : null}
      </div>
    </SettingsPage>
  )
}

function SkillsSettingsSection() {
  const { config, saving, error, save } = useExtensionsConfig()
  const [skills, setSkills] = useState([])
  const [loading, setLoading] = useState(true)
  const scan = () => {
    setLoading(true)
    const api = window.sandroneDesktop?.extensions
    Promise.resolve(api?.scanSkills ? api.scanSkills().catch(() => []) : []).then(setSkills).finally(() => setLoading(false))
  }
  useEffect(scan, [])
  const toggle = async skill => {
    if (!skill.managed) return
    const disabled = new Set(config.skills.disabled)
    if (skill.enabled) disabled.add(skill.directory)
    else disabled.delete(skill.directory)
    const saved = await save({ ...config, skills: { disabled: [...disabled] } })
    if (saved) scan()
  }
  return (
    <SettingsPage eyebrow="SKILL CATALOG" title="Skills" description="查看 DSH_HOME 与 Sandrone 自带技能；只有 Sandrone 自带项支持安全启停。" error={error} actions={<button className="sandrone-extension-secondary" onClick={scan}>{loading ? '读取中…' : '刷新'}</button>} notice="关闭 Sandrone 技能只会移除对应的托管副本，不会删除你的用户 Skill。">
      <div className="sandrone-extension-list">
        {skills.map(skill => <article key={skill.key} className="sandrone-extension-row" data-sandrone-settings-card><div><strong>{skill.name}</strong><p>{skill.description}</p><small>{skill.source === 'sandrone' ? 'Sandrone 托管' : 'DeepSeek / 用户目录'} · {skill.path}</small></div>{skill.managed ? <SettingSwitch checked={skill.enabled} disabled={saving} label={`启用 ${skill.name}`} onChange={() => toggle(skill)} /> : <span className="sandrone-extension-badge">只读</span>}</article>)}
        {!loading && skills.length === 0 ? <div className="sandrone-extension-empty">Web 模式无法直接扫描本机技能目录；桌面版会显示完整清单。</div> : null}
      </div>
    </SettingsPage>
  )
}

function ManagedPluginsTab() {
  const { config, setConfig, saving, error, save } = useExtensionsConfig()
  const managed = config.plugins.managed
  const setManaged = next => setConfig(current => ({ ...current, plugins: { managed: next } }))
  const update = (index, patch) => setManaged(managed.map((entry, itemIndex) => itemIndex === index ? { ...entry, ...patch } : entry))
  const updateConfig = (index, value) => {
    try { update(index, { config: parseJsonObject(value), configDraft: undefined, configError: '' }) } catch (cause) { update(index, { configDraft: value, configError: cause.message }) }
  }
  return <div className="sandrone-managed-plugins">
    <div className="sandrone-extension-notice">DeepSeek 原生插件清单仍是运行态权威；下面只管理额外注入的 Sandrone 插件，保存后重启 Harness 生效。</div>
    {error ? <div className="sandrone-extension-error">{error}</div> : null}
    <div className="sandrone-plugin-summary"><span><strong>{managed.length}</strong> Sandrone 托管插件</span><button className="sandrone-extension-secondary" onClick={() => setManaged([...managed, { id: `sandrone-plugin-${Date.now()}`, name: '', enabled: true, config: {} }])}>添加插件</button><button data-sandrone-settings-primary-action disabled={saving} onClick={() => save(config)}>保存</button></div>
    <div className="sandrone-extension-stack">{managed.map((entry, index) => <article className="sandrone-extension-row editable" key={entry.id || index} data-sandrone-settings-card><div className="sandrone-extension-grid two compact"><label className="sandrone-extension-field"><span>实例 ID</span><input value={entry.id || ''} onChange={event => update(index, { id: event.target.value })} /></label><label className="sandrone-extension-field"><span>npm 包名</span><input value={entry.name || ''} onChange={event => update(index, { name: event.target.value })} placeholder="@scope/dsh-plugin" /></label><label className="sandrone-extension-field wide"><span>插件配置 JSON</span><textarea rows="4" className={entry.configError ? 'is-invalid' : ''} value={entry.configDraft ?? JSON.stringify(entry.config || {}, null, 2)} onChange={event => updateConfig(index, event.target.value)} />{entry.configError ? <small className="sandrone-extension-field-error">{entry.configError}</small> : null}</label></div><div><SettingSwitch checked={entry.enabled !== false} label={`启用 ${entry.name}`} onChange={enabled => update(index, { enabled })} /><button className="sandrone-extension-danger" onClick={() => setManaged(managed.filter((_, itemIndex) => itemIndex !== index))}>移除</button></div></article>)}</div>
  </div>
}

function ImSettingsSection() {
  const { config, setConfig, loading, saving, error, save } = useExtensionsConfig()
  const im = config.im
  const update = (key, value) => setConfig(current => ({ ...current, im: { ...current.im, [key]: value } }))
  const chooseDirectory = async () => {
    const path = await window.sandroneDesktop?.pickDirectory?.()
    if (path) update('defaultWorkDir', path)
  }
  return (
    <SettingsPage eyebrow="IM · QQ BOT" title="IM 管理" description="配置从 QQ 手机端连接 Sandrone 会话所需的凭证和默认工作区。" error={error} notice="本页负责保存 QQ Bot 接入参数；适配器运行桥接未启动时不会对外建立连接。" actions={<button data-sandrone-settings-primary-action disabled={loading || saving} onClick={() => save(config)}>{saving ? '保存中…' : '保存 IM 配置'}</button>}>
      <div className="sandrone-im-status" data-sandrone-settings-card><div><span className={im.enabled ? 'is-online' : ''} /><strong>QQ Bot</strong><small>{im.enabled ? '配置为启用' : '当前停用'}</small></div><SettingSwitch checked={im.enabled} label="启用 QQ Bot" onChange={value => update('enabled', value)} /></div>
      <div className="sandrone-extension-grid two">
        <label className="sandrone-extension-field"><span>App ID</span><input value={im.appId} onChange={event => update('appId', event.target.value)} /></label>
        <label className="sandrone-extension-field"><span>App Secret</span><input type="password" value={im.secret} onChange={event => update('secret', event.target.value)} autoComplete="new-password" /></label>
        <label className="sandrone-extension-field wide"><span>默认工作区</span><span className="sandrone-extension-path"><input value={im.defaultWorkDir} onChange={event => update('defaultWorkDir', event.target.value)} /><button type="button" onClick={chooseDirectory}>选择</button></span></label>
        <label className="sandrone-extension-field"><span>Harness 地址</span><input value={im.serverUrl} onChange={event => update('serverUrl', event.target.value)} /></label>
        <label className="sandrone-extension-field"><span>允许用户（逗号分隔）</span><input value={(im.allowedUsers || []).join(', ')} onChange={event => update('allowedUsers', event.target.value.split(',').map(item => item.trim()).filter(Boolean))} /></label>
      </div>
    </SettingsPage>
  )
}

function insertFallbackFileText(files) {
  const editor = document.querySelector('[data-sandrone-composer-input]')
  if (!(editor instanceof HTMLElement) || !editor.isContentEditable) return false
  const names = files.map(file => `[${file.name || 'image.png'}]`).join(' ')
  const transfer = new DataTransfer()
  transfer.setData('text/plain', ` ${names}`)
  editor.focus()
  const paste = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer })
  editor.dispatchEvent(paste)
  return paste.defaultPrevented
}

function dispatchFilesToOfficialInput(files) {
  const editor = document.querySelector('[data-sandrone-composer-input]')
  if (!(editor instanceof HTMLElement) || !editor.isContentEditable) return false
  try {
    const transfer = new DataTransfer()
    files.forEach(file => transfer.items.add(file))
    editor.focus()
    const paste = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer })
    editor.dispatchEvent(paste)
    return paste.defaultPrevented
  } catch {
    return false
  }
}

const PROVIDER_REASONING_LEVELS = Object.freeze(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
const PROVIDER_REASONING_PRESETS = Object.freeze({
  none: false,
  standard: Object.freeze({ off: null, low: 'low', medium: 'medium', high: 'high' }),
  extended: Object.freeze({ off: null, minimal: 'minimal', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' }),
})

function cloneReasoningEfforts(value) {
  if (value === false) return false
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return Object.fromEntries(PROVIDER_REASONING_LEVELS.flatMap(level => {
    const wire = value[level]
    return wire === null || typeof wire === 'string' ? [[level, wire]] : []
  }))
}

function reasoningPresetOf(value) {
  if (value === false || value === undefined) return value === false ? 'none' : 'undeclared'
  const normalized = JSON.stringify(cloneReasoningEfforts(value))
  if (normalized === JSON.stringify(PROVIDER_REASONING_PRESETS.standard)) return 'standard'
  if (normalized === JSON.stringify(PROVIDER_REASONING_PRESETS.extended)) return 'extended'
  return 'custom'
}

function reasoningPresetValue(preset) {
  if (preset === 'undeclared') return undefined
  const value = PROVIDER_REASONING_PRESETS[preset]
  return value === false ? false : { ...value }
}

function reasoningMappingText(value) {
  return value && typeof value === 'object'
    ? Object.entries(cloneReasoningEfforts(value) || {}).map(([level, wire]) => `${level}=${wire ?? ''}`).join(', ')
    : ''
}

function installProviderCapabilityFields(remote) {
  return () => {
    const root = document.getElementById('root') || document.body
    const pendingImages = new Map()
    const pendingReasoning = new Map()
    const savingImages = new Set()
    const savingReasoning = new Set()
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
      const response = await remote?.settings?.describe?.().catch(() => null)
      return response?.ok ? response.value?.namespaces?.find(item => item.ns === 'llm-pi-ai') : null
    }
    const persistField = async (route, modelId, field, value) => {
      const namespace = await snapshot()
      const models = namespace?.value?.providers?.[route]?.models
      const index = Array.isArray(models) ? models.findIndex(model => String(model?.id) === modelId) : -1
      if (!namespace || index < 0) return { status: 'deferred' }
      const path = ['providers', route, 'models', String(index), field]
      const result = await remote.settings.mutate('llm-pi-ai', [value === undefined ? { op: 'unset', path } : { op: 'set', path, value }], namespace.revision).catch(() => null)
      return result?.ok
        ? { status: 'saved' }
        : { status: 'failed', message: result?.error?.message || '保存模型能力失败' }
    }
    const persistImage = async (route, modelId, enabled) => {
      const key = `${route}:${modelId}`
      if (savingImages.has(key)) return { status: 'busy' }
      savingImages.add(key)
      try {
        const result = await persistField(route, modelId, 'input', enabled ? ['text', 'image'] : ['text'])
        if (result.status === 'deferred') pendingImages.set(key, enabled)
        else pendingImages.delete(key)
        return result
      } finally {
        savingImages.delete(key)
      }
    }
    const persistReasoning = async (route, modelId, value) => {
      const key = `${route}:${modelId}`
      if (savingReasoning.has(key)) return { status: 'busy' }
      savingReasoning.add(key)
      try {
        const result = await persistField(route, modelId, 'reasoningEfforts', value)
        if (result.status === 'deferred') pendingReasoning.set(key, cloneReasoningEfforts(value) ?? value)
        else pendingReasoning.delete(key)
        return result
      } finally {
        savingReasoning.delete(key)
      }
    }
    const decorate = async () => {
      const panel = document.querySelector('[role="dialog"][aria-modal="true"]')
      if (!panel || !remote?.settings?.describe) return
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
        if (row.querySelector('[data-sandrone-provider-capabilities]')) {
          if (pendingImages.has(key) && model) void persistImage(route, modelId, pendingImages.get(key)).then(result => { if (result.status === 'saved') refresh() })
          if (pendingReasoning.has(key) && model) void persistReasoning(route, modelId, pendingReasoning.get(key)).then(result => { if (result.status === 'saved') refresh() })
          return
        }
        const capabilities = document.createElement('div')
        capabilities.dataset.sandroneProviderCapabilities = 'true'
        capabilities.className = 'sandrone-provider-capabilities'
        const label = document.createElement('label')
        label.dataset.sandroneProviderImageField = 'true'
        label.className = 'sandrone-provider-image-field'
        const checkbox = document.createElement('input')
        checkbox.type = 'checkbox'
        checkbox.checked = pendingImages.get(key) ?? (Array.isArray(model?.input) && model.input.includes('image'))
        checkbox.addEventListener('change', async () => {
          const enabled = checkbox.checked
          pendingImages.set(key, enabled)
          checkbox.disabled = true
          const result = await persistImage(route, modelId, enabled)
          checkbox.disabled = false
          if (result.status === 'failed') {
            checkbox.checked = !enabled
            checkbox.title = result.message
          } else checkbox.removeAttribute('title')
        })
        const text = document.createElement('span')
        text.textContent = '支持图片'
        label.append(checkbox, text)

        const reasoning = document.createElement('label')
        reasoning.dataset.sandroneProviderReasoningField = 'true'
        reasoning.className = 'sandrone-provider-reasoning-field'
        const reasoningText = document.createElement('span')
        reasoningText.textContent = '推理档位'
        const select = document.createElement('select')
        select.setAttribute('aria-label', `推理档位 ${modelId}`)
        for (const [value, name] of [
          ['undeclared', '未声明（仅提供方默认）'],
          ['none', '不支持推理'],
          ['standard', '标准：关 / 低 / 中 / 高'],
          ['extended', '完整：关 / 最低 / 低 / 中 / 高 / 超高 / 最大'],
          ['custom', '自定义映射'],
        ]) {
          const option = document.createElement('option')
          option.value = value
          option.textContent = name
          select.append(option)
        }
        let committedReasoning = cloneReasoningEfforts(model?.reasoningEfforts) ?? model?.reasoningEfforts
        const currentReasoning = pendingReasoning.has(key) ? pendingReasoning.get(key) : committedReasoning
        select.value = reasoningPresetOf(currentReasoning)
        const mapping = document.createElement('input')
        mapping.type = 'text'
        mapping.className = 'sandrone-provider-reasoning-map'
        mapping.setAttribute('aria-label', `推理档位映射 ${modelId}`)
        mapping.placeholder = 'off=, low=low, medium=medium, high=high'
        mapping.value = reasoningMappingText(currentReasoning)
        mapping.hidden = select.value !== 'custom'
        const reasoningStatus = document.createElement('small')
        reasoningStatus.className = 'sandrone-provider-reasoning-status'
        const parseMapping = () => {
          const value = {}
          for (const part of mapping.value.split(',')) {
            const [rawLevel, ...rawWire] = part.split('=')
            const level = rawLevel?.trim()
            if (!PROVIDER_REASONING_LEVELS.includes(level)) continue
            const wire = rawWire.join('=').trim()
            if (level !== 'off' && !wire) continue
            value[level] = level === 'off' && !wire ? null : wire
          }
          return value
        }
        const saveReasoning = async (value) => {
          pendingReasoning.set(key, cloneReasoningEfforts(value) ?? value)
          select.disabled = true
          mapping.disabled = true
          reasoningStatus.textContent = '保存中…'
          reasoningStatus.classList.remove('is-error')
          const result = await persistReasoning(route, modelId, value)
          select.disabled = false
          mapping.disabled = false
          if (result.status === 'failed') {
            reasoningStatus.textContent = result.message
            reasoningStatus.classList.add('is-error')
            select.value = reasoningPresetOf(committedReasoning)
            mapping.value = reasoningMappingText(committedReasoning)
            mapping.hidden = select.value !== 'custom'
          } else {
            if (result.status === 'saved') committedReasoning = cloneReasoningEfforts(value) ?? value
            reasoningStatus.textContent = result.status === 'deferred' ? '保存 Provider 后生效' : '已保存'
          }
        }
        select.addEventListener('change', () => {
          mapping.hidden = select.value !== 'custom'
          if (select.value === 'custom') {
            reasoningStatus.textContent = '编辑映射后生效'
            mapping.focus()
          } else void saveReasoning(reasoningPresetValue(select.value))
        })
        mapping.addEventListener('change', () => {
          const value = parseMapping()
          if (!Object.keys(value).some(level => level !== 'off')) {
            reasoningStatus.textContent = '至少声明一个非“关闭”的推理档位'
            reasoningStatus.classList.add('is-error')
            return
          }
          void saveReasoning(value)
        })
        reasoning.append(reasoningText, select, mapping, reasoningStatus)
        capabilities.append(label, reasoning)
        row.append(capabilities)
        if (pendingImages.has(key) && model) void persistImage(route, modelId, pendingImages.get(key)).then(result => { if (result.status === 'saved') refresh() })
        if (pendingReasoning.has(key) && model) void persistReasoning(route, modelId, pendingReasoning.get(key)).then(result => { if (result.status === 'saved') refresh() })
      })
    }
    const observer = new MutationObserver(refresh)
    observer.observe(root, { childList: true, subtree: true })
    refresh()
    return () => {
      observer.disconnect()
      if (frame) window.cancelAnimationFrame(frame)
      document.querySelectorAll('[data-sandrone-provider-capabilities]').forEach(element => element.remove())
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

function ImageCapabilitySection({ remote }) {
  const [state, setState] = useState({ status: 'loading', rows: [], revision: null, error: '' })
  const load = async () => {
    if (!remote?.settings?.describe) return
    setState(current => ({ ...current, status: 'loading', error: '' }))
    try {
      const response = await Promise.race([
        remote.settings.describe(),
        new Promise((_, reject) => window.setTimeout(() => reject(new Error('读取模型能力超时，请重载页面后重试')), 4000)),
      ])
      if (!response?.ok) throw new Error(response?.error?.message || '读取模型设置失败')
      const namespace = response.value?.namespaces?.find(item => item.ns === 'llm-pi-ai')
      setState({ status: namespace ? 'ready' : 'unsupported', rows: imageCapabilityModels(namespace), revision: namespace?.revision ?? null, error: '' })
    } catch (error) {
      setState(current => ({ ...current, status: 'error', error: error?.message || '读取模型设置失败' }))
    }
  }

  useEffect(() => { void load() }, [remote])

  const toggle = async (row, enabled) => {
    if (!remote?.settings?.mutate || state.revision == null) return
    const input = enabled ? ['text', 'image'] : ['text']
    setState(current => ({ ...current, status: 'saving', error: '' }))
    try {
      const response = await remote.settings.mutate('llm-pi-ai', [{ op: 'set', path: row.path, value: input }], state.revision)
      if (!response?.ok) throw new Error(response?.error?.message || '保存图片能力失败')
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
            {state.status === 'loading' || state.status === 'saving' ? '正在读取模型能力…' : state.status === 'unsupported' ? '当前没有可配置的 OpenAI-compatible 模型。' : state.error || '这里只记录模型能力提示，不再拦截图片；Harness 会始终转发，最终由实际模型接口决定是否接受。'}
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
      <div className="sandrone-image-capability-note">图片会进入耐久附件存储并随消息传给 LLM。即使模型未声明图片能力，Harness 也不会提前拒绝；不支持时保留 Provider 的原始错误。</div>
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
  const armedRef = useRef(false)
  const outcomeRef = useRef(props)
  const aliveRef = useRef(true)
  outcomeRef.current = props

  useEffect(() => {
    aliveRef.current = true
    return () => { aliveRef.current = false }
  }, [])

  useEffect(() => {
    if (!props.open) {
      armedRef.current = false
      return
    }
    if (armedRef.current) return
    armedRef.current = true
    const desktop = window.sandroneDesktop
    if (!desktop || typeof desktop.pickDirectory !== 'function') {
      outcomeRef.current.onError?.('系统目录选择器不可用')
      return
    }
    void desktop.pickDirectory()
      .then(path => {
        if (!aliveRef.current) return
        if (path === null) outcomeRef.current.onCancel()
        else outcomeRef.current.onPicked(path)
      })
      .catch(reason => {
        if (!aliveRef.current) return
        outcomeRef.current.onError?.(reason instanceof Error ? reason.message : String(reason))
      })
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
    let injectedElements = []
    let root = null
    const clearMarkers = () => {
      for (const element of injectedElements) element.remove()
      injectedElements = []
      for (const [element, attribute] of markedElements) element.removeAttribute(attribute)
      markedElements = []
    }
    const mark = (element, attribute) => {
      if (!(element instanceof Element) || element.hasAttribute(attribute)) return
      element.setAttribute(attribute, 'true')
      markedElements.push([element, attribute])
    }
    const settingsNavIcons = new Map([
      ['Skills', ['skill', '<path d="M4.25 2.75h6.1l3.4 3.4v8.1a1 1 0 0 1-1 1h-8.5a1 1 0 0 1-1-1V3.75a1 1 0 0 1 1-1Z"/><path d="M10.25 2.9v3.35h3.35M6.1 10.1l.55-1.15 1.15-.55-1.15-.55-.55-1.15-.55 1.15-1.15.55 1.15.55.55 1.15Zm3.25 3.1.4-.85.85-.4-.85-.4-.4-.85-.4.85-.85.4.85.4.4.85Z"/>']],
      ['MCP', ['mcp', '<circle cx="4" cy="9" r="1.65"/><circle cx="13.5" cy="4" r="1.65"/><circle cx="13.5" cy="14" r="1.65"/><path d="M5.55 8.15 12 4.75M5.55 9.85 12 13.25M9.2 6.2v5.6"/>']],
      ['Buddy', ['buddy', '<path d="m4.25 6.35-.4-3 2.65 1.4a6.1 6.1 0 0 1 5 0l2.65-1.4-.4 3a5.55 5.55 0 1 1-9.5 0Z"/><path d="M6.5 9.25h.01M11.5 9.25h.01M7.1 12c1.1.75 2.7.75 3.8 0"/>']],
      ['IM', ['im', '<path d="M3 4.25h12v8.25H8l-3.75 2.25.8-2.25H3V4.25Z"/><path d="M6 8.25h.01M9 8.25h.01M12 8.25h.01"/>']],
      ['Agent 预设', ['agent', '<circle cx="9" cy="4" r="1.75"/><circle cx="4" cy="13.5" r="1.75"/><circle cx="14" cy="13.5" r="1.75"/><path d="M9 5.75v3M9 8.75H4v3M9 8.75h5v3"/>']],
      ['Agent presets', ['agent', '<circle cx="9" cy="4" r="1.75"/><circle cx="4" cy="13.5" r="1.75"/><circle cx="14" cy="13.5" r="1.75"/><path d="M9 5.75v3M9 8.75H4v3M9 8.75h5v3"/>']],
      ['其他', ['other', '<path d="M3 5h4M11 5h4M3 9h7M14 9h1M3 13h2M9 13h6"/><circle cx="9" cy="5" r="1.5"/><circle cx="12" cy="9" r="1.5"/><circle cx="7" cy="13" r="1.5"/>']],
      ['Other', ['other', '<path d="M3 5h4M11 5h4M3 9h7M14 9h1M3 13h2M9 13h6"/><circle cx="9" cy="5" r="1.5"/><circle cx="12" cy="9" r="1.5"/><circle cx="7" cy="13" r="1.5"/>']],
    ])
    const installSettingsNavIcon = (element) => {
      const label = element.textContent?.replace(/\s+/g, ' ').trim()
      const icon = settingsNavIcons.get(label)
      if (!icon) return
      if (!element.hasAttribute('data-sandrone-settings-icon')) {
        element.setAttribute('data-sandrone-settings-icon', icon[0])
        markedElements.push([element, 'data-sandrone-settings-icon'])
      }
      if (element.querySelector(':scope > [data-sandrone-settings-nav-icon]')) return
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svg.setAttribute('viewBox', '0 0 18 18')
      svg.setAttribute('fill', 'none')
      svg.setAttribute('stroke', 'currentColor')
      svg.setAttribute('stroke-width', '1.45')
      svg.setAttribute('stroke-linecap', 'round')
      svg.setAttribute('stroke-linejoin', 'round')
      svg.setAttribute('aria-hidden', 'true')
      svg.setAttribute('focusable', 'false')
      svg.setAttribute('data-sandrone-settings-nav-icon', '')
      svg.innerHTML = icon[1]
      const labelElement = [...element.children].find(child => child.tagName === 'SPAN')
      element.insertBefore(svg, labelElement || element.firstChild)
      injectedElements.push(svg)
    }
    const markSettingsDescendants = (panel, nav) => {
      const navList = nav.lastElementChild
      mark(navList, 'data-sandrone-settings-nav-list')
      navList?.querySelectorAll(':scope > button').forEach(element => {
        mark(element, 'data-sandrone-settings-nav-cell')
        installSettingsNavIcon(element)
      })
      const markAll = (selector, attribute) => panel?.querySelectorAll(selector).forEach(element => mark(element, attribute))
      markAll(':is([class$="_section"], [class*="_section "])', 'data-sandrone-settings-section')
      markAll('.sandrone-settings-other', 'data-sandrone-settings-section')
      markAll(':is([class$="_rowCard"], [class*="_rowCard "], [class$="_editor"], [class*="_editor "], [class$="_card"], [class*="_card "])', 'data-sandrone-settings-card')
      markAll(':is([class$="_card"], [class*="_card "])', 'data-sandrone-settings-collection-card')
      markAll(':is([class$="_row"], [class*="_row "])', 'data-sandrone-settings-row')
      panel?.querySelectorAll('[data-sandrone-settings-section]').forEach(section => {
        const children = [...section.children]
        const heading = children.find(element => element.matches(':is([class$="_title"], [class*="_title "], [class$="_heading"], [class*="_heading "])'))
        const description = children.find(element => element.matches(':is([class$="_intro"], [class*="_intro "], [class$="_desc"], [class*="_desc "])'))
        mark(heading, 'data-sandrone-settings-heading')
        mark(description, 'data-sandrone-settings-description')
      })
      markAll(':is([class$="_rowHead"], [class*="_rowHead "], [class$="_editorHeader"], [class*="_editorHeader "], [class$="_modelListHead"], [class*="_modelListHead "], [class$="_modelCatalogHeading"], [class*="_modelCatalogHeading "])', 'data-sandrone-settings-card-header')
      markAll(':is([class$="_field"], [class*="_field "], [class$="_modelField"], [class*="_modelField "])', 'data-sandrone-settings-field')
      markAll(':is([class$="_fieldLabel"], [class*="_fieldLabel "], [class$="_modelFieldLabel"], [class*="_modelFieldLabel "])', 'data-sandrone-settings-field-label')
      markAll(':is([class$="_selector"], [class*="_selector "])', 'data-sandrone-settings-selector')
      markAll('[role="tab"]', 'data-sandrone-settings-tab')
      markAll(':is([class$="_primaryButton"], [class*="_primaryButton "], [class$="_addButton"], [class*="_addButton "])', 'data-sandrone-settings-primary-action')
      markAll(':is([class$="_secondaryButton"], [class*="_secondaryButton "], [class$="_linkButton"], [class*="_linkButton "], [class$="_addModelButton"], [class*="_addModelButton "], [class$="_creatorButton"], [class*="_creatorButton "])', 'data-sandrone-settings-secondary-action')
      markAll(':is([class$="_dangerButton"], [class*="_dangerButton "], [class$="_iconButtonDanger"], [class*="_iconButtonDanger "])', 'data-sandrone-settings-danger-action')
      markAll(':is([class$="_iconButton"], [class*="_iconButton "])', 'data-sandrone-settings-icon-action')
      markAll(':is([class$="_rowTag"], [class*="_rowTag "], [class$="_tag"], [class*="_tag "], [class$="_badge"], [class*="_badge "])', 'data-sandrone-settings-tag')
      markAll(':is([class$="_hint"], [class*="_hint "], [class$="_notice"], [class*="_notice "])', 'data-sandrone-settings-hint')
      markAll(':is([class$="_error"], [class*="_error "])', 'data-sandrone-settings-error')
      markAll(':is([class$="_savedNotice"], [class*="_savedNotice "], [class$="_inUse"], [class*="_inUse "])', 'data-sandrone-settings-status')
      markAll(':is([class$="_credentialDotConfigured"], [class*="_credentialDotConfigured "])', 'data-sandrone-settings-success')
      panel?.querySelectorAll('button[aria-pressed]').forEach(element => {
        mark(element, 'data-sandrone-settings-choice')
        if (element.parentElement?.matches('li')) {
          mark(element.parentElement, 'data-sandrone-settings-choice-card')
          mark(element.parentElement.parentElement, 'data-sandrone-settings-choice-grid')
        }
      })
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
      const settingsTrigger = document.querySelector('[data-sandrone-settings] button[aria-haspopup="dialog"], button[aria-haspopup="dialog"][aria-expanded]')
      const settingsOpen = settingsTrigger?.getAttribute('aria-expanded') === 'true'
      if (container && container.parentNode === nav) {
        markSettingsDescendants(panel, nav)
        panel?.parentElement?.toggleAttribute('data-sandrone-settings-open', settingsOpen)
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
      overlay?.toggleAttribute('data-sandrone-settings-open', settingsOpen)
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
    observer.observe(document.getElementById('root') || document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-expanded'] })
    mount()
    return () => {
      observer.disconnect()
      root?.unmount()
      root = null
      container?.remove()
      container = null
      document.querySelectorAll('[data-sandrone-settings-open]').forEach(element => element.removeAttribute('data-sandrone-settings-open'))
      clearMarkers()
    }
  }, 'sandrone-ui: settings chrome')
}

function escapeMarkdownHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function bytesToBase64(bytes) {
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return btoa(binary)
}

function renderMarkdownHtml(markdown) {
  const lines = String(markdown || '').split(/\r?\n/)
  const html = []
  let inCode = false
  let code = []
  let codeLanguage = ''
  const inline = value => {
    let result = escapeMarkdownHtml(value)
    result = result.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt, target) => `<img class="sandrone-space-image" data-space-resource="${escapeMarkdownHtml(target)}" alt="${alt}" />`)
    result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, target) => `<a href="#" data-space-link="${escapeMarkdownHtml(target)}">${label}</a>`)
    result = result.replace(/`([^`]+)`/g, '<code>$1</code>')
    result = result.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    result = result.replace(/~~([^~]+)~~/g, '<del>$1</del>')
    return result
  }
  const tableCells = line => String(line).trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim())
  const tableDelimiter = line => tableCells(line).length > 0 && tableCells(line).every(cell => /^:?-{3,}:?$/.test(cell))
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (line.trim().startsWith('```')) {
      if (inCode) {
        const language = codeLanguage ? ` class="language-${escapeMarkdownHtml(codeLanguage)}"` : ''
        html.push(`<pre><code${language}>${escapeMarkdownHtml(code.join('\n'))}</code></pre>`)
        code = []
        codeLanguage = ''
      }
      else codeLanguage = line.trim().slice(3).trim().split(/\s+/, 1)[0]
      inCode = !inCode
      continue
    }
    if (inCode) { code.push(line); continue }
    if (index + 1 < lines.length && line.includes('|') && tableDelimiter(lines[index + 1])) {
      const headers = tableCells(line)
      const delimiters = tableCells(lines[index + 1])
      const alignments = delimiters.map(cell => cell.startsWith(':') && cell.endsWith(':') ? 'center' : cell.startsWith(':') ? 'left' : cell.endsWith(':') ? 'right' : '')
      const cell = (tag, value, cellIndex) => `<${tag}${alignments[cellIndex] ? ` style="text-align:${alignments[cellIndex]}"` : ''}>${inline(value)}</${tag}>`
      html.push(`<table><thead><tr>${headers.map((value, cellIndex) => cell('th', value, cellIndex)).join('')}</tr></thead><tbody>`)
      index += 2
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        const values = tableCells(lines[index])
        html.push(`<tr>${headers.map((_value, cellIndex) => cell('td', values[cellIndex] || '', cellIndex)).join('')}</tr>`)
        index += 1
      }
      html.push('</tbody></table>')
      index -= 1
    } else if (/^#{1,6}\s+/.test(line)) {
      const match = line.match(/^(#{1,6})\s+(.*)$/)
      const level = match[1].length
      html.push(`<h${level}>${inline(match[2])}</h${level}>`)
    } else if (/^\s*([-*+])\s+/.test(line)) {
      const value = line.replace(/^\s*[-*+]\s+/, '')
      const task = value.match(/^\[([ xX])\]\s+(.*)$/)
      html.push(`<li${task ? ' class="sandrone-space-task"' : ''}>${task ? `<input type="checkbox" disabled${task[1].toLowerCase() === 'x' ? ' checked' : ''} />${inline(task[2])}` : inline(value)}</li>`)
    } else if (/^\s*\d+[.)]\s+/.test(line)) html.push(`<ol><li>${inline(line.replace(/^\s*\d+[.)]\s+/, ''))}</li></ol>`)
    else if (/^\s*>\s?/.test(line)) html.push(`<blockquote>${inline(line.replace(/^\s*>\s?/, ''))}</blockquote>`)
    else if (/^\s*((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})$/.test(line)) html.push('<hr />')
    else if (!line.trim()) html.push('<div class="sandrone-space-break"></div>')
    else html.push(`<p>${inline(line)}</p>`)
  }
  if (inCode) {
    const language = codeLanguage ? ` class="language-${escapeMarkdownHtml(codeLanguage)}"` : ''
    html.push(`<pre><code${language}>${escapeMarkdownHtml(code.join('\n'))}</code></pre>`)
  }
  return html.join('')
}

function SpaceDocumentPreview({ spaceId, content, onNavigate }) {
  const previewRef = useRef(null)
  useEffect(() => {
    const root = previewRef.current
    if (!root) return undefined
    const links = [...root.querySelectorAll('[data-space-link]')]
    const images = [...root.querySelectorAll('[data-space-resource]')]
    const onClick = event => {
      const link = event.target.closest?.('[data-space-link]')
      if (!link) return
      event.preventDefault()
      const target = String(link.getAttribute('data-space-link') || '').replaceAll('\\', '/')
      if (target.toLowerCase().endsWith('.md')) onNavigate(target.replace(/^\.\//, ''))
    }
    root.addEventListener('click', onClick)
    const api = getSpaceApi()
    const loadImages = async () => {
      for (const image of images) {
        const resource = String(image.getAttribute('data-space-resource') || '')
        if (!resource || !api?.readResource) continue
        const result = await api.readResource(spaceId, resource.replace(/^res\//, ''))
        if (!result?.ok || !image.isConnected) continue
        const extension = resource.toLowerCase().split('.').pop()
        const mime = extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' : extension === 'webp' ? 'image/webp' : extension === 'gif' ? 'image/gif' : 'image/png'
        image.src = `data:${mime};base64,${bytesToBase64(result.bytes)}`
      }
    }
    void loadImages()
    return () => { root.removeEventListener('click', onClick) }
  }, [spaceId, content, onNavigate])
  return <div ref={previewRef} className="sandrone-space-preview" dangerouslySetInnerHTML={{ __html: renderMarkdownHtml(content) }} />
}

function SpaceRegionView({ onClose }) {
  const api = getSpaceApi()
  const [spaces, setSpaces] = useState([])
  const [activeSpaceId, setActiveSpaceId] = useState('')
  const [documents, setDocuments] = useState([])
  const [folders, setFolders] = useState([])
  const [resources, setResources] = useState([])
  const [activePath, setActivePath] = useState('')
  const [content, setContent] = useState('')
  const [mode, setMode] = useState('edit')
  const [dirty, setDirty] = useState(false)
  const [externalChanged, setExternalChanged] = useState(false)
  const [busy, setBusy] = useState(true)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [toolbarHost, setToolbarHost] = useState(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchPopoverPosition, setSearchPopoverPosition] = useState(null)
  const [viewMenuOpen, setViewMenuOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searchBusy, setSearchBusy] = useState(false)
  const [sort, setSort] = useState('name')
  const [createMenuOpen, setCreateMenuOpen] = useState(false)
  const [selectedResource, setSelectedResource] = useState('')
  const [collapsedFolders, setCollapsedFolders] = useState(() => new Set())
  const [collapsedSpaces, setCollapsedSpaces] = useState(() => new Set())
  const [treeOrder, setTreeOrder] = useState({})
  const [draggedTreeItem, setDraggedTreeItem] = useState(null)
  const [editingSpaceId, setEditingSpaceId] = useState('')
  const [editingSpaceValue, setEditingSpaceValue] = useState('')
  const [nameDialog, setNameDialog] = useState(null)
  const [nameDialogBusy, setNameDialogBusy] = useState(false)
  const [confirmDialog, setConfirmDialog] = useState(null)
  const [confirmDialogBusy, setConfirmDialogBusy] = useState(false)
  const [undoDelete, setUndoDelete] = useState(null)
  const lastDocumentRef = useRef({})
  const editorRef = useRef(null)
  const selectionRef = useRef({ start: 0, end: 0 })
  const historyRef = useRef(new Map())
  const contentRef = useRef('')
  const activeSpaceRef = useRef('')
  const activePathRef = useRef('')
  const dirtyRef = useRef(false)
  const updatedAtRef = useRef('')
  const searchAnchorRef = useRef(null)
  const editingSpaceInputRef = useRef(null)

  useEffect(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem('sandrone.space.last-document.v1') || '{}')
      if (stored && typeof stored === 'object') lastDocumentRef.current = stored
    } catch {}
  }, [])

  useEffect(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(SPACE_TREE_ORDER_KEY) || '{}')
      if (stored && typeof stored === 'object') setTreeOrder(stored)
    } catch {}
  }, [])

  contentRef.current = content
  activeSpaceRef.current = activeSpaceId
  activePathRef.current = activePath
  dirtyRef.current = dirty

  const historyKey = (spaceId, path) => `${spaceId}\u0000${path}`
  const historyFor = (spaceId, path, initial = '') => {
    const key = historyKey(spaceId, path)
    let history = historyRef.current.get(key)
    if (!history) {
      history = { past: [], present: initial, future: [] }
      historyRef.current.set(key, history)
    }
    return history
  }

  const applyEditorSnapshot = (snapshot, selection = { start: snapshot.length, end: snapshot.length }) => {
    contentRef.current = snapshot
    setContent(snapshot)
    setDirty(true)
    dirtyRef.current = true
    window.requestAnimationFrame(() => {
      const editor = editorRef.current
      if (!editor) return
      editor.focus()
      const start = Math.min(selection.start, snapshot.length)
      const end = Math.min(selection.end, snapshot.length)
      editor.setSelectionRange(start, end)
      selectionRef.current = { start, end }
    })
  }

  const undoEditorChange = () => {
    if (!activeSpaceId || !activePath) return false
    const history = historyFor(activeSpaceId, activePath, content)
    const previous = history.past.pop()
    if (!previous) return false
    history.future.push({ content: history.present, selection: selectionRef.current })
    history.present = previous.content
    applyEditorSnapshot(previous.content, previous.selection)
    return true
  }

  const redoEditorChange = () => {
    if (!activeSpaceId || !activePath) return false
    const history = historyFor(activeSpaceId, activePath, content)
    const next = history.future.pop()
    if (!next) return false
    history.past.push({ content: history.present, selection: selectionRef.current })
    history.present = next.content
    applyEditorSnapshot(next.content, next.selection)
    return true
  }

  const saveDocumentValue = async (spaceId, path, value, announce = true) => {
    if (!spaceId || !path || !api?.writeMarkdown) return false
    try {
      const saved = await api.writeMarkdown(spaceId, path, value)
      if (spaceId === activeSpaceRef.current && path === activePathRef.current && value === contentRef.current) {
        setDirty(false)
        dirtyRef.current = false
        updatedAtRef.current = String(saved?.updatedAt || '')
        setExternalChanged(false)
        if (announce) setStatus('已保存')
      }
      return true
    } catch (cause) {
      setError(cause?.message || '保存失败')
      return false
    }
  }

  const flushCurrentDocument = async () => {
    if (!dirtyRef.current) return true
    return saveDocumentValue(activeSpaceRef.current, activePathRef.current, contentRef.current)
  }

  useEffect(() => {
    const onFlushRequest = event => {
      const resolve = event.detail?.resolve
      if (typeof resolve !== 'function') return
      void flushCurrentDocument().then(resolve)
    }
    window.addEventListener('sandrone-space-flush', onFlushRequest)
    return () => window.removeEventListener('sandrone-space-flush', onFlushRequest)
  }, [dirty, activeSpaceId, activePath, content])

  const selectSpace = async id => {
    if (id === activeSpaceId) return
    if (!(await flushCurrentDocument())) return
    setActiveSpaceId(id)
    setActivePath('')
  }

  const selectDocument = async path => {
    if (path === activePath) return
    if (!(await flushCurrentDocument())) return
    setActivePath(path)
  }

  useEffect(() => {
    const locate = () => setToolbarHost(current => {
      const next = document.querySelector('[data-sandrone-region-host]')
      return current === next ? current : next
    })
    locate()
    const observer = new MutationObserver(locate)
    observer.observe(document.getElementById('root') || document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!searchOpen && !viewMenuOpen && !createMenuOpen) return undefined
    const close = event => {
      if (event.target.closest?.('[data-sandrone-space-actions], [data-sandrone-space-create-menu]')) return
      setSearchOpen(false)
      setViewMenuOpen(false)
      setCreateMenuOpen(false)
    }
    const onKeyDown = event => {
      if (event.key !== 'Escape') return
      setSearchOpen(false)
      setViewMenuOpen(false)
      setCreateMenuOpen(false)
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [searchOpen, viewMenuOpen, createMenuOpen])

  useEffect(() => {
    if (selectedResource && !resources.some(resource => resource.path === selectedResource)) setSelectedResource('')
  }, [resources, selectedResource])

  useEffect(() => {
    if (!searchOpen || !filter.trim() || !api?.search) {
      setSearchResults([])
      setSearchBusy(false)
      return undefined
    }
    let alive = true
    const timer = window.setTimeout(() => {
      setSearchBusy(true)
      void api.search(filter.trim()).then(next => {
        if (alive) setSearchResults(Array.isArray(next) ? next : [])
      }).catch(cause => {
        if (alive) setError(cause?.message || '搜索失败')
      }).finally(() => { if (alive) setSearchBusy(false) })
    }, 180)
    return () => { alive = false; window.clearTimeout(timer) }
  }, [api, filter, searchOpen])

  useEffect(() => {
    if (!searchOpen) {
      setSearchPopoverPosition(null)
      return undefined
    }
    const update = () => {
      const anchor = searchAnchorRef.current
      if (!anchor) return
      const rect = anchor.getBoundingClientRect()
      const width = Math.min(252, Math.max(180, window.innerWidth - 16))
      const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))
      setSearchPopoverPosition({ left: Math.round(left), top: Math.round(rect.bottom + 6) })
    }
    update()
    window.addEventListener('resize', update, { passive: true })
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [searchOpen])

  useEffect(() => {
    if (editingSpaceId) editingSpaceInputRef.current?.focus()
  }, [editingSpaceId])

  useEffect(() => {
    const root = document.documentElement
    const open = Boolean(nameDialog || confirmDialog)
    if (open) root.setAttribute('data-sandrone-space-dialog-open', 'true')
    else root.removeAttribute('data-sandrone-space-dialog-open')
    return () => root.removeAttribute('data-sandrone-space-dialog-open')
  }, [nameDialog, confirmDialog])

  const loadSpaces = async (preferredId = '') => {
    if (!api?.list) return
    setBusy(true)
    try {
      const next = await api.list()
      setSpaces(Array.isArray(next) ? next : [])
      const nextId = preferredId || activeSpaceId || next?.[0]?.id || ''
      setActiveSpaceId(next.some(item => item.id === nextId) ? nextId : (next[0]?.id || ''))
      setError('')
    } catch (cause) {
      setError(cause?.message || '读取空间失败')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => { void loadSpaces() }, [])

  useEffect(() => {
    if (!activeSpaceId || !api?.documents) {
      setDocuments([])
      setFolders([])
      setResources([])
      setActivePath('')
      return
    }
    let alive = true
    setBusy(true)
    const load = async () => {
      const [documentResult, resourceResult, folderResult] = await Promise.all([
        api.documents(activeSpaceId),
        api.resources ? api.resources(activeSpaceId) : [],
        api.folders ? api.folders(activeSpaceId) : [],
      ])
      if (!alive) return
      const next = Array.isArray(documentResult) ? documentResult : []
      const resourceList = Array.isArray(resourceResult) ? resourceResult : []
      const folderList = Array.isArray(folderResult) ? folderResult : []
      setResources(resourceList)
      setFolders(folderList)
      const remembered = lastDocumentRef.current[activeSpaceId]
      setDocuments(next)
      setActivePath(current => next.includes(current) ? current : (remembered && next.includes(remembered) ? remembered : (next[0] || '')))
    }
    void load().catch(cause => {
      if (!alive) return
      setError(cause?.message || '读取空间内容失败')
    }).finally(() => alive && setBusy(false))
    return () => { alive = false }
  }, [activeSpaceId])

  useEffect(() => {
    if (!activeSpaceId || !activePath || !api?.readMarkdown) {
      setContent('')
      setDirty(false)
      return
    }
    let alive = true
    setBusy(true)
    void api.readMarkdown(activeSpaceId, activePath).then(result => {
      if (!alive) return
      const nextContent = String(result?.content || '')
      const history = historyFor(activeSpaceId, activePath, nextContent)
      if (history.present !== nextContent && !dirtyRef.current) {
        history.past = []
        history.future = []
        history.present = nextContent
      }
      contentRef.current = nextContent
      setContent(nextContent)
      setDirty(false)
      dirtyRef.current = false
      updatedAtRef.current = String(result?.updatedAt || '')
      setExternalChanged(false)
      setStatus('')
      setError('')
      lastDocumentRef.current[activeSpaceId] = activePath
      try { window.localStorage.setItem('sandrone.space.last-document.v1', JSON.stringify(lastDocumentRef.current)) } catch {}
    }).catch(cause => alive && setError(cause?.message || '读取 Markdown 失败')).finally(() => alive && setBusy(false))
    return () => { alive = false }
  }, [activeSpaceId, activePath])

  useEffect(() => {
    if (!activeSpaceId || !activePath || dirty || !api?.readMarkdown || !updatedAtRef.current) return undefined
    let alive = true
    const check = async () => {
      try {
        const result = await api.readMarkdown(activeSpaceId, activePath)
        const updatedAt = String(result?.updatedAt || '')
        if (alive && updatedAt && updatedAtRef.current && updatedAt !== updatedAtRef.current) setExternalChanged(true)
      } catch {}
    }
    const timer = window.setInterval(() => { void check() }, 4000)
    return () => { alive = false; window.clearInterval(timer) }
  }, [activeSpaceId, activePath, dirty])

  useEffect(() => {
    if (!dirty || !activeSpaceId || !activePath || !api?.writeMarkdown) return undefined
    const savedSpace = activeSpaceId
    const savedPath = activePath
    const timer = window.setTimeout(() => {
      void api.writeMarkdown(savedSpace, savedPath, content).then(result => {
        if (savedSpace === activeSpaceId && savedPath === activePath) {
          setDirty(false)
          dirtyRef.current = false
          updatedAtRef.current = String(result?.updatedAt || updatedAtRef.current)
          setExternalChanged(false)
          setStatus('已自动保存')
        }
      }).catch(cause => setError(cause?.message || '保存失败'))
    }, 900)
    return () => window.clearTimeout(timer)
  }, [content, dirty, activeSpaceId, activePath])

  const createSpaceNamed = async name => {
    if (!name || !api?.create) return false
    try {
      const created = await api.create(name)
      await loadSpaces(created.id)
      setStatus('空间已创建')
      return true
    } catch (cause) { setError(cause?.message || '创建空间失败'); return false }
  }

  const createSpaceAction = () => {
    setSearchOpen(false)
    setViewMenuOpen(false)
    setCreateMenuOpen(false)
    setFilter('')
    setNameDialog({ kind: 'space', value: '我的空间' })
  }

  const renameSpace = space => {
    if (!space?.id) return
    setNameDialog(null)
    setEditingSpaceId(space.id)
    setEditingSpaceValue(space.name)
  }

  const commitInlineSpaceRename = async (space, nextName = editingSpaceValue) => {
    if (!space?.id || editingSpaceId !== space.id) return
    const value = String(nextName || '').trim()
    if (!value) {
      setEditingSpaceId('')
      setEditingSpaceValue('')
      return
    }
    const renamed = await renameSpaceNamed(space.id, value)
    if (renamed) {
      setEditingSpaceId('')
      setEditingSpaceValue('')
    }
  }

  const renameSpaceNamed = async (id, name) => {
    if (!id || !api?.rename) return false
    try {
      await api.rename(id, name)
      setSpaces(current => current.map(space => space.id === id ? { ...space, name } : space))
      setStatus('空间已重命名')
      return true
    } catch (cause) { setError(cause?.message || '重命名空间失败'); return false }
  }

  const removeSpace = async (space = spaces.find(item => item.id === activeSpaceId)) => {
    if (!(await flushCurrentDocument())) return
    if (!space || !api?.remove) return
    setConfirmDialog({ kind: 'space', spaceId: space.id, title: '删除空间？', message: `删除空间“${space.name}”？此操作会删除其中的 Markdown 和资源。` })
  }

  const removeSpaceNow = async () => {
    try {
      await api.remove(confirmDialog?.spaceId || activeSpaceId)
      await loadSpaces()
      setUndoDelete(null)
      setStatus('空间已删除')
    } catch (cause) { setError(cause?.message || '删除空间失败') }
  }

  const createDocumentNamed = async name => {
    if (!activeSpaceId || !api?.createMarkdown) return false
    if (!(await flushCurrentDocument())) return false
    const file = name.toLowerCase().endsWith('.md') ? name : `${name}.md`
    try {
      await api.createMarkdown(activeSpaceId, file)
      const next = await api.documents(activeSpaceId)
      setDocuments(next)
      lastDocumentRef.current[activeSpaceId] = file.replaceAll('\\', '/')
      setActivePath(file.replaceAll('\\', '/'))
      return true
    } catch (cause) { setError(cause?.message || '创建文档失败'); return false }
  }

  const createDocument = () => {
    setNameDialog({ kind: 'document', value: '新文档.md' })
  }

  const createDocumentInFolder = folder => {
    setNameDialog({ kind: 'document', value: `${folder}/新文档.md` })
  }

  const createFolder = () => {
    setNameDialog({ kind: 'folder', value: '新文件夹' })
  }

  const createFolderNamed = async name => {
    if (!activeSpaceId || !api?.createDirectory) return false
    try {
      const result = await api.createDirectory(activeSpaceId, name.replaceAll('\\', '/').replace(/^\/+|\/+$/g, ''))
      const next = api.folders ? await api.folders(activeSpaceId) : [...folders, result.path]
      setFolders(next)
      setStatus(`文件夹已创建：${result.path}`)
      return true
    } catch (cause) { setError(cause?.message || '创建文件夹失败'); return false }
  }

  const renameDocument = () => {
    if (activePath) setNameDialog({ kind: 'rename-document', value: activePath })
  }

  const renameDocumentNamed = async name => {
    if (!activeSpaceId || !activePath || !api?.renameMarkdown) return false
    if (!(await flushCurrentDocument())) return false
    const file = name.toLowerCase().endsWith('.md') ? name : `${name}.md`
    try {
      const result = await api.renameMarkdown(activeSpaceId, activePath, file)
      const next = await api.documents(activeSpaceId)
      const nextPath = result?.path || file.replaceAll('\\', '/')
      setDocuments(next)
      setActivePath(nextPath)
      lastDocumentRef.current[activeSpaceId] = nextPath
      return true
    } catch (cause) { setError(cause?.message || '重命名文档失败'); return false }
  }

  const renameResource = resourcePath => {
    if (resourcePath) setNameDialog({ kind: 'rename-resource', resourcePath, value: resourcePath })
  }

  const renameResourceNamed = async (resourcePath, name) => {
    if (!activeSpaceId || !api?.renameResource) return false
    if (!(await flushCurrentDocument())) return false
    const nextPath = name.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '')
    if (!nextPath) return false
    try {
      const result = await api.renameResource(activeSpaceId, resourcePath, nextPath)
      setResources(current => current.map(resource => resource.path === resourcePath ? { ...resource, path: result.path } : resource))
      if (selectedResource === resourcePath) setSelectedResource(result.path)
      if (activePath && api.readMarkdown) {
        const refreshed = await api.readMarkdown(activeSpaceId, activePath)
        const nextContent = String(refreshed?.content || '')
        const history = historyFor(activeSpaceId, activePath, nextContent)
        history.past = []
        history.future = []
        history.present = nextContent
        contentRef.current = nextContent
        setContent(nextContent)
        setDirty(false)
        dirtyRef.current = false
      }
      setStatus('资源已重命名')
      return true
    } catch (cause) { setError(cause?.message || '重命名资源失败'); return false }
  }

  const removeResource = resourcePath => {
    if (!resourcePath || !api?.deleteResource) return
    setConfirmDialog({ kind: 'resource', resourcePath, title: '删除资源？', message: `删除资源“${resourcePath}”？Markdown 中已有的引用不会自动移除。` })
  }

  const removeResourceNow = async resourcePath => {
    try {
      await api.deleteResource(activeSpaceId, resourcePath)
      setResources(current => current.filter(resource => resource.path !== resourcePath))
      if (selectedResource === resourcePath) setSelectedResource('')
      setStatus('资源已删除')
    } catch (cause) { setError(cause?.message || '删除资源失败') }
  }

  const submitNameDialog = async event => {
    event.preventDefault()
    const value = nameDialog?.value.trim()
    if (!value || nameDialogBusy) return
    setNameDialogBusy(true)
    const created = nameDialog.kind === 'space'
      ? await createSpaceNamed(value)
      : nameDialog.kind === 'rename-space' ? await renameSpaceNamed(nameDialog.spaceId, value)
        : nameDialog.kind === 'folder' ? await createFolderNamed(value)
          : nameDialog.kind === 'rename-resource' ? await renameResourceNamed(nameDialog.resourcePath, value)
            : nameDialog.kind === 'rename-document' ? await renameDocumentNamed(value) : await createDocumentNamed(value)
    setNameDialogBusy(false)
    if (created) setNameDialog(null)
  }

  const removeDocument = async () => {
    if (!activeSpaceId || !activePath || !api?.removeMarkdown) return
    if (!(await flushCurrentDocument())) return
    setConfirmDialog({ kind: 'document', title: '删除 Markdown？', message: `删除“${activePath}”？` })
  }

  const removeDocumentNow = async () => {
    try {
      const removedSpaceId = activeSpaceId
      const removedPath = activePath
      const result = await api.removeMarkdown(activeSpaceId, activePath)
      const next = await api.documents(activeSpaceId)
      setDocuments(next)
      setActivePath(next[0] || '')
      if (result?.trashId) setUndoDelete({ spaceId: removedSpaceId, path: removedPath, trashId: result.trashId })
      setStatus('已删除，可撤销')
    } catch (cause) { setError(cause?.message || '删除文档失败') }
  }

  const restoreDeletedDocument = async () => {
    if (!undoDelete || !api?.restoreMarkdown) return
    try {
      await api.restoreMarkdown(undoDelete.spaceId, undoDelete.path, undoDelete.trashId)
      const next = await api.documents(undoDelete.spaceId)
      setDocuments(next)
      setActiveSpaceId(undoDelete.spaceId)
      setActivePath(undoDelete.path)
      setUndoDelete(null)
      setStatus('已恢复文档')
    } catch (cause) { setError(cause?.message || '恢复文档失败') }
  }

  const submitConfirmDialog = async () => {
    if (!confirmDialog || confirmDialogBusy) return
    setConfirmDialogBusy(true)
    if (confirmDialog.kind === 'space') await removeSpaceNow()
    else if (confirmDialog.kind === 'resource') await removeResourceNow(confirmDialog.resourcePath)
    else await removeDocumentNow()
    setConfirmDialogBusy(false)
    setConfirmDialog(null)
  }

  const saveDocument = async () => {
    if (!activeSpaceId || !activePath || !api?.writeMarkdown) return
    await saveDocumentValue(activeSpaceId, activePath, content)
  }

  const reloadExternalDocument = async () => {
    if (!activeSpaceId || !activePath || dirty || !api?.readMarkdown) return
    try {
      const result = await api.readMarkdown(activeSpaceId, activePath)
      const nextContent = String(result?.content || '')
      const history = historyFor(activeSpaceId, activePath, nextContent)
      history.past = []
      history.future = []
      history.present = nextContent
      contentRef.current = nextContent
      setContent(nextContent)
      setDirty(false)
      dirtyRef.current = false
      updatedAtRef.current = String(result?.updatedAt || '')
      setExternalChanged(false)
      setStatus('已载入外部更新')
    } catch (cause) { setError(cause?.message || '载入外部更新失败') }
  }

  const importResource = async () => {
    if (!activeSpaceId || !api?.importResource) return
    try {
      const result = await api.importResource(activeSpaceId)
      if (!result?.path) return
      setResources(current => current.some(item => item.path === result.path) ? current : [...current, result])
      insertResourceReference(result.path)
      setStatus(`已导入 ${result.path}`)
    } catch (cause) { setError(cause?.message || '导入资源失败') }
  }

  const insertResourceReference = resourcePath => {
    const source = contentRef.current
    const editor = editorRef.current
    const focused = editor && document.activeElement === editor
    const start = focused ? selectionRef.current.start : source.length
    const end = focused ? selectionRef.current.end : source.length
    const left = source.slice(0, start)
    const leadingBreak = left.length > 0 && !/\s$/.test(left) ? '\n' : ''
    const reference = `${leadingBreak}![${resourcePath}](res/${resourcePath})\n`
    const nextContent = `${left}${reference}${source.slice(end)}`
    const nextCursor = left.length + reference.length
    const history = historyFor(activeSpaceId, activePath, contentRef.current)
    history.past.push({ content: history.present, selection: selectionRef.current })
    history.future = []
    history.present = nextContent
    contentRef.current = nextContent
    setContent(nextContent)
    setDirty(true)
    dirtyRef.current = true
    selectionRef.current = { start: nextCursor, end: nextCursor }
    window.requestAnimationFrame(() => {
      if (!editorRef.current) return
      editorRef.current.focus()
      editorRef.current.setSelectionRange(nextCursor, nextCursor)
    })
  }

  const commitEditorSnapshot = (nextContent, nextSelection) => {
    const history = historyFor(activeSpaceId, activePath, contentRef.current)
    history.past.push({ content: history.present, selection: selectionRef.current })
    history.future = []
    if (history.past.length > 200) history.past.shift()
    history.present = nextContent
    applyEditorSnapshot(nextContent, nextSelection)
    selectionRef.current = nextSelection
  }

  const handleEditorIndent = event => {
    const editor = event.currentTarget
    const start = editor.selectionStart
    const end = editor.selectionEnd
    const selected = content.slice(start, end)
    if (event.shiftKey) {
      const lineStart = content.lastIndexOf('\n', Math.max(0, start - 1)) + 1
      const line = content.slice(lineStart)
      const removed = line.startsWith('  ') ? 2 : line.startsWith(' ') ? 1 : 0
      if (!removed) return
      const next = `${content.slice(0, lineStart)}${content.slice(lineStart + removed)}`
      commitEditorSnapshot(next, { start: Math.max(lineStart, start - removed), end: Math.max(lineStart, end - removed) })
      return
    }
    const prefix = selected.includes('\n') ? selected.replace(/^/gm, '  ') : '  '
    const next = `${content.slice(0, start)}${prefix}${content.slice(end)}`
    commitEditorSnapshot(next, { start: start + 2, end: end + (selected.includes('\n') ? prefix.length : 2) })
  }

  const handleEditorEnter = event => {
    const editor = event.currentTarget
    if (editor.selectionStart !== editor.selectionEnd) return
    const cursor = editor.selectionStart
    const lineStart = content.lastIndexOf('\n', Math.max(0, cursor - 1)) + 1
    const line = content.slice(lineStart, cursor)
    const match = line.match(/^(\s*)([-+*]|\d+[.)]|>)(\s+)(.*)$/)
    if (!match) return
    event.preventDefault()
    const [, indent, marker, gap, body] = match
    if (!body.trim()) {
      const next = `${content.slice(0, lineStart)}${indent}${content.slice(cursor)}`
      commitEditorSnapshot(next, { start: lineStart + indent.length, end: lineStart + indent.length })
      return
    }
    const nextMarker = /^\d/.test(marker) ? `${Number.parseInt(marker, 10) + 1}.` : marker
    const taskPrefix = /^\[[ xX]\]\s+/.test(body) ? '[ ] ' : ''
    const continuation = `\n${indent}${nextMarker}${gap}${taskPrefix}`
    const next = `${content.slice(0, cursor)}${continuation}${content.slice(cursor)}`
    const nextCursor = cursor + continuation.length
    commitEditorSnapshot(next, { start: nextCursor, end: nextCursor })
  }

  const selectSearchResult = async result => {
    if (!result?.spaceId || !result.path) return
    if (!(await flushCurrentDocument())) return
    setActiveSpaceId(result.spaceId)
    lastDocumentRef.current[result.spaceId] = result.path
    setActivePath(result.path)
    setSearchOpen(false)
    setFilter('')
  }

  const importResourceFile = async file => {
    if (!activeSpaceId || !file || !api?.importResourceFile) return false
    if (!String(file.type || '').startsWith('image/')) {
      setError('空间区目前只接受图片资源')
      return false
    }
    try {
      const result = await api.importResourceFile(activeSpaceId, file)
      if (!result?.path) return false
      setResources(current => current.some(item => item.path === result.path) ? current : [...current, result])
      insertResourceReference(result.path)
      setStatus(`已导入 ${result.path}`)
      return true
    } catch (cause) {
      setError(cause?.message || '导入资源失败')
      return false
    }
  }

  const handleEditorDrop = event => {
    event.preventDefault()
    const files = [...(event.dataTransfer?.files || [])]
    void files.reduce((chain, file) => chain.then(() => importResourceFile(file)), Promise.resolve())
  }

  const handleEditorPaste = event => {
    const files = [...(event.clipboardData?.files || [])].filter(file => String(file.type || '').startsWith('image/'))
    if (files.length === 0) return
    event.preventDefault()
    void files.reduce((chain, file) => chain.then(() => importResourceFile(file)), Promise.resolve())
  }

  const normalizedFilter = filter.trim().toLocaleLowerCase()
  const orderedSpaces = [...spaces].sort((left, right) => {
    if (sort === 'updated') return String(right.updatedAt || right.createdAt || '').localeCompare(String(left.updatedAt || left.createdAt || '')) || left.name.localeCompare(right.name)
    return left.name.localeCompare(right.name)
  })
  const visibleSpaces = normalizedFilter
    ? orderedSpaces.filter(space => space.name.toLocaleLowerCase().includes(normalizedFilter) || (space.id === activeSpaceId && documents.some(file => file.toLocaleLowerCase().includes(normalizedFilter))))
    : orderedSpaces

  const folderParents = path => {
    const index = path.lastIndexOf('/')
    return index < 0 ? '' : path.slice(0, index)
  }
  const treeEntriesFor = parent => {
    const folderEntries = folders
      .filter(folder => folderParents(folder) === parent)
      .map(path => ({ type: 'folder', path, key: `folder:${path}` }))
    const documentEntries = documents
      .filter(file => folderParents(file) === parent)
      .map(path => ({ type: 'document', path, key: `document:${path}` }))
    const entries = [...folderEntries, ...documentEntries]
    const order = treeOrder[activeSpaceId]?.[parent] || []
    return entries.sort((left, right) => {
      const leftIndex = order.indexOf(left.key)
      const rightIndex = order.indexOf(right.key)
      if (leftIndex >= 0 || rightIndex >= 0) return (leftIndex < 0 ? entries.length : leftIndex) - (rightIndex < 0 ? entries.length : rightIndex)
      return left.path.localeCompare(right.path)
    })
  }
  const persistTreeOrder = (parent, entries) => {
    setTreeOrder(current => {
      const next = { ...current, [activeSpaceId]: { ...(current[activeSpaceId] || {}), [parent]: entries.map(entry => entry.key) } }
      try { window.localStorage.setItem(SPACE_TREE_ORDER_KEY, JSON.stringify(next)) } catch {}
      return next
    })
  }
  const moveTreeEntry = (parent, sourceKey, targetKey) => {
    const entries = treeEntriesFor(parent)
    const sourceIndex = entries.findIndex(entry => entry.key === sourceKey)
    const targetIndex = entries.findIndex(entry => entry.key === targetKey)
    if (sourceIndex < 0 || targetIndex < 0 || sourceKey === targetKey) return
    const [source] = entries.splice(sourceIndex, 1)
    entries.splice(entries.findIndex(entry => entry.key === targetKey), 0, source)
    persistTreeOrder(parent, entries)
  }

  const moveDocumentToFolder = async (documentPath, folderPath) => {
    if (!activeSpaceId || !api?.renameMarkdown) return
    const fileName = documentPath.split('/').pop()
    const nextPath = folderPath ? `${folderPath}/${fileName}` : fileName
    if (nextPath === documentPath) return
    if (!(await flushCurrentDocument())) return
    try {
      const result = await api.renameMarkdown(activeSpaceId, documentPath, nextPath)
      const nextDocuments = await api.documents(activeSpaceId)
      setDocuments(nextDocuments)
      const resolvedPath = result?.path || nextPath
      if (activePath === documentPath) setActivePath(resolvedPath)
      setStatus(`已移动到 ${folderPath}`)
    } catch (cause) { setError(cause?.message || '移动文档失败') }
  }

  const handleTreeDrop = (event, parent, target) => {
    event.preventDefault()
    const source = draggedTreeItem
    setDraggedTreeItem(null)
    if (!source || (target && source.key === target.key)) return
    if (!target && source.type === 'document') {
      void moveDocumentToFolder(source.path, parent)
      return
    }
    if (target?.type === 'folder' && source.type === 'document') {
      void moveDocumentToFolder(source.path, target.path)
      return
    }
    if (source.parent === parent) moveTreeEntry(parent, source.key, target.key)
  }

  const renderTreeEntries = (parent = '', depth = 0) => treeEntriesFor(parent).map(entry => {
    const name = entry.path.split('/').pop() || entry.path
    const indent = { paddingLeft: `${8 + depth * 16}px` }
    if (entry.type === 'folder') {
      const collapsed = collapsedFolders.has(entry.path)
      return <React.Fragment key={entry.key}>
        <button type="button" draggable className="sandrone-space-folder-row" style={indent} onClick={() => setCollapsedFolders(current => { const next = new Set(current); if (next.has(entry.path)) next.delete(entry.path); else next.add(entry.path); return next })} onDragStart={() => setDraggedTreeItem({ ...entry, parent })} onDragEnd={() => setDraggedTreeItem(null)} onDragOver={event => event.preventDefault()} onDrop={event => handleTreeDrop(event, parent, entry)} title="点击折叠或展开；拖入文档可移动到此文件夹"><span className="sandrone-space-tree-caret" aria-hidden="true">{collapsed ? '▸' : '▾'}</span><svg viewBox="0 0 18 18" aria-hidden="true"><path d="M2.5 5.5h4l1.45 1.6h7.55v6.9h-13Z" /></svg><span>{name}</span></button>
        {!collapsed ? renderTreeEntries(entry.path, depth + 1) : null}
      </React.Fragment>
    }
    const file = entry.path
    return <button type="button" draggable key={entry.key} style={indent} className={`sandrone-space-document-row${file === activePath ? ' is-active' : ''}`} onClick={() => void selectDocument(file)} onDragStart={() => setDraggedTreeItem({ ...entry, parent })} onDragEnd={() => setDraggedTreeItem(null)} onDragOver={event => event.preventDefault()} onDrop={event => handleTreeDrop(event, parent, entry)}><svg viewBox="0 0 18 18" aria-hidden="true"><path d="M4 2.75h6.6L14 6.1v9.15H4Z" /><path d="M10.5 2.75V6.2H14" /></svg><span>{name}</span></button>
  })

  const editorHistory = activeSpaceId && activePath ? historyFor(activeSpaceId, activePath, content) : null
  const editorValue = <textarea
    ref={editorRef}
    className="sandrone-space-textarea"
    value={content}
    onChange={event => {
      const nextContent = event.target.value
      const history = historyFor(activeSpaceId, activePath, content)
      if (history.present !== nextContent) {
        history.past.push({ content: history.present, selection: selectionRef.current })
        history.future = []
        if (history.past.length > 200) history.past.shift()
        history.present = nextContent
      }
      selectionRef.current = { start: event.target.selectionStart, end: event.target.selectionEnd }
      contentRef.current = nextContent
      setContent(nextContent)
      setDirty(true)
      dirtyRef.current = true
    }}
    onSelect={event => { selectionRef.current = { start: event.target.selectionStart, end: event.target.selectionEnd } }}
    onDragOver={event => event.preventDefault()}
    onDrop={handleEditorDrop}
    onPaste={handleEditorPaste}
    onKeyDown={event => {
      const modifier = event.ctrlKey || event.metaKey
      const key = event.key.toLowerCase()
      if (modifier && key === 'z') {
        event.preventDefault()
        if (event.shiftKey) redoEditorChange()
        else undoEditorChange()
        return
      }
      if (modifier && key === 'y') {
        event.preventDefault()
        redoEditorChange()
        return
      }
      if (modifier && key === 's') {
        event.preventDefault()
        void saveDocument()
        return
      }
      if (event.key === 'Tab') {
        event.preventDefault()
        handleEditorIndent(event)
        return
      }
      if (event.key === 'Enter') {
        handleEditorEnter(event)
      }
    }}
    spellCheck="false"
    aria-label={`编辑 ${activePath || 'Markdown'}`}
  />
  const editorPreview = <SpaceDocumentPreview spaceId={activeSpaceId} content={content} onNavigate={path => { if (documents.includes(path)) void selectDocument(path); else setError(`找不到文档：${path}`) }} />

  return <section className="sandrone-space-region" aria-label="空间区">
    {toolbarHost ? createPortal(<div className="sandrone-space-native-actions" data-sandrone-space-actions>
      <div ref={searchAnchorRef} className="sandrone-space-native-action-anchor">
        <button type="button" aria-label="搜索空间和 Markdown" title="搜索空间和 Markdown" aria-expanded={searchOpen} onClick={() => { setSearchOpen(value => !value); setViewMenuOpen(false) }}><svg viewBox="0 0 18 18" aria-hidden="true"><circle cx="7.7" cy="7.7" r="4.55" /><path d="m11.2 11.2 3.7 3.7" /></svg></button>
        {searchOpen ? <div className="sandrone-space-native-popover sandrone-space-search-popover" style={searchPopoverPosition || undefined}><input type="search" value={filter} onChange={event => setFilter(event.target.value)} placeholder="搜索空间或 Markdown" autoFocus />{filter.trim() ? <div className="sandrone-space-search-results" role="listbox">{searchBusy ? <div className="sandrone-space-search-status">搜索中…</div> : null}{!searchBusy && searchResults.length === 0 ? <div className="sandrone-space-search-status">没有匹配的文档</div> : null}{searchResults.map(result => <button type="button" key={`${result.spaceId}:${result.path}`} onClick={() => void selectSearchResult(result)}><strong>{result.path}</strong><small>{result.spaceName} · {result.snippet}</small></button>)}</div> : <span>{visibleSpaces.length}/{spaces.length} 个空间</span>}</div> : null}
      </div>
      <div className="sandrone-space-native-action-anchor">
        <button type="button" aria-label="空间视图选项" title="空间视图选项" aria-expanded={viewMenuOpen} onClick={() => { setViewMenuOpen(value => !value); setSearchOpen(false) }}><svg viewBox="0 0 18 18" aria-hidden="true"><path d="M3 4.5h12M3 9h12M3 13.5h12" /><circle cx="6" cy="4.5" r="1" /><circle cx="11" cy="9" r="1" /><circle cx="8" cy="13.5" r="1" /></svg></button>
        {viewMenuOpen ? <div className="sandrone-space-native-popover sandrone-space-view-popover" role="menu" aria-label="空间排序"><div className="sandrone-space-native-popover-label">空间排序</div><button type="button" className={sort === 'name' ? 'is-active' : ''} role="menuitemradio" aria-checked={sort === 'name'} onClick={() => { setSort('name'); setViewMenuOpen(false) }}>按名称</button><button type="button" className={sort === 'updated' ? 'is-active' : ''} role="menuitemradio" aria-checked={sort === 'updated'} onClick={() => { setSort('updated'); setViewMenuOpen(false) }}>最近更新</button></div> : null}
      </div>
      <button type="button" aria-label="新建空间" title="新建空间" onClick={() => { setSearchOpen(false); setViewMenuOpen(false); void createSpaceAction() }}><svg viewBox="0 0 18 18" aria-hidden="true"><rect x="3" y="3" width="12" height="12" rx="2" /><path d="M9 6v6M6 9h6" /></svg></button>
    </div>, toolbarHost) : null}
    <aside className="sandrone-space-sidebar">
      <div className="sandrone-space-sidebar-content">
        {visibleSpaces.map(space => <div className="sandrone-space-tree-group" key={space.id}>
          <div className={`sandrone-space-tree-row-wrap${space.id === editingSpaceId ? ' is-editing' : ''}`}>{space.id === editingSpaceId ? <input ref={editingSpaceInputRef} className="sandrone-space-inline-input" value={editingSpaceValue} aria-label={`重命名空间 ${space.name}`} onChange={event => setEditingSpaceValue(event.target.value)} onClick={event => event.stopPropagation()} onBlur={() => void commitInlineSpaceRename(space)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void commitInlineSpaceRename(space) } if (event.key === 'Escape') { setEditingSpaceId(''); setEditingSpaceValue('') } }} /> : <div role="button" tabIndex={0} className={`sandrone-space-tree-row${space.id === activeSpaceId ? ' is-active' : ''}`} aria-expanded={space.id === activeSpaceId ? !collapsedSpaces.has(space.id) : false} onClick={() => { void selectSpace(space.id); setCollapsedSpaces(current => { const next = new Set(current); next.delete(space.id); return next }) }} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void selectSpace(space.id) } }} onDragOver={event => event.preventDefault()} onDrop={event => handleTreeDrop(event, '', null)}><button type="button" className="sandrone-space-tree-caret" aria-label={`${collapsedSpaces.has(space.id) ? '展开' : '收起'}空间 ${space.name}`} aria-expanded={space.id === activeSpaceId ? !collapsedSpaces.has(space.id) : false} onClick={event => { event.stopPropagation(); setCollapsedSpaces(current => { const next = new Set(current); if (next.has(space.id)) next.delete(space.id); else next.add(space.id); return next }) }}>{space.id === activeSpaceId && !collapsedSpaces.has(space.id) ? '▾' : '▸'}</button><span className="sandrone-space-name" onDoubleClick={event => { event.preventDefault(); event.stopPropagation(); renameSpace(space) }}>{space.name}</span></div>}<button type="button" className="sandrone-space-tree-delete" aria-label={`删除空间 ${space.name}`} title="删除空间" onClick={() => void removeSpace(space)}><svg viewBox="0 0 18 18" aria-hidden="true"><path d="M4.25 5.5h9.5M7 5.5V3.4h4v2.1M6 7.25v6.5h6v-6.5M8 8.75v3.25M10 8.75v3.25" /></svg></button></div>
          {space.id === activeSpaceId && !collapsedSpaces.has(space.id) ? <div className="sandrone-space-document-tree">
            <div className="sandrone-space-document-label" onDragOver={event => event.preventDefault()} onDrop={event => handleTreeDrop(event, '', null)}><span>笔记</span><div className="sandrone-space-create-anchor" data-sandrone-space-create-menu><button type="button" aria-label="新建内容" title="新建内容" aria-expanded={createMenuOpen} onClick={() => setCreateMenuOpen(value => !value)}>＋</button>{createMenuOpen ? <div className="sandrone-space-create-menu" role="menu"><button type="button" role="menuitem" onClick={() => { setCreateMenuOpen(false); void createDocument() }}>新建 Markdown</button><button type="button" role="menuitem" onClick={() => { setCreateMenuOpen(false); void createFolder() }}>新建子文件夹</button></div> : null}</div></div>
            {renderTreeEntries()}
            {documents.length === 0 ? <button type="button" className="sandrone-space-document-empty" onClick={() => void createDocument()}>从一篇笔记开始</button> : null}
            {resources.length > 0 ? <div className="sandrone-space-resource-tree"><div className="sandrone-space-document-label"><span>资源</span></div>{resources.map(resource => <button type="button" key={resource.path} className={`sandrone-space-resource-row${selectedResource === resource.path ? ' is-selected' : ''}`} title="选择资源" onClick={() => setSelectedResource(resource.path)}><svg viewBox="0 0 18 18" aria-hidden="true"><rect x="2.5" y="3" width="13" height="12" rx="1.5" /><circle cx="6.2" cy="6.7" r="1.1" /><path d="m3.5 13 3.8-3.7 2.45 2.2 1.75-1.7 2.95 3.2" /></svg><span>{resource.path}</span></button>)}{selectedResource ? <div className="sandrone-space-resource-actions"><button type="button" onClick={() => insertResourceReference(selectedResource)} disabled={!activePath}>插入 Markdown</button><button type="button" onClick={() => renameResource(selectedResource)}>重命名</button><button type="button" className="is-danger" onClick={() => removeResource(selectedResource)}>删除</button></div> : null}</div> : null}
          </div> : null}
        </div>)}
        {!busy && spaces.length === 0 ? <div className="sandrone-space-empty"><span>还没有空间</span><button type="button" onClick={() => void createSpaceAction()}>创建第一个空间</button></div> : null}
        {!busy && spaces.length > 0 && visibleSpaces.length === 0 ? <div className="sandrone-space-filter-empty">没有匹配的空间或 Markdown</div> : null}
      </div>
      <footer className="sandrone-space-sidebar-footer">
        <span role="status">{error || status || (dirty ? '编辑中' : '本地 Markdown')}</span>
        {undoDelete ? <button type="button" className="sandrone-space-undo-delete" onClick={() => void restoreDeletedDocument()}>撤销删除</button> : null}
      </footer>
    </aside>
    <main className="sandrone-space-editor">
      {activePath ? <><div className="sandrone-space-editor-toolbar"><div className="sandrone-space-editor-title"><strong>{activePath}</strong><small>{dirty ? '未保存' : '已保存'} · {content.length} 字符</small></div><div className="sandrone-space-editor-actions"><button type="button" aria-label="撤销" title="撤销 (Ctrl+Z)" onClick={undoEditorChange} disabled={!editorHistory?.past.length}>撤销</button><button type="button" aria-label="重做" title="重做 (Ctrl+Y)" onClick={redoEditorChange} disabled={!editorHistory?.future.length}>重做</button><span className="sandrone-space-editor-divider" aria-hidden="true" /><button type="button" className={mode === 'edit' ? 'is-active' : ''} onClick={() => setMode('edit')}>编辑</button><button type="button" className={mode === 'split' ? 'is-active' : ''} onClick={() => setMode('split')}>分屏</button><button type="button" className={mode === 'preview' ? 'is-active' : ''} onClick={() => setMode('preview')}>阅读</button><button type="button" onClick={() => void importResource()}>插入图片</button><button type="button" onClick={renameDocument}>重命名</button><button type="button" onClick={() => void saveDocument()} disabled={!dirty}>保存</button><button type="button" className="is-danger" onClick={() => void removeDocument()}>删除</button></div></div>{externalChanged ? <div className="sandrone-space-external-change" role="status"><span>文件已在应用外更新</span><button type="button" onClick={() => void reloadExternalDocument()}>重新载入</button></div> : null}{mode === 'edit' ? editorValue : mode === 'split' ? <div className="sandrone-space-split-view">{editorValue}{editorPreview}</div> : editorPreview}</> : <div className="sandrone-space-welcome"><span className="sandrone-space-mark">✦</span><h2>给想法一个安静的地方</h2><p>创建空间，再用 Markdown 记录思考。文件保存在本机用户数据目录的 <code>space</code> 文件夹。</p>{!activeSpaceId ? <button type="button" onClick={() => void createSpaceAction()}>创建空间</button> : <p>从左侧选择一篇 Markdown，或者新建文档。</p>}</div>}
    </main>
    {nameDialog ? <div className="sandrone-space-dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !nameDialogBusy) setNameDialog(null) }}><form className="sandrone-space-dialog" role="dialog" aria-modal="true" aria-labelledby="sandrone-space-dialog-title" onSubmit={submitNameDialog}><div className="sandrone-space-dialog-heading"><strong id="sandrone-space-dialog-title">{nameDialog.kind === 'space' ? '创建空间' : nameDialog.kind === 'rename-space' ? '重命名空间' : nameDialog.kind === 'folder' ? '新建子文件夹' : nameDialog.kind === 'rename-resource' ? '重命名资源' : nameDialog.kind === 'rename-document' ? '重命名 Markdown' : '新建 Markdown'}</strong><button type="button" aria-label="关闭" onClick={() => setNameDialog(null)} disabled={nameDialogBusy}>×</button></div><label>{nameDialog.kind === 'space' || nameDialog.kind === 'rename-space' ? '空间名称' : nameDialog.kind === 'folder' ? '文件夹路径' : nameDialog.kind === 'rename-resource' ? '资源文件名' : 'Markdown 文件路径'}<input autoFocus type="text" value={nameDialog.value} onChange={event => setNameDialog(current => current ? { ...current, value: event.target.value } : current)} disabled={nameDialogBusy} /></label><div className="sandrone-space-dialog-actions"><button type="button" onClick={() => setNameDialog(null)} disabled={nameDialogBusy}>取消</button><button type="submit" className="is-primary" disabled={nameDialogBusy || !nameDialog.value.trim()}>{nameDialogBusy ? '处理中…' : nameDialog.kind.startsWith('rename') ? '重命名' : '创建'}</button></div></form></div> : null}
    {confirmDialog ? <div className="sandrone-space-dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !confirmDialogBusy) setConfirmDialog(null) }}><div className="sandrone-space-dialog" role="dialog" aria-modal="true" aria-labelledby="sandrone-space-confirm-title"><div className="sandrone-space-dialog-heading"><strong id="sandrone-space-confirm-title">{confirmDialog.title}</strong><button type="button" aria-label="关闭" onClick={() => setConfirmDialog(null)} disabled={confirmDialogBusy}>×</button></div><p className="sandrone-space-dialog-message">{confirmDialog.message}</p><div className="sandrone-space-dialog-actions"><button type="button" onClick={() => setConfirmDialog(null)} disabled={confirmDialogBusy}>取消</button><button type="button" className="is-danger" onClick={() => void submitConfirmDialog()} disabled={confirmDialogBusy}>{confirmDialogBusy ? '删除中…' : '删除'}</button></div></div></div> : null}
  </section>
}

function SandroneRegionLauncher() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [region, setRegion] = useState('workspace')
  const [host, setHost] = useState(null)
  const anchorRef = useRef(null)
  const [menuPosition, setMenuPosition] = useState(null)
  const switchRegion = async nextRegion => {
    if (nextRegion === region) {
      setMenuOpen(false)
      return
    }
    if (region === 'space') {
      const flushed = await new Promise(resolve => {
        window.dispatchEvent(new CustomEvent('sandrone-space-flush', { detail: { resolve } }))
      })
      if (!flushed) return
    }
    setRegion(nextRegion)
    setMenuOpen(false)
  }
  useEffect(() => {
    const root = document.getElementById('root')
    if (!root) return undefined
    root.dataset.sandroneRegion = region
    return () => {
      if (root.dataset.sandroneRegion === region) delete root.dataset.sandroneRegion
    }
  }, [region])
  useEffect(() => {
    const root = document.getElementById('root')
    if (!root) return undefined
    if (menuOpen) root.dataset.sandroneRegionMenuOpen = 'true'
    else delete root.dataset.sandroneRegionMenuOpen
    return () => { delete root.dataset.sandroneRegionMenuOpen }
  }, [menuOpen])
  useEffect(() => {
    const root = document.getElementById('root') || document.body
    let frameId = 0
    const locate = () => {
      const next = document.querySelector('[data-sandrone-region-host]')
      setHost(current => current === next ? current : next)
    }
    const observer = new MutationObserver(() => {
      if (frameId) return
      frameId = window.requestAnimationFrame(() => { frameId = 0; locate() })
    })
    observer.observe(root, { childList: true, subtree: true })
    locate()
    return () => { observer.disconnect(); if (frameId) window.cancelAnimationFrame(frameId) }
  }, [])
  useEffect(() => {
    if (!menuOpen || !anchorRef.current) return undefined
    const update = () => {
      const rect = anchorRef.current.getBoundingClientRect()
      setMenuPosition({ left: Math.round(rect.left), top: Math.round(rect.bottom + 4) })
    }
    update()
    window.addEventListener('resize', update, { passive: true })
    return () => window.removeEventListener('resize', update)
  }, [menuOpen])
  useEffect(() => {
    const onKeyDown = event => { if (event.key === 'Escape') setMenuOpen(false) }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
  const launcher = <div className="sandrone-region-anchor" data-sandrone-region-anchor ref={anchorRef}>
    <button type="button" className="sandrone-region-trigger" aria-expanded={menuOpen} aria-haspopup="menu" onClick={() => setMenuOpen(value => !value)}><span className="sandrone-region-glyph" aria-hidden="true">{region === 'space' ? '✦' : '⌘'}</span><span>{region === 'space' ? '空间区' : '工作区'}</span><svg viewBox="0 0 12 12" aria-hidden="true"><path d="m3 4.5 3 3 3-3" /></svg></button>
    {menuOpen ? <div className="sandrone-region-menu" role="menu" style={menuPosition || undefined}><button type="button" className={region === 'workspace' ? 'is-active' : ''} role="menuitem" onClick={() => void switchRegion('workspace')}><span>⌘</span><span><strong>工作区</strong><small>DeepSeek Harness 会话</small></span></button><button type="button" className={region === 'space' ? 'is-active' : ''} role="menuitem" onClick={() => void switchRegion('space')}><span>✦</span><span><strong>空间区</strong><small>本地 Markdown 思考空间</small></span></button></div> : null}
  </div>
  return <>
    {host ? createPortal(launcher, host) : null}
    {region === 'space' ? <SpaceRegionView onClose={() => setRegion('workspace')} /> : null}
  </>
}

function SandroneTopbar({ toggleTheme, toggleSidebar }) {
  const desktop = window.sandroneDesktop?.window
  const navigateRef = usePageNavigation()

  useEffect(() => {
    const api = window.sandroneDesktop
    if (!api || typeof api.onCommand !== 'function') return undefined
    return api.onCommand(command => {
      switch (command) {
        case 'toggle-sidebar':
          toggleSidebar()
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
  }, [toggleTheme, toggleSidebar])

  const openMenu = (menuId, event) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const colorScheme = document.querySelector('[data-ds-dark-theme]') ? 'dark' : 'light'
    desktop?.showApplicationMenu(menuId, { x: Math.round(rect.left), y: Math.round(rect.bottom) }, { colorScheme })
  }

  return (
    <header className="sandrone-topbar" data-sandrone-topbar>
      <nav className="sandrone-topbar-navigation" aria-label="应用导航">
        <button type="button" className="sandrone-topbar-history sandrone-topbar-sidebar" aria-label="切换侧边栏" title="切换侧边栏" onClick={toggleSidebar}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.25" y="2.5" width="11.5" height="11" rx="1.25" /><path d="M5.5 2.75v10.5" /></svg>
        </button>
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

function SessionViewToggle() {
  const [state, setState] = useState({ available: false, current: '', next: '', trajectory: false })
  useEffect(() => {
    const sync = () => {
      const tabs = [...document.querySelectorAll('[data-sandrone-session-tabs] [role="tab"]')]
      const activeIndex = tabs.findIndex(tab => tab.getAttribute('aria-selected') === 'true')
      const current = textOf(tabs[activeIndex])
      const next = textOf(tabs[(activeIndex + 1 + tabs.length) % tabs.length])
      setState(previous => previous.current === current && previous.next === next && previous.available === (tabs.length > 1)
        ? previous : { available: tabs.length > 1, current, next, trajectory: /轨迹|trajectory/i.test(current) })
    }
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(document.getElementById('root') || document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-selected'] })
    return () => observer.disconnect()
  }, [])
  if (!state.available) return null
  const toggle = () => {
    const tabs = [...document.querySelectorAll('[data-sandrone-session-tabs] [role="tab"]')]
    const activeIndex = tabs.findIndex(tab => tab.getAttribute('aria-selected') === 'true')
    const next = tabs[(activeIndex + 1 + tabs.length) % tabs.length]
    if (next instanceof HTMLElement) next.click()
  }
  return <button type="button" className="sandrone-session-icon-button" aria-label={`切换到${state.next}`} title={`当前：${state.current}，点击切换到${state.next}`} onClick={toggle}>
    {state.trajectory
      ? <svg viewBox="0 0 18 18" aria-hidden="true"><circle cx="4" cy="4" r="1.1"/><circle cx="14" cy="9" r="1.1"/><circle cx="4" cy="14" r="1.1"/><path d="M5.2 4h2.2A2.6 2.6 0 0 1 10 6.6v4.8A2.6 2.6 0 0 1 7.4 14H5.2M10 9h2.8"/></svg>
      : <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M3.5 4.25h11v7.5H8.25L5 14.25l.65-2.5H3.5Z"/><path d="M5.75 7h6.5M5.75 9.15h4.2"/></svg>}
  </button>
}

function SessionScreenshotControl({ sessionId }) {
  const [state, setState] = useState({ phase: 'idle', message: '', start: null })
  const [pointerOffset, setPointerOffset] = useState(null)
  const [, setViewportTick] = useState(0)
  const targetRef = useRef(null)
  const baselineRef = useRef(null)
  const desktop = window.sandroneDesktop
  if (!desktop?.screenshot?.captureSession) return null
  const findTarget = () => {
    const session = document.querySelector('[data-sandrone-session-body]')
    const element = session?.querySelector('[data-conversation-scroll]') || document.querySelector('[data-conversation-scroll]') || session
    if (!(element instanceof HTMLElement)) throw new Error('当前没有可截图的会话内容')
    return element
  }
  const startSelection = () => {
    if (state.phase !== 'idle' && state.phase !== 'success' && state.phase !== 'error') return
    try {
      const element = findTarget()
      targetRef.current = element
      baselineRef.current = { sessionId, width: element.getBoundingClientRect().width, scrollHeight: element.scrollHeight }
      setPointerOffset(Math.round(element.clientHeight / 2))
      setState({ phase: 'selecting-start', message: '', start: null })
    } catch (cause) {
      setState({ phase: 'error', message: cause instanceof Error ? cause.message : String(cause) })
    }
  }
  const cancelSelection = (message = '') => {
    targetRef.current = null
    baselineRef.current = null
    setPointerOffset(null)
    setState({ phase: message ? 'error' : 'idle', message, start: null })
  }
  const choosePoint = async event => {
    event.preventDefault()
    event.stopPropagation()
    const element = targetRef.current
    if (!(element instanceof HTMLElement) || !element.isConnected) {
      cancelSelection('会话内容已切换，请重新选择截图')
      return
    }
    const rect = element.getBoundingClientRect()
    const localOffset = Number.isFinite(event.clientY)
      ? Math.max(0, Math.min(rect.height, event.clientY - rect.top))
      : pointerOffset
    if (localOffset === null || !Number.isFinite(localOffset)) return
    const offset = Math.max(0, Math.round(element.scrollTop + localOffset))
    if (state.phase === 'selecting-start') {
      setState({ phase: 'selecting-end', message: '', start: offset })
      return
    }
    if (state.phase !== 'selecting-end' || state.start === null) return
    const top = Math.min(state.start, offset)
    const bottom = Math.max(state.start, offset)
    setState({ phase: 'capturing', message: '' })
    try {
      const rendered = await renderSessionScreenshot(element, { top, bottom }, baselineRef.current)
      const result = await screenshotTimeout(desktop.screenshot.captureSession(rendered), 45_000, '保存会话截图超时')
      if (result?.canceled) {
        cancelSelection()
        return
      }
      if (!result?.ok) throw new Error(result?.error || '保存截图失败')
      let attached = false
      let fallback = false
      if (result.bytes) {
        const fileName = String(result.path || '').split(/[\\/]/).pop() || `Sandrone-session-${Date.now()}.png`
        const screenshotFile = new File([result.bytes], fileName, { type: 'image/png' })
        attached = dispatchFilesToOfficialInput([screenshotFile])
        if (!attached) fallback = insertFallbackFileText([screenshotFile])
      }
      targetRef.current = null
      baselineRef.current = null
      setPointerOffset(null)
      const clipboardMessage = result.clipboard === true
        ? '已复制到系统剪贴板'
        : result.clipboard === false
          ? '但写入系统剪贴板失败'
          : '未写入系统剪贴板'
      const attachmentMessage = result.attachment === false
        ? '图片过大，未自动添加到输入框'
        : attached
          ? '已添加到输入框'
          : fallback
            ? '已在输入框插入图片占位符'
            : result.bytes
              ? '未能添加到输入框'
              : '未传入输入框'
      setState({ phase: 'success', message: `已保存、${clipboardMessage}、${attachmentMessage}`, start: null })
      window.setTimeout(() => setState(current => current.phase === 'success' ? { phase: 'idle', message: '', start: null } : current), 1800)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      targetRef.current = null
      baselineRef.current = null
      setPointerOffset(null)
      setState({ phase: 'error', message, start: null })
    }
  }
  useEffect(() => {
    const element = targetRef.current
    if (!element || (state.phase !== 'selecting-start' && state.phase !== 'selecting-end')) return undefined
    if (baselineRef.current?.sessionId !== sessionId) {
      cancelSelection('会话已切换，请重新选择截图')
      return undefined
    }
    const onKeyDown = event => { if (event.key === 'Escape') cancelSelection() }
    const onPointerMove = event => {
      if (!element.isConnected) {
        cancelSelection('会话内容已切换，请重新选择截图')
        return
      }
      const rect = element.getBoundingClientRect()
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return
      setPointerOffset(Math.max(0, Math.min(rect.height, event.clientY - rect.top)))
    }
    const onWheel = event => {
      if (event.target instanceof Element && event.target.closest('.sandrone-session-screenshot-cancel')) return
      if (!element.isConnected) {
        cancelSelection('会话内容已切换，请重新选择截图')
        return
      }
      const rect = element.getBoundingClientRect()
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return
      event.preventDefault()
      event.stopPropagation()
      const lineHeight = Number.parseFloat(window.getComputedStyle(element).lineHeight) || 16
      const unit = event.deltaMode === 1 ? lineHeight : event.deltaMode === 2 ? element.clientHeight : 1
      const maxScroll = Math.max(0, element.scrollHeight - element.clientHeight)
      element.scrollTop = Math.max(0, Math.min(maxScroll, element.scrollTop + event.deltaY * unit))
    }
    const onScroll = () => {
      const baseline = baselineRef.current
      if (baseline && (Math.abs(element.scrollHeight - baseline.scrollHeight) > 1 || Math.abs(element.getBoundingClientRect().width - baseline.width) > 1)) {
        cancelSelection('会话内容发生变化，请重新选择截图')
        return
      }
      setViewportTick(value => value + 1)
    }
    const onResize = () => cancelSelection('窗口尺寸发生变化，请重新选择截图')
    const onVisibilityChange = () => {
      if (document.hidden) cancelSelection('窗口失去焦点，请重新选择截图')
    }
    const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
      const baseline = baselineRef.current
      if (baseline && (Math.abs(element.scrollHeight - baseline.scrollHeight) > 1 || Math.abs(element.getBoundingClientRect().width - baseline.width) > 1)) {
        cancelSelection('会话布局发生变化，请重新选择截图')
      } else {
        setViewportTick(value => value + 1)
      }
    }) : null
    resizeObserver?.observe(element)
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('pointermove', onPointerMove, true)
    document.addEventListener('wheel', onWheel, { capture: true, passive: false })
    element.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onResize)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('pointermove', onPointerMove, true)
      document.removeEventListener('wheel', onWheel, true)
      element.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onResize)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      resizeObserver?.disconnect()
    }
  }, [state.phase, sessionId])
  const element = targetRef.current
  const label = state.phase === 'selecting-start' ? '请选择长截图起点' : state.phase === 'selecting-end' ? '请选择长截图终点' : state.phase === 'capturing' ? '正在截取会话长截图' : state.phase === 'success' ? '会话长截图已保存' : state.phase === 'error' ? `会话长截图失败：${state.message}` : '截取会话长截图'
  const overlay = element instanceof HTMLElement && (state.phase === 'selecting-start' || state.phase === 'selecting-end') ? (() => {
    const rect = element.getBoundingClientRect()
    const lineOffset = pointerOffset === null ? 0 : pointerOffset
    const startScreen = state.start === null ? null : state.start - element.scrollTop
    return createPortal(<div className="sandrone-session-screenshot-overlay" data-sandrone-screenshot-overlay="true" style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }} onClick={choosePoint}>
      <div className="sandrone-session-screenshot-guide" style={{ top: Math.max(0, Math.min(rect.height, lineOffset)) }}><span>{label}</span></div>
      {state.phase === 'selecting-end' && startScreen !== null ? <div className="sandrone-session-screenshot-start" style={{ top: Math.max(0, Math.min(rect.height, startScreen)) }} /> : null}
      <button type="button" className="sandrone-session-screenshot-cancel" onClick={event => { event.stopPropagation(); cancelSelection() }}>Esc 取消</button>
    </div>, document.body)
  })() : null
  return <><button type="button" className={`sandrone-session-icon-button sandrone-session-screenshot-button is-${state.phase}`} aria-label={label} title={label} disabled={state.phase === 'capturing'} onClick={startSelection}>
    <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M3 6V3h3M12 3h3v3M15 12v3h-3M6 15H3v-3"/><path d="M9 5.25v7.5M6.25 9h5.5"/></svg>
  </button>{state.phase === 'error' || state.phase === 'success' ? <span className={`sandrone-session-screenshot-status is-${state.phase}`} role="status" aria-live="polite">{state.message}</span> : null}{overlay}</>
}

const RIGHT_PANEL_EVENT = 'sandrone:right-panel'

function dispatchRightPanel(panel) {
  window.dispatchEvent(new CustomEvent(RIGHT_PANEL_EVENT, { detail: panel }))
}

function useRightPanel(name) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const onPanel = event => setOpen(event.detail === name)
    window.addEventListener(RIGHT_PANEL_EVENT, onPanel)
    return () => window.removeEventListener(RIGHT_PANEL_EVENT, onPanel)
  }, [name])
  const toggle = () => dispatchRightPanel(open ? null : name)
  const close = () => dispatchRightPanel(null)
  return { open, toggle, close }
}

function WorkspaceControl({ toggleWorkspace }) {
  return <button type="button" className="sandrone-session-icon-button" aria-label="工作区与文件预览" title="工作区与文件预览" onClick={toggleWorkspace}><svg viewBox="0 0 18 18" aria-hidden="true"><path d="M2.75 5.3h4l1.3 1.45h7.2v7H2.75Z"/><path d="M2.75 5.3v-.8A1.25 1.25 0 0 1 4 3.25h2.4l1.3 1.5h6"/></svg></button>
}

function ThemeControl({ getTheme, toggleTheme }) {
  const [dark, setDark] = useState(() => getTheme().active.colorScheme === 'dark')
  useEffect(() => {
    const observer = new MutationObserver(() => setDark(getTheme().active.colorScheme === 'dark'))
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
    return () => observer.disconnect()
  }, [getTheme])
  return <button type="button" className="sandrone-session-icon-button" aria-label={dark ? '切换白天模式' : '切换夜间模式'} title={dark ? '切换白天模式' : '切换夜间模式'} onClick={() => { toggleTheme(); setDark(getTheme().active.colorScheme === 'dark') }}>
    {dark ? <svg viewBox="0 0 18 18" aria-hidden="true"><circle cx="9" cy="9" r="3"/><path d="M9 1.75v1.5M9 14.75v1.5M1.75 9h1.5M14.75 9h1.5M3.85 3.85l1.05 1.05M13.1 13.1l1.05 1.05M14.15 3.85 13.1 4.9M4.9 13.1l-1.05 1.05"/></svg> : <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M14.75 11.1A6.1 6.1 0 0 1 6.9 3.25 6.1 6.1 0 1 0 14.75 11.1Z"/></svg>}
  </button>
}

function buddyStorageKey(sessionId) { return `sandrone.harness.buddy.chat.v1:${sessionId}` }

function readBuddyHistory(sessionId) {
  try { const value = JSON.parse(window.localStorage.getItem(buddyStorageKey(sessionId)) || '[]'); return Array.isArray(value) ? value.slice(-24) : [] } catch { return [] }
}

function BuddyControl({ remote, sessions, modelDirectories, sessionId, useWorkspaces }) {
  const { config } = useExtensionsConfig()
  const workspace = useWorkspaces(state => state.items.find(item => item.sessionIds.includes(sessionId)))
  const panel = useRightPanel('buddy')
  const [history, setHistory] = useState(() => readBuddyHistory(sessionId))
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const historyRef = useRef(null)
  const lifetime = useRef(null)
  const journalRef = useRef(null)
  const attach = (buddySessionId, controller) => {
    const journal = openBuddyJournal(remote, buddySessionId, {
      Stream: SessionEventStream,
      EventSource: MutableSessionEventSource,
      signal: controller.signal,
      onHistory: value => { if (!controller.signal.aborted) setHistory(value) },
      onError: cause => { if (!controller.signal.aborted) setError(cause.message) },
    })
    journalRef.current = journal
    return journal
  }
  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    journalRef.current = null
    setHistory(readBuddyHistory(sessionId))
    setSending(false)
    setError('')
    const buddySessionId = window.localStorage.getItem(`sandrone.harness.buddy.session.v2:${sessionId}`)
    if (buddySessionId) attach(buddySessionId, controller).ready.catch(cause => {
      if (!controller.signal.aborted) setError(cause.message)
    })
    return () => controller.abort()
  }, [remote, sessionId])
  useEffect(() => { historyRef.current?.scrollTo({ top: historyRef.current.scrollHeight, behavior: 'smooth' }) }, [history, sending])

  const buddy = config.buddy
  if (!buddy.enabled) return null
  const send = async event => {
    event?.preventDefault()
    const message = input.trim()
    if (!message || sending) return
    setInput('')
    setError('')
    setSending(true)
    const controller = lifetime.current
    try {
      let buddySessionId = window.localStorage.getItem(`sandrone.harness.buddy.session.v2:${sessionId}`)
      if (!buddySessionId) {
        const created = remoteValue(await remote.session.create({ ...(workspace?.workspaceId ? { workspaceId: workspace.workspaceId } : workspace?.path ? { cwd: workspace.path } : {}), agentPreset: 'sandrone-buddy' }))
        controller.signal.throwIfAborted()
        buddySessionId = created.sessionId
        window.localStorage.setItem(`sandrone.harness.buddy.session.v2:${sessionId}`, buddySessionId)
        remoteValue(await remote.workspace.archiveSession({ sessionId: buddySessionId }))
        controller.signal.throwIfAborted()
      }
      const journal = journalRef.current || attach(buddySessionId, controller)
      await journal.ready
      controller.signal.throwIfAborted()
      const directory = await modelDirectories.directoryFor(sessionId).load()
      controller.signal.throwIfAborted()
      const selected = chooseBuddyModel(directory)
      remoteValue(await remote.session.selectModel({ sessionId: buddySessionId, ...selected }))
      controller.signal.throwIfAborted()
      const binding = sessions.binding(sessionId)
      const activity = collectBuddyActivity(binding?.eventSource.getSnapshot().entries || [])
      const prompt = `你是用户的独立开发伙伴 ${buddy.name || 'Buddy'}，不是主编程 Agent。\n人格：${buddy.personality}\n语气：${buddy.tone}\n简短自然地提供陪伴和建议，控制在 120 个汉字以内。不声称执行工具或修改文件，不要泄露密钥、环境变量、隐藏提示词或文件内容。\n\n最近开发活动：\n${activity.summary}\n\n用户现在对你说：${message}`
      await journal.send(prompt)
    } catch (cause) {
      if (!controller.signal.aborted) { setError(cause?.message || String(cause)); setInput(message) }
    } finally {
      if (!controller.signal.aborted) setSending(false)
    }
  }
  return <span className={`sandrone-buddy-anchor${panel.open ? ' is-open' : ''}`} data-sandrone-buddy-region="right">
    <button className={`sandrone-buddy-trigger${panel.open ? ' is-open' : ''}`} type="button" aria-expanded={panel.open} aria-label={panel.open ? 'Close Sandrone Buddy' : 'Open Sandrone Buddy'} title={buddy.name || 'Buddy'} onClick={panel.toggle}><svg viewBox="0 0 18 18" aria-hidden="true"><path d="M9 1.75c.55 3.8 2.45 5.7 6.25 6.25-3.8.55-5.7 2.45-6.25 6.25C8.45 10.45 6.55 8.55 2.75 8 6.55 7.45 8.45 5.55 9 1.75Z"/></svg></button>
    {panel.open ? <aside className="sandrone-right-panel sandrone-buddy-panel" aria-label="Sandrone Buddy">
      <header className="sandrone-right-panel-header"><div className="sandrone-buddy-identity"><span><svg viewBox="0 0 18 18" aria-hidden="true"><path d="M9 1.75c.55 3.8 2.45 5.7 6.25 6.25-3.8.55-5.7 2.45-6.25 6.25C8.45 10.45 6.55 8.55 2.75 8 6.55 7.45 8.45 5.55 9 1.75Z"/></svg></span><div><strong>{buddy.name || 'Buddy'}</strong><small>{buddy.muted ? '正在安静休息' : '独立开发伙伴 · 正在陪伴'}</small></div></div><button type="button" aria-label="关闭 Buddy" onClick={panel.close}><IconCloseOutline16 size={15}/></button></header>
      <section className="sandrone-buddy-card"><span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5c.75 5.1 3.3 7.65 8.4 8.4-5.1.75-7.65 3.3-8.4 8.4-.75-5.1-3.3-7.65-8.4-8.4 5.1-.75 7.65-3.3 8.4-8.4Z"/></svg></span><div><strong>{buddy.name || 'Buddy'}</strong><small>{buddy.tone}</small></div></section>
      <div className="sandrone-buddy-history" ref={historyRef}>{history.length === 0 ? <div className="sandrone-buddy-welcome"><IconSparkle16 size={22}/><strong>{buddy.name || 'Buddy'} 在这里</strong><p>可以聊聊当前开发进展，也可以把它当作独立的陪伴窗口。</p></div> : history.map(message => <article key={message.id} className={`sandrone-buddy-message ${message.role}`}><small>{message.role === 'user' ? '你' : buddy.name || 'Buddy'}</small><p>{message.content}</p></article>)}{sending ? <article className="sandrone-buddy-message buddy pending"><small>{buddy.name || 'Buddy'}</small><p><i/><i/><i/></p></article> : null}</div>
      {error ? <p className="sandrone-panel-error">{error}</p> : null}
      <form className="sandrone-buddy-composer" onSubmit={send}><textarea rows="2" value={input} disabled={sending || buddy.muted} placeholder={buddy.muted ? 'Buddy 已静音' : `和 ${buddy.name || 'Buddy'} 说点什么…`} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) send(event) }}/><button type="submit" disabled={!input.trim() || sending || buddy.muted} aria-label="发送给 Buddy"><svg viewBox="0 0 18 18" aria-hidden="true"><path d="M9 14.5v-11M4.75 7.75 9 3.5l4.25 4.25"/></svg></button></form>
    </aside> : null}
  </span>
}

export function apply(ctx) {
  ctx.effect(
    () => ctx.theme.overrideTokens('@sandrone/harness-ui', TOKEN_LAYER),
    'sandrone-ui: semantic theme layer',
  )
  installSurfaceMarkers(ctx)
  installMessageImageEnhancements(ctx)
  installStyle(ctx)
  const toggleTheme = () => {
    const active = ctx.theme.getTheme().active.colorScheme
    ctx.theme.setTheme(active === 'dark' ? 'light' : 'dark')
  }
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'sandrone-topbar',
    order: -100,
    inject: () => ({ toggleTheme, toggleSidebar: () => ctx.layout.toggleSidebar() }),
  }, SandroneTopbar))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'sandrone-region-launcher',
    order: -90,
  }, SandroneRegionLauncher))
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'sandrone-view-toggle',
    order: -100,
  }, SessionViewToggle))
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'sandrone-session-screenshot',
    order: 40,
    inject: sessionId => ({ sessionId }),
  }, SessionScreenshotControl))
  ctx.inject(['sidebarRight'], scope => {
    scope.effect(() => {
      const onPanel = event => {
        if (event.detail === 'buddy' && scope.sidebarRight.isExpanded()) scope.sidebarRight.toggleExpanded()
      }
      window.addEventListener(RIGHT_PANEL_EVENT, onPanel)
      return () => window.removeEventListener(RIGHT_PANEL_EVENT, onPanel)
    })
    scope.slots.inject('conversation.session.header.corner', () => scope.slots.register({
      name: 'conversation.session.header.corner',
      priority: -100,
    }, () => null))
    scope.slots.inject('conversation.session.header.utilities', () => scope.slots.register({
      name: 'conversation.session.header.utilities',
      id: 'sandrone-workspace',
      order: 80,
      inject: () => ({ toggleWorkspace: () => { dispatchRightPanel(null); scope.sidebarRight.toggleExpanded() } }),
    }, WorkspaceControl))
  })
  ctx.inject(['remote', 'remote.session', 'remote.workspace', 'sessions', 'modelDirectories'], scope => scope.slots.inject('conversation.session.header.utilities', () => scope.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'sandrone-buddy',
    order: 100,
    inject: sessionId => ({ remote: scope.remote, sessions: scope.sessions, modelDirectories: scope.modelDirectories, sessionId }),
  }, BuddyControl)))
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'sandrone-theme-toggle',
    order: 120,
    inject: () => ({ getTheme: () => ctx.theme.getTheme(), toggleTheme }),
  }, ThemeControl))
  ctx.inject(['remote', 'remote.settings'], (scope) => {
    const remote = scope.remote
    scope.effect(installProviderCapabilityFields(remote), 'sandrone-ui: provider model capability fields')
  })
  // Own model seat: registering through the modelDirectories service scope
  // guarantees our entry lands after ui-model-selection's. The shipped entry
  // sits at priority 0; shadowing needs a DIFFERENT priority and the lowest
  // one renders — so register explicitly at -100.
  ctx.inject(['modelDirectories', 'sessions', 'remote', 'remote.session'], (scope) => {
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
    id: 'sandrone-skills',
    order: 16,
    label: () => 'Skills',
  }, SkillsSettingsSection))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'sandrone-mcp',
    order: 17,
    label: () => 'MCP',
  }, McpSettingsSection))
  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'sandrone-managed',
    order: 50,
    label: () => 'Sandrone 托管',
  }, ManagedPluginsTab))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'sandrone-buddy',
    order: 18,
    label: () => 'Buddy',
  }, BuddySettingsSection))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'sandrone-im',
    order: 19,
    label: () => 'IM',
  }, ImSettingsSection))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'sandrone-other',
    order: 100,
    label: () => '其他',
  }, OtherSettingsSection))
  installSettingsChrome(ctx)
  installNativeDirectoryFlow(ctx)
}
