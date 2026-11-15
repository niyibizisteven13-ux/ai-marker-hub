'use strict';
const { postFollowingRedirects } = require('./post');
const { app, BrowserWindow, Menu, ipcMain, session, clipboard, screen, desktopCapturer } = require('electron');
const { execFile } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const DEV = process.env.MYSEB_DEV === '1';          // dev: windowed, devtools allowed. NEVER ship with this set.
const VERSION = '1.0.0';
const BLUR_LIMIT_MS = 1500;
const PARTITION = 'myseb-exam';                      // in-memory: nothing from an exam survives the app

/* ------------------------------------------------------------------ other apps and screens */
// Programs that show the exam to someone else or record it. Matched on the exact program name (no .exe). Add more in config.json "blockedProcesses".
// Zoom/Teams are NOT listed: many lecturers proctor with them. Add them in config.json if you do not.
const DEFAULT_BLOCKED = ['teamviewer', 'teamviewer_service', 'anydesk', 'rustdesk', 'ultraviewer', 'parsec', 'parsecd', 'vncviewer', 'vncserver', 'winvnc', 'tightvnc',
  'remoting_host', 'obs', 'obs64', 'obs-studio', 'bandicam', 'camtasia', 'snagit32', 'snagiteditor', 'sharex', 'screenrec', 'quickassist', 'msra', 'mstsc'];

