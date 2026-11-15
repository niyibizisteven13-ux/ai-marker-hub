import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { prisma } from '../server/db.js';

// bwenge's side of the live room: the page's reports reach MySEB only from a live MySEB student, are limited, and the
// lecturer's controls (pause everyone, camera pictures) go to the right exam.
const EXAM = randomUUID(); const SID = randomUUID();
const got: any[] = [];
const fake = express(); fake.use(express.json());
fake.use((req, res, next) => (req.get('authorization') === 'Bearer svc-key' || req.get('x-myseb-service-key') === 'svc-key' ? next() : res.status(401).json({ error: 'no' })));
fake.post('/api/gate', (req, res) => res.json(req.body.key === 'tok' && req.body.examId === EXAM && /MySEB\//.test(req.body.userAgent || '') && req.body.client === 'desktop' && req.body.device === 'd1'
  ? { allowed: true, studentName: 'Aline', clientType: 'desktop', sessionId: SID } : { allowed: false, reason: 'MySEB Needed' }));
fake.post('/api/sessions/:sid/live', (req, res) => { got.push({ sid: req.params.sid, body: req.body }); res.json({ faces: true, status: 'IN_EXAM' }); });
fake.post('/api/sessions/:sid/to-student', (req, res) => { got.push({ toStudent: req.params.sid, msg: req.body.msg }); res.json({ ok: true }); });
fake.post('/api/sessions/:sid/to-lecturer', (req, res) => { got.push({ toLecturer: req.params.sid, msg: req.body.msg }); res.json({ ok: true }); });
fake.get('/api/sessions/:sid/from-lecturer', (req, res) => { got.push({ studentPoll: req.params.sid, after: req.query.after, wait: req.query.wait }); res.json({ msgs: [{ n: 1, type: 'watch', viewer: 'v1' }], next: 1 }); });
fake.get('/api/exams/:id/from-students', (req, res) => { got.push({ lecturerPoll: req.params.id, after: req.query.after }); res.json({ msgs: [{ n: 1, type: 'offer', sid: SID, viewer: 'v1', sdp: 'x' }], next: 1 }); });
fake.get('/api/exams/:id/monitor', (req, res) => { got.push({ monitor: req.params.id, q: req.query.frames ?? null }); res.json({ counts: {}, students: [{ id: SID }] }); });
fake.get('/api/exams/:id/frames', (req, res) => { got.push({ frames: req.params.id, ids: req.query.ids }); res.json({ frames: {} }); });
fake.post('/api/exams/:id/pause-all', (req, res) => { got.push({ pause: req.params.id }); res.json({ ok: true, changed: 2 }); });
fake.post('/api/exams/:id/resume-all', (req, res) => { got.push({ resume: req.params.id }); res.json({ ok: true, changed: 1 }); });
fake.patch('/api/exams/:id', (req, res) => { got.push({ patch: req.params.id, body: req.body }); res.json({ ok: true }); });
const fakeSrv = fake.listen(0);
process.env.MYSEB_URL = `http://127.0.0.1:${(fakeSrv.address() as any).port}`; process.env.MYSEB_SERVICE_KEY = 'svc-key'; process.env.APP_URL = 'https://www.bwenge.space';
const { mySebGuard, pauseAll, resumeAll, setLiveFaces, setLiveMode, formTarget, iceServers, studentSignalPull, studentSignalPush, lecturerSignalPull, lecturerSignalPush, monitor, frames } = await import('../server/services/mySeb.js');
import { createHmac } from 'node:crypto';
const { liveReportHandler } = await import('../server/routes/mySebRoutes.js');

