'use strict';
// The only bridge between our own UI and the main process. Note what is NOT here: the token, or any way to send a request.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('myseb', {
  checkUpdate: () => ipcRenderer.invoke('update-check'),
  downloadUpdate: () => ipcRenderer.invoke('update-download'),
  installUpdate: () => ipcRenderer.invoke('update-install'),
  onUpdate: (cb) => ipcRenderer.on('app-update', (_e, s) => cb(s)),
  info: () => ipcRenderer.invoke('info'),
  verify: (code, name) => ipcRenderer.invoke('verify', { code, name }),
  confirmExit: () => ipcRenderer.invoke('confirm-exit'),
  quitIdle: () => ipcRenderer.invoke('quit-idle'),
  onStatus: (cb) => ipcRenderer.on('status', (_e, s) => cb(s)),
  pendingJoin: () => ipcRenderer.invoke('pending-join'),
  onJoinLink: (cb) => ipcRenderer.on('join-link', (_e, j) => cb(j)),
  onNotice: (cb) => ipcRenderer.on('notice', (_e, n) => cb(n)),
  onCloseAttempt: (cb) => ipcRenderer.on('close-attempt', () => cb()),
});
