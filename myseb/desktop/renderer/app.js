'use strict';
const $ = (id) => document.getElementById(id);
let deadline = 0, tick = null, ended = false, paused = false, closing = false;

function overlay(title, text, buttons = []) {
  $('oTitle').textContent = title; $('oText').textContent = text;
  $('oBtns').replaceChildren(...buttons.map(([label, cls, fn]) => { const b = document.createElement('button'); b.textContent = label; b.className = cls || ''; b.onclick = fn; return b; }));
  $('overlay').hidden = false;
}
const hideOverlay = () => { $('overlay').hidden = true; };

function showTimer() {
  const s = Math.max(0, Math.round((deadline - Date.now()) / 1000));
  $('timer').textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('err').textContent = ''; $('go').disabled = true; $('go').textContent = 'Checking…';
  const r = await window.myseb.verify($('code').value, $('name').value);
  $('go').disabled = false; $('go').textContent = 'Start exam';
  if (r.error) { $('err').textContent = r.error; return; }
  $('title').textContent = r.title;
  deadline = Date.now() + r.remainingSeconds * 1000; showTimer(); clearInterval(tick); tick = setInterval(showTimer, 1000);
  $('start').hidden = true; $('examView').hidden = false;
  $('wv').src = r.examUrl;                    // the main process adds the secret header; nothing secret is here
  if (r.status !== 'IN_EXAM') onStatus({ status: r.status });
});

function onStatus(s) {
  if (ended) return;
  if (s.remainingSeconds != null) deadline = Date.now() + s.remainingSeconds * 1000;
  $('dot').className = s.status === 'IN_EXAM' && !s.offline ? '' : 'bad';
  if (s.status === 'ENDED') {
    ended = true; $('wv').remove(); clearInterval(tick);
    overlay('Exam finished', s.reason === 'time_up' ? 'Time is up.' : 'Your exam has ended. You can close MySEB now.', [['Exit MySEB', 'primary', () => window.myseb.confirmExit()]]);
  } else if (s.offline) {
    closing = false;
    overlay('Connection lost', 'Trying to reconnect… Stay on this screen. Your teacher can see you are offline.');
  } else if (s.status === 'PAUSED' || s.status === 'LEFT') {
    paused = true; closing = false;
    overlay('Exam paused', 'You left the exam screen, so your teacher has been notified. Wait for them to let you continue.');
  } else if (s.status === 'IN_EXAM') {
    if (paused) $('wv').reload();             // pick up exactly where the exam page is
    const wasPaused = paused; paused = false;
    if (!closing || wasPaused) { closing = false; hideOverlay(); }   // a heartbeat must not dismiss the "Are you sure?" prompt
  }
}
// A link from the lecturer: fill in the code and name and start (only on the start screen, never during a test).
function applyJoin(j) {
  if (!j || ended || !$('examView').hidden) return;
  $('code').value = String(j.code || ''); if (j.name) $('name').value = j.name;
  if (j.code && j.name) $('form').requestSubmit(); else (j.name ? $('code') : $('name')).focus();
}
window.myseb.onJoinLink(applyJoin);
window.myseb.pendingJoin().then(applyJoin).catch(() => undefined);
window.myseb.onStatus(onStatus);
window.myseb.onNotice((n) => { if (!ended) overlay(String(n.title || ''), String(n.text || ''), [['OK', 'primary', () => { if (!paused && !closing) hideOverlay(); }]]); });

window.myseb.onCloseAttempt(() => {
  if (ended) return window.myseb.confirmExit();
  if ($('examView').hidden) return window.myseb.quitIdle();
  closing = true;
  overlay('Are you sure?', 'Exam will end. You will not be able to come back in.', [
    ['Keep taking the exam', 'primary', () => { closing = false; if (!paused && !ended) hideOverlay(); }],
    ['End my exam', 'danger', () => window.myseb.confirmExit()],
  ]);
});
$('quitIdle').onclick = () => window.myseb.quitIdle();
