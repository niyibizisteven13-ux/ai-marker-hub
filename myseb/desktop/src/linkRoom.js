'use strict';
const {BrowserWindow, session, dialog} = require('electron');
const {randomUUID} = require('node:crypto');

const roomSessions = new WeakSet();
function allowNavigation(raw, mode, origins) {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && !url.username && !url.password &&
      (mode === 'open' || origins.has(url.origin));
  } catch { return false; }
}
function roomWindow(parent, partition) {
  const ses = session.fromPartition(partition);
  roomSessions.add(ses);
  const win = new BrowserWindow({parent, modal:true, width:1040, height:780, title:'MySEB LiveRoom',
    autoHideMenuBar:true, webPreferences:{partition, sandbox:true, contextIsolation:true, nodeIntegration:false, devTools:false}});
  win.removeMenu();
  win.webContents.setWindowOpenHandler(() => ({action:'deny'}));
  ses.setPermissionRequestHandler((_wc,_perm,done) => done(false));
  ses.setPermissionCheckHandler(() => false);
  return win;
}
function openRoom(parent, base, view) {
  const address = new URL(base.replace(/\/$/,'') + '/liveroom/');
  const hub = roomWindow(parent, 'link-room-control');
  const launchPath = address.pathname + 'launch';
  const visit = (event, raw) => {
    event.preventDefault();
    const link = new URL(raw);
    if (link.origin !== address.origin || link.pathname !== launchPath) return;
    const args = new URLSearchParams(link.hash.slice(1));
    const target = args.get('target'), mode = args.get('mode');
    if (!['open','selected','single'].includes(mode) || !allowNavigation(target,'open',new Set())) return;
    const origins = new Set([new URL(target).origin, ...(mode === 'selected' ? JSON.parse(args.get('sites')) : [])]);
    const guest = roomWindow(hub, 'link-activity-' + randomUUID());
    const allowed = url => allowNavigation(url,mode,origins);
    const contents = guest.webContents;
    // Filter every top-level request, including server redirects and programmatic navigations.
    contents.session.webRequest.onBeforeRequest((d, cb) => cb({cancel:d.resourceType === 'mainFrame' && !allowed(d.url)}));
    contents.on('will-navigate',(e,url) => { if (!allowed(url)) e.preventDefault(); });
    contents.setWindowOpenHandler(({url}) => {
      if (allowed(url)) contents.loadURL(url).catch(() => {});
      return {action:'deny'};
    });
    contents.on('did-fail-load', (_e,code,_desc,_url,mainFrame) => {
      if (mainFrame && code !== -3 && !guest.isDestroyed()) dialog.showMessageBox(guest,{message:'This page could not open. Check the room settings or ask the host for a compatible link.'});
    });
    guest.loadURL(target).catch(() => {});
  };
  hub.webContents.on('will-navigate',visit);
  hub.webContents.on('will-redirect',event => event.preventDefault());
  address.search = new URLSearchParams({client:'app',view}).toString();
  hub.loadURL(address.href).catch(() => { if (!hub.isDestroyed()) dialog.showMessageBox(hub,{message:'Cannot reach MySEB LiveRoom. Check the server address and connection.'}); });
  return hub;
}
module.exports = {openRoom, roomSessions};