const form = await prisma.applicationForm.create({ data: { id: randomUUID(), userId: 'u1', title: 'Quiz', schema: JSON.stringify({ title: 'Quiz', exam: { requireMyseb: true, mysebExamId: EXAM } }) } });
const open = await prisma.applicationForm.create({ data: { id: randomUUID(), userId: 'u1', title: 'Open', schema: JSON.stringify({ title: 'Open' }) } });
const app = express(); app.use(express.json());
app.post('/api/myseb/live/form/:id', mySebGuard('form'), liveReportHandler);
const srv = app.listen(0); const base = `http://127.0.0.1:${(srv.address() as any).port}`;
test.after(() => { srv.close(); fakeSrv.close(); });
const IN = { 'Content-Type': 'application/json', 'X-MySEB-Key': 'tok', 'X-MySEB-Client': 'desktop', 'X-MySEB-Device': 'd1', 'User-Agent': 'Mozilla MySEB/1.0 (desktop)' };
const post = (id: string, body: unknown, headers: Record<string, string> = IN) => fetch(`${base}/api/myseb/live/form/${id}`, { method: 'POST', headers, body: JSON.stringify(body) });

test('a live MySEB student reports their question; MySEB learns whether pictures are wanted', async () => {
  const r = await post(form.id, { question: { index: 3, total: 10, label: 'x'.repeat(500) }, camera: 'on', frame: 'data:image/jpeg;base64,AAAA' });
  assert.equal(r.status, 200); assert.deepEqual(await r.json(), { faces: true, live: false, sound: false, source: 'camera' });
  const last = got.at(-1); assert.equal(last.sid, SID);
  assert.equal(last.body.question.index, 3); assert.ok(last.body.question.label.length <= 200); assert.equal(last.body.frame, 'data:image/jpeg;base64,AAAA');
});

test('reports are limited to one every 3 seconds per student', async () => {
  const before = got.length;
  await post(form.id, { camera: 'on' });
  assert.equal(got.length, before, 'second report within 3 s is not forwarded');
});

test('nobody outside MySEB can report, and a form that does not need MySEB ignores reports', async () => {
  assert.equal((await post(form.id, { camera: 'on' }, { 'Content-Type': 'application/json' })).status, 403);
  assert.equal((await post(form.id, { camera: 'on' }, { ...IN, 'User-Agent': 'Chrome' })).status, 403);
  assert.equal((await post(open.id, { camera: 'on' }, { 'Content-Type': 'application/json' })).status, 204);
});

test('pause everyone, let everyone continue and the camera-pictures switch act on the lecturer\'s own MySEB exam', async () => {
  const t = formTarget('u1', form.id);
  assert.equal((await pauseAll(t)).changed, 2); assert.deepEqual(got.at(-1), { pause: EXAM });
  assert.equal((await resumeAll(t)).changed, 1); assert.deepEqual(got.at(-1), { resume: EXAM });
  await setLiveFaces(t, true); assert.deepEqual(got.at(-1), { patch: EXAM, body: { liveFaces: true } });
  await assert.rejects(pauseAll(formTarget('someone-else', form.id)), /not found/i);
});

test('live video set-up: student and lecturer messages are relayed, and a lecturer can only message students in their own room', async () => {
  const pull = await studentSignalPull(SID, 4, new AbortController().signal);
  assert.equal(pull.msgs[0].type, 'watch'); assert.deepEqual(got.at(-1), { studentPoll: SID, after: '4', wait: '20000' });
  await studentSignalPush(SID, { type: 'offer', viewer: 'v1', sdp: 'x' }); assert.deepEqual(got.at(-1), { toLecturer: SID, msg: { type: 'offer', viewer: 'v1', sdp: 'x' } });
  const t = formTarget('u1', form.id);
  const inbox = await lecturerSignalPull(t, 0, new AbortController().signal); assert.equal(inbox.msgs[0].sid, SID); assert.equal((got.find((g) => g.lecturerPoll) as any).lecturerPoll, EXAM);
  await lecturerSignalPush(t, SID, { type: 'answer', viewer: 'v1', sdp: 'y' }); assert.deepEqual(got.at(-1), { toStudent: SID, msg: { type: 'answer', viewer: 'v1', sdp: 'y' } });
  await assert.rejects(lecturerSignalPush(t, randomUUID(), { type: 'watch' }), /not in this test/);   // a student who is not in this lecturer's room
  await assert.rejects(lecturerSignalPush(t, 'not-a-uuid', { type: 'watch' }), /Bad session id/);
  await assert.rejects(lecturerSignalPush(formTarget('someone-else', form.id), SID, { type: 'watch' }), /not found/i);
});

