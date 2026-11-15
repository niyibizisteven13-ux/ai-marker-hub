// Runs on every page but does nothing unless the background says THIS tab is the exam tab.
(async () => {
  let info;
  try { info = await chrome.runtime.sendMessage({ type: 'hello' }); } catch { return; }
  if (!info?.active) return;

  const report = (kind) => { chrome.runtime.sendMessage({ type: 'violation', kind }).catch(() => {}); };

  /* ---------- banner (always visible) ---------- */
  const banner = document.createElement('div');
  banner.setAttribute('style', 'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#92400e;color:#fef3c7;font:13px system-ui;padding:6px 10px;text-align:center');
  banner.textContent = 'You are in MySEB Extension Mode - For full security use Desktop App';
  const mount = () => document.documentElement.appendChild(banner);
  document.documentElement ? mount() : document.addEventListener('DOMContentLoaded', mount);

  /* ---------- lock overlay (paused / ended) ---------- */
  const lock = document.createElement('div');
  lock.setAttribute('style', 'position:fixed;inset:0;z-index:2147483646;background:#020617f2;color:#e2e8f0;font:20px system-ui;display:none;place-items:center;text-align:center');
  const lockText = document.createElement('div'); lock.appendChild(lockText);
  document.documentElement.appendChild(lock);
  const show = (status) => {
    if (status === 'IN_EXAM') { if (lock.style.display !== 'none') { lock.style.display = 'none'; location.reload(); } return; }
    lockText.textContent = status === 'ENDED' ? 'Exam finished. You can close this tab.' : 'Exam paused. Wait for your teacher to let you continue.';
    lock.style.display = 'grid';
  };
  show(info.status);
  chrome.runtime.onMessage.addListener((m) => { if (m.type === 'status') show(m.status); });

  /* ---------- full screen ---------- */
  const goFull = () => { if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {}); };
  document.addEventListener('click', goFull, { once: false });       // browsers only allow it from a user gesture
  document.addEventListener('keydown', goFull, { once: false });
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) report('fullscreen_exit'); });

  /* ---------- blocked keys ---------- */
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase(); const ctrl = e.ctrlKey || e.metaKey;
    const bad = (ctrl && ['t', 'w', 'p', 'n', 's', 'u'].includes(k)) || k === 'f12' || (ctrl && e.shiftKey && ['i', 'j', 'c'].includes(k)) || (e.altKey && k === 'f4');
    if (bad) { e.preventDefault(); e.stopImmediatePropagation(); report(k === 'f12' || e.shiftKey ? 'devtools' : 'shortcut'); }
    if (ctrl && ['c', 'x', 'v'].includes(k)) { e.preventDefault(); report(k === 'c' ? 'copy' : k === 'v' ? 'paste' : 'cut'); }
    if (e.key === 'PrintScreen') { navigator.clipboard?.writeText('').catch(() => {}); report('screenshot'); }
  }, true);
  for (const t of ['copy', 'cut', 'paste']) document.addEventListener(t, (e) => { e.preventDefault(); report(t); }, true);
  document.addEventListener('contextmenu', (e) => e.preventDefault(), true);
  // Ctrl+T / Ctrl+W / Ctrl+N are reserved by Chrome and may never reach the page: leaving the tab is caught below.

  /* ---------- leaving ---------- */
  let hiddenTimer = null;
  document.addEventListener('visibilitychange', () => {
    clearTimeout(hiddenTimer);
    if (document.hidden) hiddenTimer = setTimeout(() => report('visibility_hidden'), 1500);   // hidden > 1.5 s
  });
  let blurTimer = null;
  window.addEventListener('blur', () => { clearTimeout(blurTimer); blurTimer = setTimeout(() => { if (!document.hasFocus() && !document.hidden) report('blur'); }, 1500); });
  window.addEventListener('focus', () => clearTimeout(blurTimer));
  window.addEventListener('beforeunload', (e) => { e.preventDefault(); e.returnValue = ''; });
})();
