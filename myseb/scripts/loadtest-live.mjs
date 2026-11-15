#!/usr/bin/env node
// Live-room load test: N students in Live video mode (heartbeat, screen+camera pictures, a held "wait for the lecturer" connection each),
// L lecturers watching the instant stream and refreshing the list. Prints how fast changes reach the lecturer, how heartbeats fare,
// and the server's memory. Usage:
//   node myseb/scripts/loadtest-live.mjs <appUrl> <directUrl> <teacherKey> <students> [seconds] [lecturers]
// appUrl = the address students' apps use (.../myseb), directUrl = MySEB itself (what bwenge talks to). Needs VERIFY_FAILS_PER_IP_PER_MIN high.
import { Agent, setGlobalDispatcher } from 'undici';
const [app, direct, key, nArg, secArg, lecArg] = process.argv.slice(2);
if (!app || !direct || !key) { console.error('usage: loadtest-live.mjs <appUrl> <directUrl> <teacherKey> <students> [seconds] [lecturers]'); process.exit(2); }
const N = Number(nArg || 500), SECONDS = Number(secArg || 40), LECT = Number(lecArg || 2);
setGlobalDispatcher(new Agent({ connections: 60000, pipelining: 1, keepAliveTimeout: 30_000, headersTimeout: 0, bodyTimeout: 0 }));
const T = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
const j = async (base, p, o = {}) => { const r = await fetch(base + p, { ...o, headers: { 'Content-Type': 'application/json', ...(o.headers || {}) }, body: o.body ? JSON.stringify(o.body) : undefined }); return { status: r.status, json: await r.json().catch(() => ({})) }; };
const pct = (a, p) => a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : 0;
const f = (a) => `p50 ${pct(a, .5).toFixed(0)} ms · p95 ${pct(a, .95).toFixed(0)} ms · p99 ${pct(a, .99).toFixed(0)} ms · max ${pct(a, 1).toFixed(0)} ms (${a.length})`;
const exam = (await j(app, '/api/exams', { method: 'POST', headers: T, body: { title: 'Live load', durationMinutes: 600, leaveAction: 'record' } })).json;
await j(app, `/api/exams/${exam.id}`, { method: 'PATCH', headers: T, body: { liveMode: 'live', liveSource: 'both', liveSound: false } });
const code = (await j(app, `/api/exams/${exam.id}/generate-code`, { method: 'POST', headers: T })).json;
const jpeg = (n) => 'data:image/jpeg;base64,' + 'A'.repeat(n - 23);
const SCREEN = jpeg(24_000), FACE = jpeg(5_000);   // about the size of a 400x225 screen picture and a 160x120 face picture
const lat = { hb: [], report: [], pull: [], monitor: [], event: [] }; let errors = 0, total = 0, shed = 0;
const timed = async (b, fn) => { const t = performance.now(); try { const r = await fn(); total++; if (r.status === 503) shed++; else if (r.status >= 400) errors++; else if (b) lat[b].push(performance.now() - t); return r; } catch { total++; errors++; } };

