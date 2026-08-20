'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('sandroneDesktop', Object.freeze({
  platform: process.platform,
  getStatus: () => ipcRenderer.invoke('desktop:get-status'),
  restartHarness: () => ipcRenderer.invoke('desktop:restart-harness'),
  getGpuAcceleration: () => ipcRenderer.invoke('desktop:get-gpu-acceleration'),
  setGpuAcceleration: (value) => ipcRenderer.invoke('desktop:set-gpu-acceleration', Boolean(value)),
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
  window: Object.freeze({
    minimize: () => ipcRenderer.invoke('desktop:window-minimize'),
    toggleMaximize: () => ipcRenderer.invoke('desktop:window-toggle-maximize'),
    close: () => ipcRenderer.invoke('desktop:window-close'),
    isMaximized: () => ipcRenderer.invoke('desktop:window-is-maximized'),
    showApplicationMenu: (menuId, position) => ipcRenderer.invoke('desktop:show-application-menu', menuId, position),
    onMaximizedChange: (listener) => {
      if (typeof listener !== 'function') throw new TypeError('listener must be a function')
      const wrapped = (_event, maximized) => listener(Boolean(maximized))
      ipcRenderer.on('desktop:maximized-changed', wrapped)
      return () => ipcRenderer.removeListener('desktop:maximized-changed', wrapped)
    },
  }),
}))