function runningPrograms() {
  return new Promise((resolve) => {
    const win = process.platform === 'win32';
    execFile(win ? 'tasklist' : 'ps', win ? ['/fo', 'csv', '/nh'] : ['-A', '-o', 'comm='], { timeout: 6000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, out) => {
      if (err) return resolve([]);
      const names = String(out).split('\n').map((l) => (win ? (l.match(/^"([^"]+)"/) || [])[1] : l.trim()) || '')
        .map((n) => n.split(/[\\/]/).pop().replace(/\.exe$/i, '').toLowerCase()).filter(Boolean);
      resolve(names);
    });
  });
}
async function checkEnvironment() {
  if (!exam || exam.status === 'ENDED') return;
  if (screen.getAllDisplays().length > 1) sendViolation('extra_display', { displays: screen.getAllDisplays().length });
  const bad = (await runningPrograms()).filter((n) => cfg.blockedProcesses.includes(n));
  if (bad.length) sendViolation('forbidden_app', { apps: [...new Set(bad)].slice(0, 5) });
}

/* ------------------------------------------------------------------ config + identity */
function loadConfig() {
  let cfg = {};
  for (const p of [path.join(__dirname, '..', 'config.json'), path.join(app.getPath('userData'), 'config.json')]) {
    try { cfg = { ...cfg, ...JSON.parse(fs.readFileSync(p, 'utf8')) }; } catch { /* optional */ }
  }
  if (process.env.MYSEB_API) cfg.apiBase = process.env.MYSEB_API;
  cfg.blockedProcesses = [...new Set([...DEFAULT_BLOCKED, ...(Array.isArray(cfg.blockedProcesses) ? cfg.blockedProcesses : [])].map((x) => String(x).toLowerCase()))];
  cfg.apiBase = String(cfg.apiBase || 'http://localhost:4000').replace(/\/$/, '');
  return cfg;
}
function deviceId() {
  const f = path.join(app.getPath('userData'), 'device.json');
  try { return JSON.parse(fs.readFileSync(f, 'utf8')).id; } catch { /* first run */ }
  const id = 'desk-' + crypto.randomUUID();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify({ id }));
  return id;
}

/* ------------------------------------------------------------------ state (the token lives ONLY here, in the main process) */
let cfg, DEVICE, win;
let exam = null;            // { token, sessionId, examOrigin, title, status }
let allowQuit = false;
let hbTimer = null, hbFails = 0, blurTimer = null;
const lastSent = new Map();
let fileGraceUntil = 0;     // a system file dialog is open (hand-ins): it is not 'leaving'
let watchTimer = null;

const headersFor = () => ({
  'Content-Type': 'application/json',
  'X-MySEB-Key': exam.token, 'X-MySEB-Client': 'desktop', 'X-MySEB-Device': DEVICE,
  'User-Agent': `MySEB/${VERSION} (desktop; ${process.platform})`,
});
const originOf = (u) => { try { return new URL(u).origin; } catch { return null; } };
const toRenderer = (ch, payload) => { if (win && !win.isDestroyed()) win.webContents.send(ch, payload); };

/* ------------------------------------------------------------------ server calls */
async function post(pathname, body, { auth = true } = {}) {
  const { res, base } = await postFollowingRedirects(fetch, cfg.apiBase, pathname, {
    method: 'POST', body: JSON.stringify(body ?? {}), signal: AbortSignal.timeout(8000),
    headers: auth ? headersFor() : { 'Content-Type': 'application/json', 'User-Agent': `MySEB/${VERSION} (desktop)` },
  });
  cfg.apiBase = base;   // the site moved (www or not): talk to the right address from now on
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

function applyStatus(s) {
  if (!exam) return;
  exam.status = s.status;
  toRenderer('status', { status: s.status, reason: s.reason ?? null, remainingSeconds: s.remainingSeconds ?? null, offline: false });
  if (s.status === 'ENDED') stopExam();
}

async function sendViolation(type, detail = {}) {
  if (!exam || exam.status === 'ENDED') return;
  const now = Date.now();
  if (now - (lastSent.get(type) || 0) < 1000) return;      // one per second per kind: key-repeat must not flood the log
  lastSent.set(type, now);
  try {
    const r = await post('/api/violation', { type, detail });
    if (r.ok) applyStatus({ status: r.json.status, reason: r.json.reason });
  } catch { /* the heartbeat will report us missing if we are really offline */ }
}

async function heartbeat() {
  if (!exam) return;
  try {
    const r = await post('/api/heartbeat');
    if (!r.ok) throw new Error('hb ' + r.status);
    hbFails = 0;
    applyStatus(r.json);
  } catch {
    if (++hbFails >= 2) toRenderer('status', { status: exam?.status, offline: true });
  }
}

function startExam(data) {
  exam = { token: data.token, sessionId: data.sessionId, title: data.title, status: data.status, examOrigin: originOf(data.examUrl) };
  clipboard.clear();                                       // nothing copied before the exam can be pasted into it
  hbFails = 0;
  clearInterval(hbTimer);
  hbTimer = setInterval(heartbeat, (data.heartbeatSeconds || 5) * 1000);
  clearInterval(watchTimer); watchTimer = setInterval(checkEnvironment, 20000); checkEnvironment();
}
function stopExam() { clearInterval(watchTimer); clearInterval(hbTimer); clearTimeout(blurTimer); hbTimer = null; exam = null; }

/* ------------------------------------------------------------------ keyboard rules (every web contents, incl. the exam <webview>) */
function blockedKey(input) {
  const k = String(input.key || '');
  const key = k.toLowerCase();
  const ctrl = input.control || input.meta;
  if (input.alt && (key === 'f4' || key === 'tab' || key === 'escape')) return 'shortcut';
  if (ctrl && ['t', 'n', 'w', 'p', 's', 'u', 'o', 'l', 'd', 'h', 'j', 'tab', 'pageup', 'pagedown'].includes(key)) return 'shortcut';
  if (ctrl && input.shift && ['i', 'j', 'c', 'n', 't', 'w', 'delete', 'p'].includes(key)) return 'devtools';
  if (key === 'f12') return 'devtools';
  if (['f11', 'f10', 'f1', 'f3', 'f6', 'f7'].includes(key)) return 'shortcut';
  if (ctrl && ['c', 'x', 'v', 'insert'].includes(key)) return key === 'x' ? 'cut' : key === 'v' ? 'paste' : 'copy';
  if (input.shift && (key === 'insert' || key === 'delete')) return key === 'insert' ? 'paste' : 'cut';
  if (key === 'printscreen' || key === 'snapshot') return 'screenshot';
  if (input.meta && input.shift && key === 's') return 'screenshot';   // Win+Shift+S, Cmd+Shift+3/4 are OS-level: see docs/SECURITY
  return null;
}
function guardInput(contents) {
  contents.on('before-input-event', (event, input) => {
    const why = blockedKey(input);
    if (!why) return;
    event.preventDefault();
    if (why === 'screenshot') clipboard.clear();
    if (input.type === 'keyDown' || why === 'screenshot') sendViolation(why, { key: input.key });
  });
}

const HOOK = `(()=>{if(window.__mysebHook)return;window.__mysebHook=1;
const log=t=>console.log('__MYSEB__'+t);
for(const t of ['copy','cut','paste'])document.addEventListener(t,e=>{e.preventDefault();log(t)},true);
document.addEventListener('contextmenu',e=>e.preventDefault(),true);
document.addEventListener('dragstart',e=>e.preventDefault(),true);
document.addEventListener('click',e=>{const t=e.target;if(t&&t.tagName==='INPUT'&&t.type==='file')log('file_open')},true);
document.addEventListener('visibilitychange',()=>{if(document.hidden)log('visibility_hidden')});})();`;
const CSS = '*{-webkit-user-select:none!important;user-select:none!important}input,textarea,[contenteditable="true"]{-webkit-user-select:text!important;user-select:text!important}';

function lockGuest(wc) {
  const allowed = (url) => /^(about:|data:|blob:)/.test(url) || (exam && originOf(url) === exam.examOrigin);
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));       // no pop-ups, no new windows/tabs
  wc.on('will-navigate', (e, url) => { if (!allowed(url)) e.preventDefault(); });
  wc.on('will-frame-navigate', (e) => { if (e.isMainFrame && !allowed(e.url)) e.preventDefault(); });
  wc.on('context-menu', (e) => e.preventDefault());           // right-click
  wc.on('dom-ready', () => { wc.executeJavaScript(HOOK).catch(() => {}); wc.insertCSS(CSS).catch(() => {}); });
  wc.on('console-message', (...a) => {
    const msg = typeof a[0]?.message === 'string' ? a[0].message : a[2];   // Electron >=35 passes one event object
    if (typeof msg === 'string' && msg.startsWith('__MYSEB__')) {
      const t = msg.slice(9);
      if (t === 'file_open') fileGraceUntil = Date.now() + 45000;   // choosing a file to hand in opens a system dialog: allow 45 s
      else if (['copy', 'cut', 'paste', 'visibility_hidden'].includes(t)) sendViolation(t, { via: 'page' });
    }
  });
}

