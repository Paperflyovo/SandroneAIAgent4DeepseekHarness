'use strict'

const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('sandroneDesktop', Object.freeze({
  platform: process.platform,
  getStatus: () => ipcRenderer.invoke('desktop:get-status'),
  restartHarness: () => ipcRenderer.invoke('desktop:restart-harness'),
  getGpuAcceleration: () => ipcRenderer.invoke('desktop:get-gpu-acceleration'),
  setGpuAcceleration: (value) => ipcRenderer.invoke('desktop:set-gpu-acceleration', Boolean(value)),
  getScreenshotDirectory: () => ipcRenderer.invoke('desktop:get-screenshot-directory'),
  chooseScreenshotDirectory: () => ipcRenderer.invoke('desktop:choose-screenshot-directory'),
  extensions: Object.freeze({
    getConfig: () => ipcRenderer.invoke('desktop:get-extensions-config'),
    saveConfig: (value) => ipcRenderer.invoke('desktop:save-extensions-config', value),
    scanSkills: () => ipcRenderer.invoke('desktop:scan-skills'),
    onChanged: (listener) => {
      if (typeof listener !== 'function') throw new TypeError('listener must be a function')
      const wrapped = (_event, value) => listener(value)
      ipcRenderer.on('desktop:extensions-config-changed', wrapped)
      return () => ipcRenderer.removeListener('desktop:extensions-config-changed', wrapped)
    },
  }),
  getUpdateState: () => ipcRenderer.invoke('desktop:get-update-state'),
  checkForUpdates: (options) => ipcRenderer.invoke('desktop:check-for-updates', options && { force: options.force === true }),
  downloadUpdate: () => ipcRenderer.invoke('desktop:download-update'),
  installUpdate: () => ipcRenderer.invoke('desktop:install-update'),
  onUpdateStatus: (listener) => {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function')
    const wrapped = (_event, status) => listener(status)
    ipcRenderer.on('desktop:update-status', wrapped)
    return () => ipcRenderer.removeListener('desktop:update-status', wrapped)
  },
  pickDirectory: () => ipcRenderer.invoke('desktop:pick-directory'),
  workspace: Object.freeze({
    listDirectory: (root, relativePath = '') => ipcRenderer.invoke('desktop:list-workspace-directory', String(root), String(relativePath)),
    readFile: (root, relativePath) => ipcRenderer.invoke('desktop:read-workspace-file', String(root), String(relativePath)),
    reveal: (root, relativePath = '') => ipcRenderer.invoke('desktop:reveal-workspace-path', String(root), String(relativePath)),
  }),
  space: Object.freeze({
    getRoot: () => ipcRenderer.invoke('desktop:space-root'),
    list: () => ipcRenderer.invoke('desktop:space-list'),
    create: (name) => ipcRenderer.invoke('desktop:space-create', String(name || '')),
    rename: (id, name) => ipcRenderer.invoke('desktop:space-rename', String(id || ''), String(name || '')),
    remove: (id) => ipcRenderer.invoke('desktop:space-delete', String(id || '')),
    get: (id) => ipcRenderer.invoke('desktop:space-get', String(id || '')),
    documents: (id) => ipcRenderer.invoke('desktop:space-documents', String(id || '')),
    folders: (id) => ipcRenderer.invoke('desktop:space-folders', String(id || '')),
    createDirectory: (id, relativePath) => ipcRenderer.invoke('desktop:space-create-directory', String(id || ''), String(relativePath || '')),
    resources: (id) => ipcRenderer.invoke('desktop:space-resources', String(id || '')),
    search: (query) => ipcRenderer.invoke('desktop:space-search', String(query || '')),
    readMarkdown: (id, relativePath) => ipcRenderer.invoke('desktop:space-read-markdown', String(id || ''), String(relativePath || '')),
    writeMarkdown: (id, relativePath, content) => ipcRenderer.invoke('desktop:space-write-markdown', String(id || ''), String(relativePath || ''), String(content ?? '')),
    createMarkdown: (id, relativePath) => ipcRenderer.invoke('desktop:space-create-markdown', String(id || ''), String(relativePath || '')),
    renameMarkdown: (id, relativePath, nextRelativePath) => ipcRenderer.invoke('desktop:space-rename-markdown', String(id || ''), String(relativePath || ''), String(nextRelativePath || '')),
    removeMarkdown: (id, relativePath) => ipcRenderer.invoke('desktop:space-delete-markdown', String(id || ''), String(relativePath || '')),
    restoreMarkdown: (id, relativePath, trashId) => ipcRenderer.invoke('desktop:space-restore-markdown', String(id || ''), String(relativePath || ''), String(trashId || '')),
    readResource: (id, relativePath) => ipcRenderer.invoke('desktop:space-read-resource', String(id || ''), String(relativePath || '')),
    importResource: (id) => ipcRenderer.invoke('desktop:space-import-resource', String(id || '')),
    importResourceFile: (id, file) => ipcRenderer.invoke('desktop:space-import-resource-file', String(id || ''), webUtils.getPathForFile(file)),
    renameResource: (id, relativePath, nextRelativePath) => ipcRenderer.invoke('desktop:space-rename-resource', String(id || ''), String(relativePath || ''), String(nextRelativePath || '')),
    deleteResource: (id, relativePath) => ipcRenderer.invoke('desktop:space-delete-resource', String(id || ''), String(relativePath || '')),
  }),
  readLocalImage: (path) => ipcRenderer.invoke('desktop:read-local-image', String(path)),
  revealLocalImage: (path) => ipcRenderer.invoke('desktop:reveal-local-image', String(path)),
  screenshot: Object.freeze({
    captureSession: (options) => ipcRenderer.invoke('desktop:capture-session-screenshot', options),
  }),
  onStatus: (listener) => {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function')
    const wrapped = (_event, status) => listener(status)
    ipcRenderer.on('desktop:status', wrapped)
    return () => ipcRenderer.removeListener('desktop:status', wrapped)
  },
  onCommand: (listener) => {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function')
    const wrapped = (_event, command) => listener(String(command))
    ipcRenderer.on('desktop:command', wrapped)
    return () => ipcRenderer.removeListener('desktop:command', wrapped)
  },
  onWebNavigation: (listener) => {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function')
    const wrapped = (_event, url) => listener(String(url))
    ipcRenderer.on('desktop:web-navigation', wrapped)
    return () => ipcRenderer.removeListener('desktop:web-navigation', wrapped)
  },
  window: Object.freeze({
    minimize: () => ipcRenderer.invoke('desktop:window-minimize'),
    toggleMaximize: () => ipcRenderer.invoke('desktop:window-toggle-maximize'),
    close: () => ipcRenderer.invoke('desktop:window-close'),
    isMaximized: () => ipcRenderer.invoke('desktop:window-is-maximized'),
    showApplicationMenu: (menuId, position, state) => ipcRenderer.invoke('desktop:show-application-menu', menuId, position, state),
    onMaximizedChange: (listener) => {
      if (typeof listener !== 'function') throw new TypeError('listener must be a function')
      const wrapped = (_event, maximized) => listener(Boolean(maximized))
      ipcRenderer.on('desktop:maximized-changed', wrapped)
      return () => ipcRenderer.removeListener('desktop:maximized-changed', wrapped)
    },
  }),
}))
