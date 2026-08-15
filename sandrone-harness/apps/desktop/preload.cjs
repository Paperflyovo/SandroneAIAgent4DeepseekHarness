'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('sandroneDesktop', Object.freeze({
  platform: process.platform,
  getStatus: () => ipcRenderer.invoke('desktop:get-status'),
  restartHarness: () => ipcRenderer.invoke('desktop:restart-harness'),
  onStatus: (listener) => {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function')
    const wrapped = (_event, status) => listener(status)
    ipcRenderer.on('desktop:status', wrapped)
    return () => ipcRenderer.removeListener('desktop:status', wrapped)
  },
}))