/* ------------------------------------------------------------------ the one window */
function createWindow() {
  win = new BrowserWindow({
    icon: path.join(__dirname, '..', 'renderer', 'icon.png'),
    fullscreen: !DEV, kiosk: !DEV, frame: false, autoHideMenuBar: true,
    alwaysOnTop: !DEV, skipTaskbar: false, show: false, backgroundColor: '#0f172a',
    minimizable: false, maximizable: false, closable: true, resizable: DEV,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      webviewTag: true, devTools: DEV, spellcheck: false,
    },
  });
  Menu.setApplicationMenu(null);
  win.setMenuBarVisibility(false);
  if (!DEV) { win.setAlwaysOnTop(true, 'screen-saver'); win.setContentProtection(true); }  // screenshots / screen-share show black
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());

  // Leaving the window for more than 1.5s is a violation (Alt+Tab, Win key, another window taking focus).
  // A glance shorter than that is not reported. After reporting we pull focus back, and keep pulling while it is away.
  const regain = () => { if (win && !win.isDestroyed() && !win.isFocused()) { win.show(); win.focus(); win.moveTop(); } };
  win.on('blur', () => {
    if (!exam || exam.status === 'ENDED') return;
    clearTimeout(blurTimer);
    const arm = (ms) => { blurTimer = setTimeout(() => {
      if (!win || win.isFocused()) return;
      if (Date.now() < fileGraceUntil) return arm(fileGraceUntil - Date.now() + 50);   // a file dialog is open: look again when the allowance ends
      sendViolation('leave', { thresholdMs: BLUR_LIMIT_MS });
      regain();
    }, ms); };
    arm(BLUR_LIMIT_MS);
  });
  setInterval(() => { if (exam && exam.status !== 'ENDED' && !DEV && Date.now() >= fileGraceUntil) regain(); }, 1000).unref();
  screen.on('display-added', () => { if (exam) checkEnvironment(); });
  win.on('focus', () => clearTimeout(blurTimer));
  win.on('minimize', () => { if (exam) { win.restore(); sendViolation('leave', { how: 'minimize' }); } });
  win.on('leave-full-screen', () => { if (!DEV && exam) { win.setFullScreen(true); sendViolation('fullscreen_exit'); } });

  win.on('close', (e) => {
    if (allowQuit) return;
    e.preventDefault();
    if (exam && exam.status !== 'ENDED') { sendViolation('close_attempt'); toRenderer('close-attempt'); }  // renderer shows "Are you sure? Exam will end"
    else toRenderer('close-attempt');
  });
}

