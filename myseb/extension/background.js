// MV3 service worker. The secret key lives here (and in a DNR rule the browser applies): the exam page's JavaScript never sees it.
const RULE_ID = 1;

async function state() { return (await chrome.storage.session.get('exam')).exam || null; }
async function setState(exam) { exam ? await chrome.storage.session.set({ exam }) : await chrome.storage.session.remove('exam'); }

async function deviceId() {
  const { device } = await chrome.storage.local.get('device');
  if (device) return device;
  const id = 'ext-' + crypto.randomUUID();
  await chrome.storage.local.set({ device: id });
  return id;
}

const hdrs = (e) => ({ 'Content-Type': 'application/json', 'X-MySEB-Key': e.token, 'X-MySEB-Client': 'extension', 'X-MySEB-Device': e.device });

async function call(e, path, body) {
  const r = await fetch(e.api + path, { method: 'POST', headers: hdrs(e), body: JSON.stringify(body || {}) });
  return { ok: r.ok, json: await r.json().catch(() => ({})) };
}

// Adds the secret headers to EVERY request the exam origin receives (pages, scripts, XHR), applied by the browser itself.
async function installRule(e, tabId) {
  const origin = new URL(e.examUrl).origin;
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [RULE_ID],
    addRules: [{
      id: RULE_ID, priority: 1,
      action: { type: 'modifyHeaders', requestHeaders: [
        { header: 'X-MySEB-Key', operation: 'set', value: e.token },
        { header: 'X-MySEB-Client', operation: 'set', value: 'extension' },
        { header: 'X-MySEB-Device', operation: 'set', value: e.device },
      ] },
      condition: { tabIds: [tabId], urlFilter: '|' + origin + '/', resourceTypes: ['main_frame', 'sub_frame', 'xmlhttprequest', 'script', 'stylesheet', 'image', 'font', 'other'] },
    }],
  });
}

async function start({ code, name, api }) {
  if (!/^https?:\/\//.test(api)) return { error: 'Enter the server address, e.g. http://localhost:4000' };
  const device = await deviceId();
  let r;
  try {
    r = await fetch(api + '/api/verify-code', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, studentName: name, deviceId: device, clientType: 'extension', platform: 'chrome' }) });
  } catch { return { error: 'Cannot reach the server.' }; }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return { error: j.error || 'Could not verify the code.' };
  const e = { api, device, token: j.token, examUrl: j.examUrl, title: j.title, status: j.status, remainingSeconds: j.remainingSeconds };
  await chrome.storage.local.set({ api, name });
  const tab = await chrome.tabs.create({ url: 'about:blank' });
  e.tabId = tab.id;
  await setState(e);
  await installRule(e, tab.id);
  await chrome.tabs.update(tab.id, { url: e.examUrl });
  heartbeatLoop();
  return { ok: true };
}

// Service workers sleep, so a plain setInterval is not enough: the page's messages keep it awake, and every
// message from content.js also triggers a beat.
let loop = null;
function heartbeatLoop() { clearInterval(loop); loop = setInterval(beat, 5000); beat(); }
async function beat() {
  const e = await state(); if (!e) { clearInterval(loop); return; }
  try {
    const r = await call(e, '/api/heartbeat');
    if (!r.ok) return;
    e.status = r.json.status; e.remainingSeconds = r.json.remainingSeconds; await setState(e);
    notifyTab(e);
    if (e.status === 'ENDED') await cleanup();
  } catch { /* offline: the server marks the student LEFT after the timeout */ }
}
function notifyTab(e) { chrome.tabs.sendMessage(e.tabId, { type: 'status', status: e.status, remainingSeconds: e.remainingSeconds }).catch(() => {}); }
async function cleanup() {
  const e = await state();
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [RULE_ID] });
  if (e) notifyTab({ ...e, status: 'ENDED' });
  await setState(null); clearInterval(loop);
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  (async () => {
    if (msg.type === 'start') return reply(await start(msg));
    const e = await state();
    // Only the exam tab may talk to us.
    if (!e || sender.tab?.id !== e.tabId) return reply({ active: false });
    if (msg.type === 'hello') return reply({ active: true, status: e.status, title: e.title, remainingSeconds: e.remainingSeconds });
    if (msg.type === 'violation') {
      const r = await call(e, '/api/violation', { type: String(msg.kind).slice(0, 40), detail: { via: 'extension' } });
      if (r.ok) { e.status = r.json.status; await setState(e); notifyTab(e); }
      return reply({ ok: r.ok });
    }
    if (msg.type === 'finish') { await call(e, '/api/finish', { reason: 'student_exit' }); await cleanup(); return reply({ ok: true }); }
  })();
  return true;
});

// Closing the exam tab is a violation too.
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const e = await state();
  if (e && e.tabId === tabId) { await call(e, '/api/violation', { type: 'close_attempt', detail: { via: 'extension', tabClosed: true } }).catch(() => {}); }
});
// So is navigating that tab away from the exam origin.
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  const e = await state();
  if (!e || e.tabId !== tabId || !info.url || info.url.startsWith('about:')) return;   // about:blank is just our own tab being set up
  if (new URL(info.url).origin !== new URL(e.examUrl).origin) {
    await call(e, '/api/violation', { type: 'leave', detail: { via: 'extension', navigatedTo: new URL(info.url).origin } }).catch(() => {});
    chrome.tabs.update(tabId, { url: e.examUrl });
  }
});
chrome.runtime.onStartup.addListener(async () => { if (await state()) heartbeatLoop(); });
