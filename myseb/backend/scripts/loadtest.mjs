// Load test: a class of N students in a live room against the MySEB exam server (the part that runs on your server). The video does not go
// through it. It starts its own copy of the server, joins N students, has the lecturer ask them all to go live 6 at a time, and then runs
// the steady traffic (heartbeats every 5 s, live reports every 3 s, held waits, the lecturer's room list) and prints how the server coped.
//   cd myseb/backend && DATABASE_URL=postgres://user:pass@127.0.0.1/db node scripts/loadtest.mjs 500 60
// Use an empty test database, never the real one: it creates an exam and N sessions.
import { spawn } from 'node:child_process'; import { setMaxListeners } from 'node:events'; import fs from 'node:fs'; import os from 'node:os';
const N = Number(process.argv[2] || 500), STEADY = Number(process.argv[3] || 60), PORT = 4801;
const base = `http://127.0.0.1:${PORT}`; const T = { Authorization: 'Bearer k', 'Content-Type': 'application/json' };
if (!process.env.DATABASE_URL) { console.error('Set DATABASE_URL to an empty test PostgreSQL database.'); process.exit(1); }
const srv = spawn('node', ['src/server.js'], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), TEACHER_KEY: 'k', PEPPER: 'p', PUBLIC_URL: base, VERIFY_RATE_PER_MIN: '100000', VERIFY_FAILS_PER_MIN: '100000', DISABLE_DASHBOARD: '1' }, stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/api/status').catch(() => fetch(base + '/'))).status) break; } catch {} await sleep(500); }
const lat = {}; const err = {}; const rec = (k, ms, ok) => { (lat[k] ??= []).push(ms); if (!ok) err[k] = (err[k] ?? 0) + 1; };
const call = async (label, path, opt = {}) => { const t = performance.now(); try { const r = await fetch(base + path, opt); await r.arrayBuffer(); rec(label, performance.now() - t, r.status < 400); return r; } catch (e) { rec(label, performance.now() - t, false); return null; } };
const json = async (path, opt = {}) => { const r = await fetch(base + path, opt); return { status: r.status, j: await r.json().catch(() => ({})) }; };
const exam = (await json('/api/exams', { method: 'POST', headers: T, body: JSON.stringify({ title: 'Load', leaveAction: 'record' }) })).j;
await json(`/api/exams/${exam.id}`, { method: 'PATCH', headers: T, body: JSON.stringify({ liveMode: 'live', liveSource: 'both', allowWeb: true }) });
const code = (await json(`/api/exams/${exam.id}/generate-code`, { method: 'POST', headers: T })).j;
const UA = 'Mozilla/5.0 (Linux; Android 14) MySEB/1.0 (mobile)'; const S = [];
const tj = performance.now();
for (let i = 0; i < N; i += 25) await Promise.all(Array.from({ length: Math.min(25, N - i) }, async (_, k) => { const n = i + k; const dev = `load-${n}-device1234`; const r = await json('/api/verify-code', { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': UA }, body: JSON.stringify({ code: code.code, studentName: `Student ${n}`, deviceId: dev, clientType: 'mobile' }) }); if (r.status === 200) S.push({ id: r.j.sessionId, h: { 'X-MySEB-Key': r.j.token, 'X-MySEB-Client': 'mobile', 'X-MySEB-Device': dev, 'User-Agent': UA, 'Content-Type': 'application/json' } }); }));
console.log(`joined ${S.length}/${N} in ${((performance.now() - tj) / 1000).toFixed(1)} s`);
const pid = srv.pid; const cpuOf = (p) => { try { const f = fs.readFileSync(`/proc/${p}/stat`, 'utf8').split(' '); return (Number(f[13]) + Number(f[14])) / 100; } catch { return 0; } };
const pgPids = () => fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d)).filter((d) => { try { return fs.readFileSync(`/proc/${d}/comm`, 'utf8').startsWith('postgres'); } catch { return false; } });
const pgCpu = () => pgPids().reduce((a, d) => a + cpuOf(d), 0);
let stop = false; const ace = new AbortController(); setMaxListeners(0, ace.signal);
const ICE = JSON.stringify({ msg: { type: 'ice', candidate: { candidate: 'candidate:1 1 udp 2113937151 192.168.1.2 54321 typ host', sdpMid: '0', sdpMLineIndex: 0 } } });
const jit = (ms) => ms * (0.8 + Math.random() * 0.4);
async function student(s) {
  let after = 0;
  const hb = (async () => { await sleep(Math.random() * 5000); while (!stop) { await call('student heartbeat (every 5 s)', '/api/heartbeat', { method: 'POST', headers: s.h, body: '{}' }); await sleep(jit(5000)); } })();
  const rep = (async () => { await sleep(Math.random() * 3000); let n = 0; while (!stop) { const frame = n++ % 3 === 0 ? 'data:image/jpeg;base64,' + 'A'.repeat(8000) : undefined; await call('live report (every 3 s)', `/api/sessions/${s.id}/live`, { method: 'POST', headers: T, body: JSON.stringify({ question: { index: 3, total: 10, label: 'Short answer' }, camera: 'on', screenState: 'on', frame }) }); await sleep(jit(3000)); } })();
  const pull = (async () => { while (!stop) { const t = performance.now(); try { const r = await fetch(`${base}/api/sessions/${s.id}/from-lecturer?after=${after}&wait=20000`, { headers: T, signal: ace.signal }); const b = await r.json(); after = b.next ?? after; rec('wait for a lecturer message (held up to 20 s)', 0, true);
      if (b.msgs?.some((m) => m.type === 'watch')) { await call('set-up: offer', `/api/sessions/${s.id}/to-lecturer`, { method: 'POST', headers: T, body: JSON.stringify({ msg: { type: 'offer', sdp: 'v=0\r\n' + 'a=x\r\n'.repeat(700) } }) }); for (let k = 0; k < 9; k++) await call('set-up: network candidate', `/api/sessions/${s.id}/to-lecturer`, { method: 'POST', headers: T, body: ICE }); } } catch { if (stop) return; await sleep(500); } } })();
  await Promise.all([hb, rep, pull]);
}
async function lecturer() {
  let after = 0; const mon = (async () => { while (!stop) { await call('lecturer: room list with all students (every 2 s)', `/api/exams/${exam.id}/monitor?frames=0`, { headers: T }); await sleep(2000); } })();
  const fr = (async () => { while (!stop) { await call('lecturer: pictures for 60 tiles (every 5 s)', `/api/exams/${exam.id}/frames?ids=${S.slice(0, 60).map((s) => s.id).join(',')}`, { headers: T }); await sleep(5000); } })();
  const inbox = (async () => { while (!stop) { try { const r = await fetch(`${base}/api/exams/${exam.id}/from-students?after=${after}&wait=20000`, { headers: T, signal: ace.signal }); const b = await r.json(); after = b.next ?? after;
      for (const m of b.msgs ?? []) if (m.type === 'offer') { void (async () => { await call('set-up: answer', `/api/sessions/${m.sid}/to-student`, { method: 'POST', headers: T, body: JSON.stringify({ msg: { type: 'answer', sdp: 'v=0\r\n' + 'a=x\r\n'.repeat(500) } }) }); for (let k = 0; k < 9; k++) await call('set-up: network candidate (lecturer)', `/api/sessions/${m.sid}/to-student`, { method: 'POST', headers: T, body: ICE }); })(); } } catch { if (stop) return; await sleep(500); } } })();
  await Promise.all([mon, fr, inbox]);
}
const run = [...S.map(student), lecturer()];
await sleep(1500);
// the lecturer asks every student to go live, 6 at a time, 0.35 s apart (as the live room does)
const t0 = performance.now();
for (let i = 0; i < S.length; i += 6) { await Promise.all(S.slice(i, i + 6).map((s) => call('lecturer: ask a student to go live', `/api/sessions/${s.id}/to-student`, { method: 'POST', headers: T, body: JSON.stringify({ msg: { type: 'watch', viewer: 'v1' } }) }))); await sleep(350); }
console.log(`everyone asked in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
await sleep(3000);
const ramp = {}; for (const [k, v] of Object.entries(lat)) ramp[k] = [...v];
const cR = cpuOf(pid), pR = pgCpu();
const c0 = cpuOf(pid), p0 = pgCpu(), w0 = performance.now(); for (const k of Object.keys(lat)) lat[k] = [];  // measure only the steady part
await sleep(STEADY * 1000);
const wall = (performance.now() - w0) / 1000; const c1 = cpuOf(pid), p1 = pgCpu();
const rss = Number(/VmRSS:\s+(\d+)/.exec(fs.readFileSync(`/proc/${pid}/status`, 'utf8'))[1]) / 1024;
stop = true; ace.abort(); await sleep(500);
const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * q))] : 0; };
console.log(`\n${N} students live, steady ${wall.toFixed(0)} s on ${os.cpus().length} cores`);
console.log(`exam server CPU: ${(((c1 - c0) / wall) * 100).toFixed(0)}% of one core (${(((c1 - c0) / wall) * 100 / os.cpus().length).toFixed(0)}% of the machine), memory ${rss.toFixed(0)} MB; PostgreSQL CPU: ${(((p1 - p0) / wall) * 100).toFixed(0)}% of one core`);
console.log('requests per second:', Object.entries(lat).filter(([k]) => !k.startsWith('wait')).reduce((a, [, v]) => a + v.length, 0) / wall | 0);
for (const [k, v] of Object.entries(lat)) console.log(`  ${k.padEnd(58)} n=${String(v.length).padStart(6)}  median ${pct(v, 0.5).toFixed(0).padStart(4)} ms  95th ${pct(v, 0.95).toFixed(0).padStart(5)} ms  worst ${Math.max(0, ...v).toFixed(0).padStart(5)} ms  errors ${err[k] ?? 0}`);
console.log('\nthe start-up (everyone going live, ' + N + ' students):');
for (const [k, v] of Object.entries(ramp)) if (/set-up|ask a student/.test(k)) console.log(`  ${k.padEnd(58)} n=${String(v.length).padStart(6)}  median ${pct(v, 0.5).toFixed(0).padStart(4)} ms  95th ${pct(v, 0.95).toFixed(0).padStart(5)} ms  worst ${Math.max(0, ...v).toFixed(0).padStart(5)} ms  errors ${err[k] ?? 0}`);
srv.kill(); process.exit(0);
