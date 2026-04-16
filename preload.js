const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  version: process.versions.electron,

  // Persistência local
  getStore: (key, def) => ipcRenderer.invoke('get-store', key, def),
  setStore: (key, val) => ipcRenderer.invoke('set-store', key, val),

  // Janelas
  openMini: () => ipcRenderer.invoke('open-mini'),
  closeMini: () => ipcRenderer.invoke('close-mini'),
  expandWindow: () => ipcRenderer.invoke('expand-window'),

  // Integração Artia
  openArtia: () => ipcRenderer.invoke('open-artia'),

  // Utilitários
  showShortcuts: () => ipcRenderer.invoke('show-shortcuts'),
  notify: (title, body) => ipcRenderer.invoke('notify', title, body),
})
