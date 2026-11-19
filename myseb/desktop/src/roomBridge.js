'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('roomDesktop', {
  onSite: (cb) => ipcRenderer.on('room-site', (_event, site) => cb(site)),
  apply: (policy) => ipcRenderer.invoke('room-policy', policy),
  finish: () => ipcRenderer.invoke('room-finish')
});
ipcRenderer.on('room-expired', () =>
  window.dispatchEvent(new Event('room-expired'))
);
ipcRenderer.on('room-load-error', () =>
  window.dispatchEvent(new Event('room-load-error'))
);
