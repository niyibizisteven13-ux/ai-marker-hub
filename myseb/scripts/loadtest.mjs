#!/usr/bin/env node
// Load test for MySEB through its public address. Usage:
//   node myseb/scripts/loadtest.mjs <baseUrl> <teacherKey> <students> [seconds] [probeUrl]
// Students join with one code, then send a heartbeat every 5 s like the real app. Prints heartbeat latency and
// errors, and (with probeUrl) the latency of another page on the same server, to show whether the site slows down.
// Needs VERIFY_FAILS_PER_IP_PER_MIN high on the server (all test students come from one address).
import { Agent, setGlobalDispatcher } from 'undici';
const [base, key, nArg, secArg, probe] = process.argv.slice(2);
if (!base || !key) { console.error('usage: loadtest.mjs <baseUrl> <teacherKey> <students> [seconds] [probeUrl]'); process.exit(2); }
const N = Number(nArg || 300), SECONDS = Number(secArg || 30);
setGlobalDispatcher(new Agent({ connections: 400, pipelining: 1, keepAliveTimeout: 30_000 }));
const j = async (p, o = {}) => { const r = await fetch(base + p, { ...o, headers: { 'Content-Type': 'application/json', ...(o.headers || {}) }, body: o.body ? JSON.stringify(o.body) : undefined }); return { status: r.status, json: await r.json().catch(() => ({})) }; };
const T = { Authorization: `Bearer ${key}` };
const exam = (await j('/api/exams', { method: 'POST', headers: T, body: { title: 'Load test', durationMinutes: 600 } })).json;
const code = (await j(`/api/exams/${exam.id}/generate-code`, { method: 'POST', headers: T })).json;
const pct = (a, p) => a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : 0;
const lat = { join: [], hb: [], probe: [] }; let errors = 0, total = 0;
const timed = async (bucket, fn) => { const t = performance.now(); try { const r = await fn(); total++; if (r.status >= 400) errors++; else lat[bucket].push(performance.now() - t); return r; } catch { total++; errors++; } };

const students = [];
const t0 = performance.now();
for (let i = 0; i < N; i += 50) await Promise.all(Array.from({ length: Math.min(50, N - i) }, (_, k) => timed('join', async () => {
  const id = i + k; const r = await j('/api/verify-code', { method: 'POST', body: { code: code.code, studentName: `S${id}`, deviceId: `dev-load-${id}-aaaa`, clientType: 'desktop', platform: 'win32' } });
  if (r.json.token) students.push({ id, token: r.json.token }); return r;
})));
console.log(`joined ${students.length}/${N} in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
const hb = (s) => timed('hb', () => j('/api/heartbeat', { method: 'POST', headers: { 'X-MySEB-Key': s.token, 'X-MySEB-Client': 'desktop', 'X-MySEB-Device': `dev-load-${s.id}-aaaa`, 'User-Agent': 'Mozilla/5.0 MySEB/1.0 (desktop)' }, body: {} }));
const stop = Date.now() + SECONDS * 1000;
const loops = students.map(async (s, i) => { await new Promise((r) => setTimeout(r, (i / students.length) * 5000)); while (Date.now() < stop) { const t = Date.now(); await hb(s); await new Promise((r) => setTimeout(r, Math.max(0, 5000 - (Date.now() - t)))); } });
const probing = probe ? (async () => { while (Date.now() < stop) { await timed('probe', () => fetch(probe).then((r) => ({ status: r.status }))); await new Promise((r) => setTimeout(r, 250)); } })() : null;
// a lecturer watching the room: refresh every 4 s
const watcher = (async () => { while (Date.now() < stop) { await timed('probe', () => fetch(`${base}/api/exams/${exam.id}/monitor?frames=0`, { headers: T })); await new Promise((r) => setTimeout(r, 4000)); } })();
await Promise.all([...loops, probing, watcher]);
const f = (a) => `p50 ${pct(a, .5).toFixed(0)} ms · p95 ${pct(a, .95).toFixed(0)} ms · p99 ${pct(a, .99).toFixed(0)} ms (${a.length})`;
console.log(`heartbeats: ${f(lat.hb)}\njoin:       ${f(lat.join)}\n${probe ? 'site page:  ' : 'monitor:    '}${f(lat.probe)}\nerrors: ${errors}/${total}`);
process.exit(errors / Math.max(1, total) > 0.01 ? 1 : 0);
