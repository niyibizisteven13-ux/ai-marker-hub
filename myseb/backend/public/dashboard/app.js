// All text from the server (student names, exam titles) goes in with textContent, never innerHTML.
// When MySEB runs inside another server it lives under a prefix such as /myseb; the dashboard works out where it is.
const BASE = location.pathname.replace(/\/dashboard\/?.*$/, '');
const $ = (id) => document.getElementById(id);
let KEY = sessionStorage.getItem('myseb_teacher_key') || '';
let current = null, timer = null;

async function api(path, opts = {}) {
  const r = await fetch(BASE + '/api' + path, {
    ...opts, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + KEY, ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401) { signOut(); throw new Error('Signed out'); }
  if (!r.ok) throw new Error(data.error || 'Request failed');
  return data;
}
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  kids.forEach((k) => n.append(k)); return n;
};

function signOut() { KEY = ''; sessionStorage.removeItem('myseb_teacher_key'); clearInterval(timer); show(false); }
function show(on) { $('login').hidden = on; $('app').hidden = !on; $('logout').hidden = !on; if (on) loadExams(); }
$('logout').onclick = signOut;
$('loginBtn').onclick = async () => {
  KEY = $('key').value;
  try { await api('/teacher/login', { method: 'POST' }); sessionStorage.setItem('myseb_teacher_key', KEY); $('loginErr').textContent = ''; show(true); }
  catch (e) { $('loginErr').textContent = 'Wrong key.'; KEY = ''; }
};
$('key').addEventListener('keydown', (e) => e.key === 'Enter' && $('loginBtn').click());

// A pasted form link: say what MySEB makes of it (provider, sites the student may use, how a submission is noticed) and what the teacher should set in the form.
let analyzeTimer = null, formSendKeyDefault = false;
$('examUrl').addEventListener('input', () => {
  clearTimeout(analyzeTimer); const url = $('examUrl').value.trim();
  if (!url) { $('formInfo').hidden = true; return; }
  analyzeTimer = setTimeout(async () => {
    try {
      const a = await api('/forms/analyze?url=' + encodeURIComponent(url));
      $('formInfo').hidden = false; formSendKeyDefault = a.sendKey;
      $('formWhat').textContent = a.provider.id === 'myseb' ? 'An exam site that checks MySEB itself.' : `${a.provider.name} detected. Students will be locked to it.`;
      $('formSites').textContent = 'Students can only open: ' + a.origins.map((o) => o.replace('https://', '')).join(', ') + (a.done.length ? '. The exam ends by itself when the address contains ' + a.done.join(' or ') : '. Students press "I have submitted" when they finish');
      $('formTips').replaceChildren(...a.tips.map((t) => el('li', { textContent: t })));
      $('formKeyHint').textContent = a.keyHint;
      $('newExam').elements.sendKey.checked = a.sendKey;
    } catch (err) { $('formInfo').hidden = false; $('formWhat').textContent = err.message; $('formSites').textContent = ''; $('formTips').replaceChildren(); }
  }, 450);
});

$('newExam').onsubmit = async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    await api('/exams', { method: 'POST', body: {
      title: f.get('title'), examUrl: f.get('examUrl'), durationMinutes: f.get('durationMinutes'), leaveAction: f.get('leaveAction'),
      requireMyseb: f.has('requireMyseb'), allowExtension: f.has('allowExtension'),
      ...(f.get('examUrl') ? { extraOrigins: String(f.get('extraOrigins') || ''), doneContains: String(f.get('doneContains') || '').split('\n').filter(Boolean), keyParam: String(f.get('keyParam') || ''), sendKey: f.has('sendKey') } : {}) } });
    e.target.reset(); $('formInfo').hidden = true; loadExams();
  } catch (err) { alert(err.message); }
};

async function loadExams() {
  const list = await api('/exams');
  const box = $('exams'); box.replaceChildren();
  if (!list.length) box.append(el('p', { className: 'muted', textContent: 'No exams yet. Create one above.' }));
  for (const ex of list) {
    const req = el('input', { type: 'checkbox', checked: ex.require_myseb });
    req.onchange = async () => { try { await api('/exams/' + ex.id, { method: 'PATCH', body: { requireMyseb: req.checked } }); } catch (e) { alert(e.message); req.checked = !req.checked; } };
    const gen = el('button', { className: 'primary', textContent: 'Generate Code', disabled: ex.status === 'ended' });
    gen.onclick = () => generate(ex);
    const mon = el('button', { textContent: 'Live monitor' }); mon.onclick = () => monitor(ex);
    const end = el('button', { className: 'danger', textContent: 'End exam', disabled: ex.status === 'ended' });
    end.onclick = async () => { if (confirm('End "' + ex.title + '" for everyone? Codes stop working.')) { await api('/exams/' + ex.id + '/end', { method: 'POST' }); loadExams(); } };
    const keys = ex.form_provider ? el('button', { textContent: 'Exam keys (CSV)', title: 'Each student\'s key and whether they submitted inside MySEB: match it with the form\'s responses' }) : null;
    if (keys) keys.onclick = () => downloadKeys(ex);
    box.append(el('div', { className: 'exam' },
      el('div', { className: 't' }, el('b', { textContent: ex.title }),
        el('span', { className: 'muted', textContent: `${ex.students} student(s) · ${ex.duration_minutes} min · on leave: ${ex.leave_action} · ${ex.status}` })),
      el('label', { className: 'check' }, req, 'Require MySEB'),
      el('div', { className: 'row-actions' }, gen, mon, ...(keys ? [keys] : []), end)));
  }
}

