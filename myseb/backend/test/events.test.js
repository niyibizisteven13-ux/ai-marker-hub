// Instant updates for the live room: a student joins, breaks a rule or is ended, and the room's stream says so within a moment.
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.TEACHER_KEY = 'tkey'; process.env.PEPPER = 'testpepper'; process.env.PUBLIC_URL = 'http://127.0.0.1:0'; process.env.VERIFY_RATE_PER_MIN = '1000';
process.env.MYSEB_MAX_ROOM_STREAMS = '2';
const { app } = await import('../src/server.js');
const { migrate, pool } = await import('../src/db.js');
await migrate();
const server = app.listen(0); const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => { server.close(); pool.end(); });
const T = { Authorization: 'Bearer tkey', 'Content-Type': 'application/json' };
const call = async (path, { method = 'GET', headers = {}, body } = {}) => {
  const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};
const UA = 'Mozilla/5.0 MySEB/1.0 (desktop)';
const mk = (s, dev) => ({ 'X-MySEB-Key': s.token, 'X-MySEB-Client': 'desktop', 'X-MySEB-Device': dev, 'User-Agent': UA });

/** Opens the room stream and lets the test wait for the next "changed" message, timing how long it took. */
async function openStream(examId) {
  const ac = new AbortController();
  const r = await fetch(`${base}/api/exams/${examId}/events`, { headers: T, signal: ac.signal });
  if (r.status !== 200) { ac.abort(); return { status: r.status, close() {} }; }
  const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = ''; const queue = []; let wake = null;
  (async () => { try { for (;;) { const { done, value } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true }); let i; while ((i = buf.indexOf('\n\n')) >= 0) { const c = buf.slice(0, i); buf = buf.slice(i + 2); if (c.includes('data:')) { queue.push(JSON.parse(c.split('data:')[1])); wake?.(); } } } } catch { /* closed */ } })();
  return {
    status: 200, contentType: r.headers.get('content-type'),
    next: (ms = 3000) => new Promise((resolve, reject) => {
      if (queue.length) return resolve(queue.shift());
      const t = setTimeout(() => reject(new Error('no message')), ms); wake = () => { clearTimeout(t); resolve(queue.shift()); };
    }),
    close: () => ac.abort(),
  };
}

test('the live room hears about a join, a rule broken, and an end within a moment', async () => {
  const exam = (await call('/api/exams', { method: 'POST', headers: T, body: { title: 'Instant', leaveAction: 'record' } })).json;
  const code = (await call(`/api/exams/${exam.id}/generate-code`, { method: 'POST', headers: T })).json;
  const room = await openStream(exam.id);
  assert.equal(room.status, 200); assert.match(room.contentType, /text\/event-stream/);
  try {
    let t0 = Date.now();
    const a = (await call('/api/verify-code', { method: 'POST', body: { code: code.code, studentName: 'Ivy', deviceId: 'dev-ivy-12345', clientType: 'desktop' } })).json;
    const joined = await room.next(); assert.ok(joined.kinds.includes('join')); assert.ok(Date.now() - t0 < 800, `join arrived in ${Date.now() - t0} ms`);
    t0 = Date.now();
    await call('/api/violation', { method: 'POST', headers: mk(a, 'dev-ivy-12345'), body: { type: 'blur', detail: {} } });
    const broke = await room.next(); assert.ok(broke.kinds.includes('violation')); assert.ok(Date.now() - t0 < 800, `violation arrived in ${Date.now() - t0} ms`);
    t0 = Date.now();
    await call(`/api/sessions/${a.sessionId}/end`, { method: 'POST', headers: T });
    const ended = await room.next(); assert.ok(ended.kinds.length > 0); assert.ok(Date.now() - t0 < 800, `end arrived in ${Date.now() - t0} ms`);
    // a new question is shown at once, but the same question again is not news
    await call(`/api/exams/${exam.id}`, { method: 'PATCH', headers: T, body: { liveMode: 'pictures' } }); await room.next();
    const b = (await call('/api/verify-code', { method: 'POST', body: { code: code.code, studentName: 'Jon', deviceId: 'dev-jon-12345', clientType: 'desktop' } })).json; await room.next();
    await call(`/api/sessions/${b.sessionId}/live`, { method: 'POST', headers: T, body: { question: { index: 2, total: 5, label: 'Q2' }, camera: 'on' } });
    assert.ok((await room.next()).kinds.includes('live'));
    await call(`/api/sessions/${b.sessionId}/live`, { method: 'POST', headers: T, body: { question: { index: 2, total: 5, label: 'Q2' }, camera: 'on' } });
    await assert.rejects(room.next(400), /no message/, 'nothing changed, so no message');
  } finally { room.close(); }
});

test('a burst of changes is merged into very few messages', async () => {
  const exam = (await call('/api/exams', { method: 'POST', headers: T, body: { title: 'Burst' } })).json;
  const code = (await call(`/api/exams/${exam.id}/generate-code`, { method: 'POST', headers: T })).json;
  const room = await openStream(exam.id);
  try {
    await Promise.all(Array.from({ length: 30 }, (_, i) => call('/api/verify-code', { method: 'POST', body: { code: code.code, studentName: `S${i}`, deviceId: `dev-burst-${i}-aaaa`, clientType: 'desktop' } })));
    let n = 0; try { for (;;) { await room.next(500); n++; } } catch { /* quiet again */ }
    assert.ok(n >= 1 && n <= 6, `30 joins gave ${n} messages`);
  } finally { room.close(); }
});

test('only a few live rooms can listen to one test, and the stream needs the teacher key', async () => {
  const exam = (await call('/api/exams', { method: 'POST', headers: T, body: { title: 'Caps' } })).json;
  assert.equal((await call(`/api/exams/${exam.id}/events`)).status, 401);
  const a = await openStream(exam.id), b = await openStream(exam.id), c = await openStream(exam.id);
  try { assert.equal(a.status, 200); assert.equal(b.status, 200); assert.equal(c.status, 503, 'the third is turned away politely'); }
  finally { a.close(); b.close(); c.close(); }
});