test('the room poll can leave the pictures out, and asks for them only for the tiles on screen', async () => {
  const t = formTarget('u1', form.id);
  await monitor(t, { frames: false }); assert.equal((got.find((g) => g.monitor && g.q === '0') as any).q, '0');
  await frames(t, [SID, 'not-a-uuid']); assert.deepEqual(got.at(-1), { frames: EXAM, ids: SID });
  await setLiveMode(t, 'live', true); assert.deepEqual(got.at(-1), { patch: EXAM, body: { liveMode: 'live', liveSound: true } });
  await setLiveMode(t, 'pictures', true); assert.deepEqual(got.at(-1), { patch: EXAM, body: { liveMode: 'pictures', liveSound: false } }, 'sound exists only in live mode');
  await setLiveMode(t, 'live', true, { source: 'screen', leaveAction: 'pause_then_end' });
  assert.deepEqual(got.at(-1), { patch: EXAM, body: { liveMode: 'live', liveSound: false, liveSource: 'screen', leaveAction: 'pause_then_end' } }, 'a screen-only room never listens');
  await setLiveMode(t, 'live', true, { source: 'everything', leaveAction: 'delete' });
  assert.deepEqual(got.at(-1), { patch: EXAM, body: { liveMode: 'live', liveSound: true } }, 'unknown values are dropped');
});

test('network helpers for live video: STUN alone, or short-lived TURN passwords', () => {
  delete process.env.MYSEB_TURN_URLS; delete process.env.MYSEB_TURN_SECRET;
  assert.deepEqual(iceServers(), { iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }], turn: false });
  process.env.MYSEB_TURN_URLS = 'turn:turn.example.org:3478,turns:turn.example.org:5349'; process.env.MYSEB_TURN_SECRET = 'shared-secret';
  const r = iceServers(); const t = r.iceServers[1] as any;
  assert.equal(r.turn, true); assert.deepEqual(t.urls, ['turn:turn.example.org:3478', 'turns:turn.example.org:5349']);
  const [expiry] = t.username.split(':'); const left = Number(expiry) - Date.now() / 1000;
  assert.ok(left > 5 * 3600 && left <= 6 * 3600 + 5, 'the password lasts about 6 hours');
  assert.equal(t.credential, createHmac('sha1', 'shared-secret').update(t.username).digest('base64'), 'coturn use-auth-secret format');
  assert.ok(!JSON.stringify(r).includes('shared-secret'), 'the secret itself is never sent');
});

test('the live room always gets an exam block, even before any MySEB exam exists', async () => {
  const { monitor } = await import('../server/services/mySeb.js');
  const r: any = await monitor(async () => ({ mysebExamId: null, title: 'Quiz 1' } as any));
  assert.equal(r.exam.status, 'active');
  assert.equal(r.exam.title, 'Quiz 1');
  assert.deepEqual(r.students, []);
});

test('MySEB finds the site address even when APP_URL is not set', async () => {
  const keep = { a: process.env.APP_URL, b: process.env.APP_BASE_URL };
  delete process.env.APP_URL; delete process.env.APP_BASE_URL;
  try {
    const { generateCode } = await import('../server/services/mySeb.js');
    let sent: any = null;
    const r: any = await generateCode(async () => ({ kind: 'form', ref: 'f1', title: 'T', url: 'https://www.bwenge.space/forms/f1', mysebExamId: null, leaveAction: 'record', minutes: 10, saveExamId: async () => undefined } as any)).catch((e) => e);
    assert.notEqual(r?.code, 'APP_URL_MISSING', String(r?.message));
    void sent;
  } finally { if (keep.a) process.env.APP_URL = keep.a; if (keep.b) process.env.APP_BASE_URL = keep.b; }
});
