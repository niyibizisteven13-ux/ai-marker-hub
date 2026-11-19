'use strict';
const {
  BrowserWindow,
  WebContentsView,
  ipcMain,
  session
} = require('electron');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { permitted } = require('./roomPolicy');
const { roomSessions } = require('./linkRoom');
const rooms = new Map();
const toolbar = 168;

function closeActivity(room) {
  clearTimeout(room.expiry);
  if (room.view) {
    room.win.contentView.removeChildView(room.view);
    room.view.webContents.close();
    room.view = null;
  }
}
function resize(room) {
  if (!room.view) return;
  const [width, height] = room.win.getContentSize();
  room.view.setBounds({
    x: 0,
    y: toolbar,
    width,
    height: Math.max(0, height - toolbar)
  });
}
function trusted(event) {
  const room = rooms.get(event.sender.id);
  if (
    !room ||
    event.senderFrame !== event.sender.mainFrame ||
    event.sender.getURL() !== room.address
  )
    throw Error('Room unavailable');
  return room;
}
ipcMain.handle('room-finish', (event) => closeActivity(trusted(event)));
ipcMain.handle('room-policy', (event, p) => {
  const room = trusted(event);
  if (
    !p ||
    !['single', 'selected', 'open'].includes(p.mode) ||
    !Array.isArray(p.origins) ||
    !permitted(p.url, p) ||
    !Number.isFinite(p.remainingMs) ||
    p.remainingMs <= 0 ||
    p.remainingMs > 86401000
  )
    throw Error('Invalid room policy');
  closeActivity(room);
  const ses = session.fromPartition('room-activity-' + randomUUID());
  roomSessions.add(ses);
  ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  ses.setPermissionCheckHandler(() => false);
  ses.on('will-download', (e) => e.preventDefault());
  const allowed = (url) => permitted(url, p);
  ses.webRequest.onBeforeRequest((request, done) => {
    const navigation = ['mainFrame', 'subFrame'].includes(request.resourceType);
    done({ cancel: navigation && !allowed(request.url) });
  });
  const view = new WebContentsView({
    webPreferences: {
      session: ses,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      devTools: false,
      webviewTag: false
    }
  });
  room.view = view;
  room.win.contentView.addChildView(view);
  resize(room);
  const wc = view.webContents;
  wc.on('did-navigate', (_event, url) => {
    if (room.view === view && permitted(url, p))
      room.win.webContents.send('room-site', new URL(url).origin);
  });
  wc.setWindowOpenHandler(({ url }) => {
    if (allowed(url)) wc.loadURL(url).catch(() => {});
    return { action: 'deny' };
  });
  wc.on('will-frame-navigate', (e) => {
    if (!allowed(e.url)) e.preventDefault();
  });
  wc.on('will-redirect', (e, url) => {
    if (!allowed(url)) e.preventDefault();
  });
  wc.on('did-fail-load', (_e, code, _message, _url, main) => {
    if (main && code !== -3 && room.view === view)
      room.win.webContents.send('room-load-error');
  });
  wc.loadURL(p.url).catch(() => {});
  room.expiry = setTimeout(() => {
    closeActivity(room);
    room.win.webContents.send('room-expired');
  }, p.remainingMs);
});
function openManagedRoom(parent, base) {
  const address = base.replace(/\/$/, '') + '/room/';
  const ses = session.fromPartition('room-host-control');
  roomSessions.add(ses);
  const win = new BrowserWindow({
    parent,
    modal: true,
    width: 1200,
    height: 820,
    autoHideMenuBar: true,
    webPreferences: {
      backgroundThrottling: false,
      session: ses,
      preload: path.join(__dirname, 'roomBridge.js'),
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
      devTools: false
    }
  });
  win.removeMenu();
  const room = { address, win, view: null };
  const id = win.webContents.id;
  rooms.set(id, room);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== address) e.preventDefault();
  });
  win.webContents.on('will-redirect', (e) => e.preventDefault());
  win.on('resize', () => resize(room));
  win.on('close', (e) => {
    if (room.view) e.preventDefault();
  });
  win.on('closed', () => {
    clearTimeout(room.expiry);
    rooms.delete(id);
  });
  win.loadURL(address).catch(() => {
    if (!win.isDestroyed())
      require('electron').dialog.showMessageBox(win, {
        message: 'Cannot reach the Room app. Check your server connection.'
      });
  });
  return win;
}
module.exports = { openManagedRoom };
