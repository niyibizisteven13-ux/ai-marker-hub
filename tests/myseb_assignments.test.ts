import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { OwnedRecordStore } from '../server/services/storage/ownedRecordStore.js';
import { AssignmentError, createAssignmentService, type AssignmentFiles, type AssignmentRecord } from '../server/services/assignments/service.js';
import { setAssignmentService } from '../server/services/assignments/runtime.js';

// Hand-in links behind MySEB: the task text, its files and the hand-in itself are locked; the lecturer drives MySEB from bwenge.
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'myseb-asg-'));
const mem = new Map<string, { owner: string; name: string; mime: string; data: Buffer }>();
const files: AssignmentFiles = {
  async save(userId, name, mime, data) { const id = randomUUID(); mem.set(id, { owner: userId, name, mime, data }); return { id, name, mime, size: data.length }; },
  async read(userId, id) { const f = mem.get(id); if (!f || f.owner !== userId) throw new AssignmentError('NOT_FOUND', 'File not found.', 404); return f; },
};
const svc = createAssignmentService({ store: new OwnedRecordStore<AssignmentRecord>(path.join(dir, 'records')), files, tokenDir: path.join(dir, 'links'), baseUrl: () => 'https://www.bwenge.space' });
setAssignmentService(svc);

// A fake MySEB server: creates exams, makes codes, lists the students, and answers the gate.
const EXAM_ID = randomUUID();
const STUDENT_SID = randomUUID();
const calls: string[] = [];
const fake = express(); fake.use(express.json());
fake.use((req, res, next) => (req.get('authorization') === 'Bearer svc-key' || req.get('x-myseb-service-key') === 'svc-key' ? next() : res.status(401).json({ error: 'no' })));
fake.post('/api/exams', (req, res) => { calls.push(`exam:${req.body.examUrl}:${req.body.leaveAction}`); res.status(201).json({ id: EXAM_ID }); });
fake.post('/api/exams/:id/generate-code', (req, res) => { calls.push(`code:${req.params.id}`); res.status(201).json({ code: '123456', display: '1234-KIVU-56', qrSvg: '<svg/>', joinUrl: 'https://x/join/123456', expiresAt: new Date().toISOString() }); });
fake.get('/api/exams/:id/monitor', (_req, res) => res.json({ counts: { IN_EXAM: 1, PAUSED: 0, LEFT: 0, ENDED: 0 }, students: [{ id: STUDENT_SID, student_name: 'Aline', status: 'IN_EXAM' }] }));
fake.post('/api/sessions/:sid/:action', (req, res) => { calls.push(`${req.params.action}:${req.params.sid}`); res.json({ ok: true }); });
fake.post('/api/gate', (req, res) => {
  const ok = req.body.key === 'tok-in' && req.body.examId === EXAM_ID && /MySEB\//.test(req.body.userAgent || '') && req.body.client === 'desktop' && req.body.device === 'dev-1';
  res.json(ok ? { allowed: true, studentName: 'Aline', clientType: 'desktop' } : { allowed: false, reason: 'MySEB Needed' });
});
const fakeSrv = fake.listen(0);
process.env.MYSEB_URL = `http://127.0.0.1:${(fakeSrv.address() as any).port}`;
process.env.MYSEB_SERVICE_KEY = 'svc-key';
process.env.APP_URL = 'https://www.bwenge.space';
const { mySebGuard, mySebShell, generateCode, monitor, sessionAction, assignmentTarget } = await import('../server/services/mySeb.js');

const asg = await svc.create('t1', { title: 'In-class quiz', instructions: 'Do it now.' });
const token = asg.link.split('/a/')[1];
const other = await svc.create('t2', { title: 'Someone else', instructions: 'x' });
const app = express();
const g = mySebGuard('assignment');
app.get('/a/:token', mySebShell('assignment'), (_q, r) => r.send('shell'));
app.get('/api/assignments/public/:token', g, async (req, res) => res.json(await svc.publicView(req.params.token)));
app.get('/api/assignments/public/:token/files/:index', g, (_q, r) => r.send('file'));
app.post('/api/assignments/public/:token/submit', g, (_q, r) => r.status(201).json({ ok: true }));
const srv = app.listen(0); const base = `http://127.0.0.1:${(srv.address() as any).port}`;
test.after(async () => { srv.close(); fakeSrv.close(); setAssignmentService(null); await fs.rm(dir, { recursive: true, force: true }); });