async function generate(ex) {
  try {
    const r = await api('/exams/' + ex.id + '/generate-code', { method: 'POST' });
    $('codeCard').hidden = false;
    $('code').textContent = r.display;
    $('secret').textContent = r.secret;
    $('expires').textContent = new Date(r.expiresAt).toLocaleString();
    $('qr').innerHTML = r.qrSvg;                       // SVG generated by our own server from a URL we built
    $('copy').onclick = async () => { await navigator.clipboard.writeText(r.display); $('copy').textContent = 'Copied ✓'; setTimeout(() => ($('copy').textContent = 'Copy'), 1500); };
    $('codeCard').scrollIntoView({ behavior: 'smooth' });
  } catch (e) { alert(e.message); }
}

function monitor(ex) {
  current = ex; $('monitor').hidden = false; $('monTitle').textContent = ex.title;
  clearInterval(timer); refresh(); timer = setInterval(refresh, 3000);
  $('monitor').scrollIntoView({ behavior: 'smooth' });
}
async function refresh() {
  if (!current) return;
  let d; try { d = await api('/exams/' + current.id + '/monitor'); } catch { return; }
  $('counts').replaceChildren(...['IN_EXAM', 'PAUSED', 'LEFT', 'ENDED'].map((s) => el('span', { className: 'pill ' + s, textContent: `${s.replace('_', ' ')}: ${d.counts[s]}` })));
  $('empty').hidden = d.students.length > 0;
  $('rows').replaceChildren(...d.students.map((s) => {
    const end = el('button', { className: 'danger', textContent: 'End Exam', disabled: s.status === 'ENDED' });
    end.onclick = async () => { if (confirm('End the exam for ' + s.student_name + '?')) { await api('/sessions/' + s.id + '/end', { method: 'POST' }); refresh(); } };
    const resume = el('button', { textContent: 'Resume', hidden: !(s.status === 'PAUSED' || s.status === 'LEFT') });
    resume.onclick = async () => { await api('/sessions/' + s.id + '/resume', { method: 'POST' }); refresh(); };
    const v = el('button', { textContent: String(s.violation_count) }); v.onclick = () => showViolations(s);
    return el('tr', {},
      el('td', { textContent: s.student_name }),
      el('td', {}, el('span', { className: 'pill ' + s.status, textContent: s.status.replace('_', ' ') })),
      el('td', { textContent: s.client_type + (s.platform ? ' · ' + s.platform : '') }),
      el('td', {}, v), el('td', { textContent: s.last_violation || '—' }),
      el('td', { textContent: s.status === 'ENDED' ? (s.end_reason || '') : s.seen_ago + 's ago' }),
      el('td', {}, el('div', { className: 'row-actions' }, resume, end)));
  }));
}
async function showViolations(s) {
  const list = await api('/sessions/' + s.id + '/violations');
  $('vtitle').textContent = s.student_name + ' — violations';
  $('vlist').replaceChildren(...(list.length ? list.map((v) => el('li', { textContent: `${new Date(v.created_at).toLocaleTimeString()}  ${v.type}  ${Object.keys(v.detail).length ? JSON.stringify(v.detail) : ''}` })) : [el('li', { textContent: 'None' })]));
  $('vdlg').showModal();
}

if (KEY) api('/teacher/login', { method: 'POST' }).then(() => show(true)).catch(() => show(false)); else show(false);

/** The students' exam keys (a form made outside MySEB): the teacher matches them with the form's responses to see who answered inside MySEB. */
async function downloadKeys(ex) {
  try {
    const r = await fetch(BASE + '/api/exams/' + ex.id + '/form-keys?format=csv', { headers: { Authorization: 'Bearer ' + KEY } });
    if (!r.ok) throw new Error('Could not load the keys');
    const a = el('a', { href: URL.createObjectURL(await r.blob()), download: 'myseb-exam-keys.csv' }); a.click(); URL.revokeObjectURL(a.href);
  } catch (e) { alert(e.message); }
}
