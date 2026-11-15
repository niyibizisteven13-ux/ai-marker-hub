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
fake.post('/api/exams/:id/pause-all', (req, res) => { got.push({ pause: req.params.id }); res.json({ ok: true, changed: 2 }); });
fake.post('/api/exams/:id/resume-all', (req, res) => { got.push({ resume: req.params.id }); res.json({ ok: true, changed: 1 }); });
fake.patch('/api/exams/:id', (req, res) => { got.push({ patch: req.params.id, body: req.body }); res.json({ ok: true }); });
const fakeSrv = fake.listen(0);
process.env.MYSEB_URL = `http://127.0.0.1:${(fakeSrv.address() as any).port}`; process.env.MYSEB_SERVICE_KEY = 'svc-key'; process.env.APP_URL = 'https://www.bwenge.space';
const { mySebGuard, pauseAll, resumeAll, setLiveFaces, formTarget } = await import('../server/services/mySeb.js');
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
  assert.equal(r.status, 200); assert.deepEqual(await r.json(), { faces: true });
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