const IN = { 'X-MySEB-Key': 'tok-in', 'X-MySEB-Client': 'desktop', 'X-MySEB-Device': 'dev-1', 'User-Agent': 'Mozilla MySEB/1.0 (desktop)' };
const hit = async (method: string, url: string, headers: Record<string, string> = {}) => { const r = await fetch(base + url, { method, headers }); return { status: r.status, body: await r.json().catch(() => null) }; };

test('a task that does not ask for MySEB is open as before', async () => {
  assert.equal((await hit('GET', `/api/assignments/public/${token}`)).status, 200);
});

test('turning it on locks the task text, its files and the hand-in; the page shell stays reachable', async () => {
  await svc.update('t1', asg.id, { requireMyseb: true });
  assert.equal((await svc.get('t1', asg.id)).requireMyseb, true);
  await new Promise((r) => setTimeout(r, 5100));   // the guard remembers a form/task for 5 s
  for (const [m, u] of [['GET', `/api/assignments/public/${token}`], ['GET', `/api/assignments/public/${token}/files/0`], ['POST', `/api/assignments/public/${token}/submit`]]) {
    const r = await hit(m, u); assert.equal(r.status, 403, `${m} ${u}`); assert.equal(r.body.code, 'MYSEB_REQUIRED');
  }
  assert.equal((await hit('GET', `/a/${token}`)).status, 200);
  // Required but no code made yet: nobody is inside, even with a plausible header.
  assert.equal((await hit('GET', `/api/assignments/public/${token}`, IN)).status, 403);
});

test('lecturer asks for a code: bwenge creates the MySEB exam for this link once, and the task then admits MySEB students only', async () => {
  const c = await generateCode(assignmentTarget('t1', asg.id));
  assert.equal(c.display, '1234-KIVU-56'); assert.equal(c.mysebExamId, EXAM_ID);
  assert.ok(calls.some((x) => x === `exam:https://www.bwenge.space/a/${token}:pause`), 'exam points at the hand-in link');
  await generateCode(assignmentTarget('t1', asg.id));
  assert.equal(calls.filter((x) => x.startsWith('exam:')).length, 1, 'the exam is created once, later codes reuse it');
  await new Promise((r) => setTimeout(r, 5100));
  assert.equal((await hit('GET', `/api/assignments/public/${token}`, IN)).status, 200);
  assert.equal((await hit('POST', `/api/assignments/public/${token}/submit`, IN)).status, 201);
  assert.equal((await hit('GET', `/api/assignments/public/${token}`, { ...IN, 'User-Agent': 'Chrome' })).status, 403, 'the token in plain Chrome');
  assert.equal((await hit('GET', `/api/assignments/public/${token}`, { ...IN, 'X-MySEB-Device': 'dev-2' })).status, 403, 'another device');
});

test('a lecturer can only see and act on their own task', async () => {
  assert.equal((await monitor(assignmentTarget('t1', asg.id))).students.length, 1);
  await sessionAction(assignmentTarget('t1', asg.id), STUDENT_SID, 'resume');
  assert.ok(calls.includes(`resume:${STUDENT_SID}`));
  await assert.rejects(sessionAction(assignmentTarget('t1', asg.id), randomUUID(), 'end'), /not in this test/);
  await assert.rejects(monitor(assignmentTarget('t1', other.id)), /not found/i);          // t1 does not own t2's task
  await assert.rejects(generateCode(assignmentTarget('t3', asg.id)), /not found/i);        // a stranger cannot make codes for it
  await assert.rejects(sessionAction(assignmentTarget('t1', asg.id), 'not-a-uuid', 'end'), /Bad session id/);
});
