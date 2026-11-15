'use strict';
// The only bridge between our own UI and the main process. Note what is NOT here: the token, or any way to send a request.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('myseb', {
  info: () => ipcRenderer.invoke('info'),
  verify: (code, name) => ipcRenderer.invoke('verify', { code, name }),
  confirmExit: () => ipcRenderer.invoke('confirm-exit'),
  quitIdle: () => ipcRenderer.invoke('quit-idle'),
  onStatus: (cb) => ipcRenderer.on('status', (_e, s) => cb(s)),
  onCloseAttempt: (cb) => ipcRenderer.on('close-attempt', () => cb()),
});