const students = []; const t0 = performance.now();
for (let i = 0; i < N; i += 100) await Promise.all(Array.from({ length: Math.min(100, N - i) }, (_, k) => timed(null, async () => {
  const id = i + k; const r = await j(app, '/api/verify-code', { method: 'POST', body: { code: code.code, studentName: `S${id}`, deviceId: `dev-live-${id}-aaaa`, clientType: 'desktop', platform: 'win32' } });
  if (r.json.token) students.push({ id, sid: r.json.sessionId, token: r.json.token }); return r;
})));
console.log(`joined ${students.length}/${N} in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
const stop = Date.now() + SECONDS * 1000;
const hdr = (s) => ({ 'X-MySEB-Key': s.token, 'X-MySEB-Client': 'desktop', 'X-MySEB-Device': `dev-live-${s.id}-aaaa`, 'User-Agent': 'Mozilla/5.0 MySEB/1.0 (desktop)' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let held = 0, maxHeld = 0, pictureReports = 0;
// each student: heartbeat + live report every 5 s, and one held "wait for the lecturer" request that never ends until the test does
const loops = students.map(async (s, i) => {
  await sleep((i / students.length) * 5000);
  const holder = (async () => { while (Date.now() < stop) { held++; maxHeld = Math.max(maxHeld, held); await timed('pull', () => j(direct, `/api/sessions/${s.sid}/from-lecturer?after=0&wait=20000`, { headers: T })).finally(() => held--); } })();
  while (Date.now() < stop) {
    const t = Date.now();
    await timed('hb', () => j(app, '/api/heartbeat', { method: 'POST', headers: hdr(s), body: {} }));
    // like the real app: a picture only when the server says a lecturer is looking at this student; the server also sets the rhythm
    const r = await timed('report', () => j(direct, `/api/sessions/${s.sid}/live`, { method: 'POST', headers: T, body: { question: { index: 1 + ((t / 5000 + s.id) | 0) % 10, total: 10, label: 'Explain the equation' }, camera: 'on', ...(s.pictures ? { frame: FACE, screen: SCREEN } : {}), screenState: 'on' } }));
    if (r?.json) { s.pictures = r.json.pictures === true; s.every = r.json.every || 5; if (s.pictures) pictureReports++; }
    await sleep(Math.max(0, (s.every || 5) * 1000 - (Date.now() - t)));
  }
  await holder;
});

// lecturers: one instant stream each; on every message refresh the list (as the live room does) and every 5 s fetch pictures for 24 tiles
let lastKick = 0; const events = [];
const lecturers = Array.from({ length: LECT }, async (_, li) => {
  const ac = new AbortController(); setTimeout(() => ac.abort(), SECONDS * 1000 + 500);
  const refreshList = () => timed('monitor', () => j(direct, `/api/exams/${exam.id}/monitor?frames=0`, { headers: T }));
  const pics = (async () => { while (Date.now() < stop) { const ids = students.slice(0, 24).map((s) => s.sid).join(','); await timed(null, () => j(direct, `/api/exams/${exam.id}/frames?ids=${ids}`, { headers: T })); await sleep(5000); } })();
  try {
    const r = await fetch(`${direct}/api/exams/${exam.id}/events`, { headers: T, signal: ac.signal });
    const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = '';
    for (;;) { const { done, value } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true }); let i; while ((i = buf.indexOf('\n\n')) >= 0) { const c = buf.slice(0, i); buf = buf.slice(i + 2); if (c.includes('data:')) { if (li === 0) events.push(performance.now()); await refreshList(); } } }
  } catch { /* the test ended */ }
  await pics;
});
// the probe: a student breaks a rule; how long until lecturer 0 hears about it?
const probe = (async () => { await sleep(3000); while (Date.now() < stop - 2000) { const s = students[Math.floor(Math.random() * students.length)]; const t = performance.now(); const before = events.length; await timed(null, () => j(app, '/api/violation', { method: 'POST', headers: hdr(s), body: { type: 'blur', detail: {} } })); for (let w = 0; w < 100 && events.length === before; w++) await sleep(20); if (events.length > before) lat.event.push(events.find((e, k) => k >= before && e >= t) - t); await sleep(2500); } })();
const mem = async () => { try { const r = await fetch(`${direct}/metrics`, { headers: { Authorization: `Bearer ${key}` } }); const t = await r.text(); const g = (n) => Number((t.match(new RegExp(`^${n}(?:\\{[^}]*\\})? (\\S+)`, 'm')) || [])[1] || 0); return { poolWaiting: g('myseb_db_pool_waiting'), poolBusy: g('myseb_db_pool_busy'), lagMs: g('myseb_event_loop_lag_ms'), rssMb: Math.round(g('myseb_process_resident_bytes') / 1e6), waiting: g('myseb_signal_waiting'), pictureMb: g('myseb_picture_megabytes'), streams: g('myseb_room_streams') }; } catch { return null; } };
let peak = { rssMb: 0 }, worst = { poolWaiting: 0, lagMs: 0 }; const memLoop = (async () => { while (Date.now() < stop) { const m = await mem(); if (m) { if (m.rssMb > peak.rssMb) peak = m; worst.poolWaiting = Math.max(worst.poolWaiting, m.poolWaiting); worst.lagMs = Math.max(worst.lagMs, m.lagMs); } await sleep(2000); } })();
await Promise.all([...loops, ...lecturers, probe, memLoop]);
console.log(`students live: ${students.length} · held waiting connections at peak: ${maxHeld} · lecturers: ${LECT}`);
console.log(`instant update (rule broken -> lecturer told): ${f(lat.event)}`);
console.log(`heartbeats:        ${f(lat.hb)}`);
console.log(`status reports:    ${f(lat.report)} · ${pictureReports} carried pictures`);
console.log(`list refresh:      ${f(lat.monitor)}`);
console.log(`server at peak:    memory ${peak.rssMb} MB · pictures ${peak.pictureMb} MB · waiting ${peak.waiting} · room streams ${peak.streams}`);
console.log(`bottleneck check: most requests ever waiting for the database ${worst.poolWaiting} · worst event-loop delay ${worst.lagMs} ms`);
console.log(`errors: ${errors}/${total}${shed ? ` · turned away as busy: ${shed}` : ''}`);
process.exit(errors / Math.max(1, total) > 0.01 ? 1 : 0);
