import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';

// In production the general limit is 600 requests per 15 minutes per network address (1,500 per signed-in person). A live room would
// hit that at once: hundreds of students on one school network each reporting every few seconds, and a lecturer with hundreds of live
// pictures sending thousands of small set-up messages. The live room has its own limits instead.
process.env.NODE_ENV = 'production';
process.env.JWT_SECRET ??= 'x'.repeat(48);
const { generalLimiter, liveRoomLimiter, studentLiveLimiter, LIVE_PATH } = await import('../production/rateLimiter.js');

test('which paths belong to the live room', () => {
  for (const p of ['/api/myseb/live/form/abc', '/api/myseb/live/task/tok/signal', '/api/forms/f1/myseb/signal/s1', '/api/assignments/a1/myseb/monitor?frames=0']) assert.ok(LIVE_PATH.test(p), p);
  for (const p of ['/api/forms/f1', '/api/forms/f1/submit', '/api/myseb/status', '/api/ai/chat', '/api/forms/f1/myseb']) assert.ok(!LIVE_PATH.test(p), p);
});

test('a class on one address can report to the live room far beyond the general limit, other routes keep their limit', async () => {
  const app = express();
  app.use('/api', generalLimiter);
  app.post('/api/myseb/live/form/:id', (req, _res, next) => { (req as any).myseb = { sessionId: 'session-' + req.get('x-student') }; next(); }, studentLiveLimiter, (_q, r) => r.json({ ok: true }));
  app.get('/api/other', (_q, r) => r.json({ ok: true }));
  const srv = app.listen(0); const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  try {
    // 700 reports from the same address (more than the general 600): none is refused
    let refused = 0;
    for (let i = 0; i < 700; i++) { const r = await fetch(`${base}/api/myseb/live/form/f1`, { method: 'POST', headers: { 'x-student': String(i % 100) } }); if (r.status === 429) refused++; }
    assert.equal(refused, 0, 'live reports from one address are not refused');
    // everything else from the same address is still limited at 600
    let other429 = 0;
    for (let i = 0; i < 650; i++) { const r = await fetch(`${base}/api/other`); if (r.status === 429) other429++; }
    assert.ok(other429 >= 40, 'the general limit still applies to everything else');
  } finally { srv.close(); }
});

test('one student cannot flood the live room (counted per MySEB session, not per address), and without signing in the lecturer paths keep the small limit', async () => {
  process.env.STUDENT_LIVE_MAX = '30';        // read on every request
  const app = express();
  app.post('/s', (req, _res, next) => { (req as any).myseb = { sessionId: req.get('x-student') }; next(); }, studentLiveLimiter, (_q, r) => r.json({ ok: true }));
  const srv = app.listen(0); const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  try {
    let ok = 0; for (let i = 0; i < 50; i++) if ((await fetch(`${base}/s`, { method: 'POST', headers: { 'x-student': 'greedy' } })).status === 200) ok++;
    assert.equal(ok, 30, 'one session gets its own allowance and then is refused');
    assert.equal((await fetch(`${base}/s`, { method: 'POST', headers: { 'x-student': 'quiet' } })).status, 200, 'another student on the same address is not affected');
  } finally { srv.close(); delete process.env.STUDENT_LIVE_MAX; }
  const app2 = express(); app2.use(liveRoomLimiter); app2.get('/x', (_q, r) => r.json({ ok: true }));
  const srv2 = app2.listen(0); const base2 = `http://127.0.0.1:${(srv2.address() as AddressInfo).port}`;
  try {
    let refused = 0; for (let i = 0; i < 650; i++) if ((await fetch(`${base2}/x`)).status === 429) refused++;
    assert.ok(refused >= 40, 'without signing in the live room paths are limited to 600');
  } finally { srv2.close(); }
});
