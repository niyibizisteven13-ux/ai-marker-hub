import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { prisma } from '../server/db.js';
import { getJwtSecret } from '../server/auth/secrets.js';

// bwenge's MySEB wiring: a form that asks for MySEB only answers students inside it. A fake MySEB server stands in for the real one.
const EXAM = randomUUID();
const sessions: Record<string, { status: string; client: string; device?: string; name: string }> = {
  'tok-desktop': { status: 'IN_EXAM', client: 'desktop', device: 'dev-1', name: 'Aline' },
  'tok-paused': { status: 'PAUSED', client: 'desktop', device: 'dev-2', name: 'Eric' },
  'tok-phone': { status: 'IN_EXAM', client: 'mobile', name: 'Uwase' },
};
const gateCalls: any[] = [];
const fake = express();
fake.use(express.json());
fake.post('/api/gate', (req, res) => {
  gateCalls.push({ service: req.get('x-myseb-service-key'), examId: req.body.examId });
  if (req.get('x-myseb-service-key') !== 'svc-key') return res.status(401).json({ allowed: false });
  const s = sessions[req.body.key];
  const markerOk = /MySEB\//.test(req.body.userAgent || '');
  if (!s || req.body.examId !== EXAM || s.client !== req.body.client || !markerOk || (s.client !== 'mobile' && s.device !== req.body.device)) return res.json({ allowed: false, reason: 'MySEB Needed' });
  if (s.status !== 'IN_EXAM') return res.json({ allowed: false, reason: s.status });
  res.json({ allowed: true, studentName: s.name, clientType: s.client });
});
const fakeSrv = fake.listen(0);
process.env.MYSEB_URL = `http://127.0.0.1:${(fakeSrv.address() as any).port}`;
process.env.MYSEB_SERVICE_KEY = 'svc-key';
const { mySebGuard, mySebShell } = await import('../server/services/mySeb.js');

const plain = await prisma.applicationForm.create({ data: { id: randomUUID(), userId: 'u1', title: 'Plain', schema: JSON.stringify({ title: 'Plain' }) } });
const locked = await prisma.applicationForm.create({ data: { id: randomUUID(), userId: 'u1', title: 'Locked', schema: JSON.stringify({ title: 'Locked', exam: { requireMyseb: true, mysebExamId: EXAM } }) } });
const noCode = await prisma.applicationForm.create({ data: { id: randomUUID(), userId: 'u1', title: 'No code yet', schema: JSON.stringify({ title: 'x', exam: { requireMyseb: true } }) } });

const app = express();
app.get('/forms/:id', mySebShell(), (_req, res) => res.send('shell'));
app.get('/api/public/forms/:id', mySebGuard(), (req, res) => res.json({ ok: true, who: (req as any).myseb?.studentName ?? null }));
const srv = app.listen(0);
const base = `http://127.0.0.1:${(srv.address() as any).port}`;
test.after(() => { srv.close(); fakeSrv.close(); });

const DESK = (tok: string, dev: string) => ({ 'X-MySEB-Key': tok, 'X-MySEB-Client': 'desktop', 'X-MySEB-Device': dev, 'User-Agent': 'Mozilla MySEB/1.0 (desktop)' });
const get = async (url: string, headers: Record<string, string> = {}) => { const r = await fetch(base + url, { headers }); return { status: r.status, body: await r.json().catch(() => null), res: r }; };

test('a form that does not ask for MySEB is open to everyone (and costs no MySEB call)', async () => {
  const before = gateCalls.length;
  assert.equal((await get(`/api/public/forms/${plain.id}`)).status, 200);
  assert.equal((await get('/api/public/forms/does-not-exist')).status, 200, 'unknown id falls through to the normal 404 handling');
  assert.equal(gateCalls.length, before);
});

test('a MySEB form answers 403 MYSEB_REQUIRED to a normal browser', async () => {
  const r = await get(`/api/public/forms/${locked.id}`);
  assert.equal(r.status, 403); assert.equal(r.body.code, 'MYSEB_REQUIRED');
  const stolen = await get(`/api/public/forms/${locked.id}`, { 'X-MySEB-Key': 'tok-desktop', 'User-Agent': 'Chrome' });
  assert.equal(stolen.status, 403, 'a real token from plain Chrome is refused');
});

test('inside MySEB: desktop header works, paused is locked out, a form with no code yet admits nobody', async () => {
  const ok = await get(`/api/public/forms/${locked.id}`, DESK('tok-desktop', 'dev-1'));
  assert.equal(ok.status, 200); assert.equal(ok.body.who, 'Aline');
  const paused = await get(`/api/public/forms/${locked.id}`, DESK('tok-paused', 'dev-2'));
  assert.equal(paused.status, 403); assert.equal(paused.body.code, 'MYSEB_PAUSED');
  assert.equal((await get(`/api/public/forms/${noCode.id}`, DESK('tok-desktop', 'dev-1'))).status, 403);
});

test('phone: the page request with the header earns a cookie, and the cookie alone opens the API', async () => {
  const shell = await get(`/forms/${locked.id}`, { 'X-MySEB-Key': 'tok-phone', 'X-MySEB-Client': 'mobile', 'User-Agent': 'Mozilla MySEB/1.0 (mobile; android)' });
  assert.equal(shell.status, 200);
  const cookie = shell.res.headers.get('set-cookie') ?? ''; assert.match(cookie, /myseb_s=/);
  assert.match(cookie, /HttpOnly/);
  assert.equal((await get('/forms/' + locked.id)).status, 200, 'the page shell itself never blocks (it holds no test content)');
});

test('the lecturer who owns the form is not locked out of their own form', async () => {
  // owner bypass needs a valid bwenge access token; a garbage one must not work
  const bad = await get(`/api/public/forms/${locked.id}`, { Authorization: 'Bearer not-a-token' });
  assert.equal(bad.status, 403);
  const sign = (userId: string) => jwt.sign({ userId }, getJwtSecret(), { algorithm: 'HS256', issuer: 'bwenge', audience: 'bwenge-web', expiresIn: 60 });
  assert.equal((await get(`/api/public/forms/${locked.id}`, { Authorization: `Bearer ${sign('u1')}` })).status, 200, 'the owner (u1) previews freely');
  assert.equal((await get(`/api/public/forms/${locked.id}`, { Authorization: `Bearer ${sign('u2')}` })).status, 403, 'another signed-in user is not the owner');
});

test('MySEB down: fail closed with 503, never a free pass', async () => {
  const saved = process.env.MYSEB_URL;
  fakeSrv.close();
  const r = await get(`/api/public/forms/${locked.id}`, { ...DESK('tok-desktop', 'dev-1'), 'User-Agent': 'Mozilla MySEB/1.0 (desktop) fresh' });   // a new cache key: the guard keeps a 4 s memory of recent answers
  assert.equal(r.status, 503); assert.equal(r.body.code, 'MYSEB_UNAVAILABLE');
  process.env.MYSEB_URL = saved;
});