/* ------------------------------------------------------------------ IPC (the renderer never sees the token) */
ipcMain.handle('info', () => ({ apiBase: cfg.apiBase, version: VERSION, dev: DEV }));

ipcMain.handle('verify', async (_e, { code, name }) => {
  if (typeof code !== 'string' || typeof name !== 'string') return { error: 'Enter your name and code.' };
  try {
    const r = await post('/api/verify-code', {
      code, studentName: name, deviceId: DEVICE, clientType: 'desktop', platform: process.platform,
    }, { auth: false });
    if (!r.ok) return { error: r.json.error || 'Could not verify the code.' };
    startExam(r.json);
    return { title: r.json.title, examUrl: r.json.examUrl, status: r.json.status, remainingSeconds: r.json.remainingSeconds };
  } catch { return { error: 'Cannot reach the exam server. Check your internet and the server address.' }; }
});

ipcMain.handle('confirm-exit', async () => {
  if (exam) { try { await post('/api/finish', { reason: 'student_exit' }); } catch { /* server marks us LEFT/ended anyway */ } stopExam(); }
  allowQuit = true; app.quit();
});
ipcMain.handle('quit-idle', () => { if (!exam) { allowQuit = true; app.quit(); } });

/* ------------------------------------------------------------------ app lifecycle */
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (win) { win.show(); win.focus(); } });

app.on('web-contents-created', (_e, contents) => {
  guardInput(contents);
  if (!DEV) contents.on('devtools-opened', () => contents.closeDevTools());
  contents.on('will-attach-webview', (ev, prefs, params) => {
    // Only the exam site, only in our partition, with no preload and no Node.
    delete prefs.preload;
    Object.assign(prefs, { nodeIntegration: false, contextIsolation: true, sandbox: true, devTools: DEV, webSecurity: true });
    params.partition = PARTITION; params.allowpopups = false;
    if (!exam || originOf(params.src) !== exam.examOrigin) ev.preventDefault();
  });
  if (contents.getType() === 'webview') lockGuest(contents);
});

app.whenReady().then(() => {
  cfg = loadConfig(); DEVICE = deviceId();
  const ses = session.fromPartition(PARTITION);
  ses.setUserAgent(`${ses.getUserAgent()} MySEB/${VERSION} (desktop; ${process.platform})`);   // normal Chrome does not send this
  // The secret header goes on every request to the exam site, added here in the main process: page JavaScript can never read it.
  ses.webRequest.onBeforeSendHeaders({ urls: ['<all_urls>'] }, (details, cb) => {
    const h = details.requestHeaders;
    if (exam && originOf(details.url) === exam.examOrigin) {
      h['X-MySEB-Key'] = exam.token; h['X-MySEB-Client'] = 'desktop'; h['X-MySEB-Device'] = DEVICE;
    }
    cb({ requestHeaders: h });
  });
  ses.setPermissionRequestHandler((wc, perm, cb) => cb(['media', 'fullscreen'].includes(perm) && !!exam && originOf(wc.getURL()) === exam.examOrigin));
  // Sharing the screen with the lecturer: when the exam page asks, the whole main screen is shared at once, with no picker, so a
  // student cannot choose a smaller window to show. Only the exam site can ask. While the screen is shared the lecturer is watching,
  // so the "screenshots show black" protection is lifted, otherwise the lecturer would see a black rectangle where the exam is.
  ses.setDisplayMediaRequestHandler((request, cb) => {
    if (!exam || !request.frame || originOf(request.frame.url) !== exam.examOrigin) return cb({});
    desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } }).then((sources) => {
      const primary = screen.getPrimaryDisplay();
      const src = sources.find((x) => x.display_id === String(primary.id)) || sources[0];
      if (!src) return cb({});
      try { win && win.setContentProtection(false); } catch { /* window is gone */ }
      cb({ video: src });
    }).catch(() => cb({}));
  }, { useSystemPicker: false });
  createWindow();
});
app.on('window-all-closed', () => app.quit());
