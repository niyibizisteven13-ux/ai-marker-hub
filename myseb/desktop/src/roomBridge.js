'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('roomDesktop', {
  apply: (policy) => ipcRenderer.invoke('room-policy', policy),
  finish: () => ipcRenderer.invoke('room-finish')
});
ipcRenderer.on('room-expired', () =>
  window.dispatchEvent(new Event('room-expired'))
);
ipcRenderer.on('room-load-error', () =>
  window.dispatchEvent(new Event('room-load-error'))
);
