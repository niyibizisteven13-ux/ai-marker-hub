import { test as baseTest } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';

// MySEB is sold: a monthly plan (US$5) or one test (1,500 RWF), paid by Mobile Money and confirmed by the administrator.
// Runs against PostgreSQL (the mock database ignores the filters these use); CI provides it.
const NO_PG = !process.env.DATABASE_URL && 'needs PostgreSQL (DATABASE_URL); CI provides it';
const test = (name: string, fn: () => Promise<void>) => baseTest(name, { skip: NO_PG }, fn);

const fake = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const json = (o: unknown) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(o));
    if (req.url === '/api/exams' && req.method === 'POST') return json({ id: randomUUID() });
    if (/\/generate-code$/.test(req.url ?? '')) return json({ code: '482910', display: '482 910', qrSvg: '<svg/>', joinUrl: 'https://www.bwenge.space/myseb/join/482910', expiresAt: '2026-12-01T00:00:00Z' });
    res.writeHead(404).end('{}');
  });
}).listen(0);
await new Promise((r) => fake.once('listening', r));
Object.assign(process.env, { MYSEB_URL: `http://127.0.0.1:${(fake.address() as AddressInfo).port}`, MYSEB_SERVICE_KEY: 'svc', APP_BASE_URL: 'https://www.bwenge.space' });

const { prisma } = await import('../server/db.js');
const db = prisma as any;
const S = await import('../server/services/mySebAccess.js');
const { lecturerRouter, adminRouter } = await import('../server/routes/mySebAccessRoutes.js');
const { generateCode, MySebError } = await import('../server/services/mySeb.js');
const settings = await import('../server/services/platform/settings.js');

const app = express(); app.use(express.json());
const as = (req: any, _res: any, next: any) => { const u = req.headers['x-test-user']; if (typeof u === 'string') req.user = { userId: u }; next(); };
app.use('/api/myseb-access', as, lecturerRouter); app.use('/api/admin/myseb-access', as, adminRouter);
const server = app.listen(0); const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const admin = `adm-${randomUUID().slice(0, 8)}`; const lect = `lec-${randomUUID().slice(0, 8)}`; const other = `oth-${randomUUID().slice(0, 8)}`;
for (const [id, role] of [[admin, 'ADMIN'], [lect, 'INSTRUCTOR'], [other, 'INSTRUCTOR']] as const) await db.user.create({ data: { id, email: `${id}@test.local`, name: `Name ${id}`, passwordHash: 'x', role } });
baseTest.after(async () => { await S.savePaymentConfig({ monthUsd: 5, testRwf: 1500, momoCode: '2191184', momoName: 'Niyibizi Steven', whatsapp: '' }, admin).catch(() => undefined); settings.__setPlatformSettingsForTests(settings.DEFAULT_SETTINGS); server.close(); fake.close(); });
const call = async (p: string, method = 'GET', body?: unknown, who: string | null = lect) => {
  const r = await fetch(`${base}${p}`, { method, headers: { 'Content-Type': 'application/json', ...(who ? { 'x-test-user': who } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};
const A = '/api/admin/myseb-access'; const L = '/api/myseb-access';
const target = (ownerId: string, ref: string) => async () => ({ ownerId, kind: 'form' as const, ref, title: 'Biology', url: 'https://www.bwenge.space/forms/x', mysebExamId: randomUUID(), leaveAction: 'record' as const, minutes: 45, async saveExamId() {} });

test('the price and where to pay are the ones you gave, and the month is shown in RWF too', async () => {
  const cfg = await S.paymentConfig();
  assert.deepEqual({ ...cfg, whatsapp: '' }, { monthUsd: 5, testRwf: 1500, momoCode: '2191184', momoName: 'Niyibizi Steven', whatsapp: '' });
  assert.equal(S.monthRwf({ ...cfg, monthUsd: 5 }) % 100, 0); assert.ok(S.monthRwf(cfg) > 6000 && S.monthRwf(cfg) < 9000);
  const info = S.paymentInfo({ ...cfg, whatsapp: '250788123456' }, { email: 'a@b.co' });
  assert.match(info.whatsappLink!, /^https:\/\/wa\.me\/250788123456\?text=/); assert.match(decodeURIComponent(info.whatsappLink!), /a@b\.co/);
  assert.equal(S.paymentInfo({ ...cfg, whatsapp: '' }).whatsappLink, null, 'no link until the number is set');
  const msg = S.paymentMessage(info, 'a@b.co');
  for (const part of ['US$5', '1,500 RWF', '2191184', 'Niyibizi Steven', 'WhatsApp to +250788123456', 'a@b.co', 'few minutes']) assert.ok(msg.includes(part), `the message says ${part}`);
});

test('the gate: nothing without payment, a test credit opens one test, a month opens all, administrators and a switched-off paywall are free', async () => {
  settings.__setPlatformSettingsForTests(settings.DEFAULT_SETTINGS);
  const denied = await S.requireMySebAccess(lect, 'form:f1').catch((e) => e);
  assert.ok(denied instanceof MySebError); assert.equal(denied.status, 402); assert.equal(denied.code, 'MYSEB_PAYMENT_REQUIRED'); assert.equal((denied.data as any).momoCode, '2191184'); assert.match(denied.message, /2191184/);
  await S.requireMySebAccess(admin, 'form:any');                                 // administrators are never charged
  // one test credit: the first code for a test takes it; more codes for the same test are free; another test needs another credit
  await S.grantAccess({ userId: lect, plan: 'TEST', tests: 1, by: admin });
  await S.requireMySebAccess(lect, 'form:f1'); assert.equal((await S.accessOf(lect)).tests, 0);
  await S.requireMySebAccess(lect, 'form:f1');
  assert.equal(((await S.requireMySebAccess(lect, 'form:f2').catch((e) => e)) as any).status, 402);
  // a month opens everything, and extends from the later of now and the current end
  const g1 = await S.grantAccess({ userId: lect, plan: 'MONTH', by: admin });
  const days = (Date.parse(g1.monthUntil!) - Date.now()) / 86_400_000; assert.ok(days > 29.9 && days < 30.1);
  await S.requireMySebAccess(lect, 'form:f2'); await S.requireMySebAccess(lect, 'task:t9');
  const g2 = await S.grantAccess({ userId: lect, plan: 'MONTH', months: 2, by: admin });
  assert.ok(Math.abs((Date.parse(g2.monthUntil!) - Date.parse(g1.monthUntil!)) / 86_400_000 - 60) < 0.01, 'paying early adds to the end, it does not waste days');
  // revoked: back to nothing
  await S.revokeAccess(lect, admin);
  assert.equal(((await S.requireMySebAccess(lect, 'form:new').catch((e) => e)) as any).status, 402);
  // an ended month no longer counts
  await db.appSetting.update({ where: { key: `myseb-access:${lect}` }, data: { value: { monthUntil: new Date(Date.now() - 1000).toISOString(), tests: 0, usedExams: [], history: [] } } });
  assert.equal((await S.accessStatus(lect, 'INSTRUCTOR')).hasAccess, false);
  // the switch: charging off means free for everyone
  settings.__setPlatformSettingsForTests({ ...settings.DEFAULT_SETTINGS, flags: { 'myseb.requirePayment': false } });
  await S.requireMySebAccess(lect, 'form:free'); assert.equal((await S.accessStatus(lect, 'INSTRUCTOR')).exempt, true);
  settings.__setPlatformSettingsForTests(settings.DEFAULT_SETTINGS);
});

test('getting a code is really behind the gate (the same path the live room and the chat use)', async () => {
  settings.__setPlatformSettingsForTests(settings.DEFAULT_SETTINGS);
  await S.revokeAccess(other, admin);
  const t = target(other, 'form:biology');
  const stopped = await generateCode(t).catch((e) => e); assert.ok(stopped instanceof MySebError && stopped.status === 402 && /2191184/.test(stopped.message), 'no code without payment');
  await S.grantAccess({ userId: other, plan: 'TEST', tests: 1, by: admin });
  assert.equal((await generateCode(t)).display, '482 910', 'one test credit gives the code');
  assert.equal((await generateCode(t)).display, '482 910', 'a new code for the same test is free');
  assert.equal(((await generateCode(target(other, 'form:chemistry')).catch((e) => e)) as any).status, 402, 'another test needs another credit');
});

test('the lecturer sees what they have and how to pay, and tells you they paid (once)', async () => {
  const mine = (await call(L)).json.data;
  assert.equal(mine.status.charging, true); assert.equal(mine.payment.momoCode, '2191184'); assert.equal(mine.pendingRequest, null);
  assert.equal((await call(L, 'GET', undefined, null)).status, 401, 'not signed in');
  assert.equal((await call(`${L}/request`, 'POST', { plan: 'WEEK' })).status, 400);
  const first = await call(`${L}/request`, 'POST', { plan: 'MONTH', note: 'paid 7,400 at 10:15' }); assert.equal(first.status, 200);
  await call(`${L}/request`, 'POST', { plan: 'TEST', note: 'changed my mind: one test' });
  const pending = (await call(A, 'GET', undefined, admin)).json.data.pending.filter((r: any) => r.userId === lect);
  assert.equal(pending.length, 1, 'one waiting request per person'); assert.equal(pending[0].plan, 'TEST'); assert.equal(pending[0].email, `${lect}@test.local`); assert.match(pending[0].note, /one test/);
  assert.equal((await call(L)).json.data.pendingRequest.plan, 'TEST');
});

test('the administrator: set the prices and where to pay, enable an email, approve or reject a request, remove access', async () => {
  assert.equal((await call(`${A}/config`, 'PUT', { momoCode: 'abc' }, admin)).status, 400); assert.equal((await call(`${A}/config`, 'PUT', { whatsapp: '07881' }, admin)).status, 400); assert.equal((await call(`${A}/config`, 'PUT', { surprise: 1 }, admin)).status, 400);
  const saved = (await call(`${A}/config`, 'PUT', { monthUsd: 6, testRwf: 2000, momoCode: '2191184', momoName: 'Niyibizi Steven', whatsapp: '+250 788 123 456'.replace(/\s/g, '') }, admin)).json.data;
  assert.equal(saved.config.whatsapp, '250788123456'); assert.equal(saved.config.testRwf, 2000);
  assert.equal((await call(L)).json.data.payment.whatsappLink.startsWith('https://wa.me/250788123456'), true, 'the lecturer sees the new number at once');
  assert.equal((await call(`${A}/config`, 'PUT', { whatsapp: '+250 (788) 123-456' }, admin)).json.data.config.whatsapp, '250788123456', 'spaces, brackets and dashes in a typed number are fine');
  await call(`${A}/config`, 'PUT', { monthUsd: 5, testRwf: 1500 }, admin);
  // enable by email: a request is closed by it; unknown emails are refused
  assert.equal((await call(`${A}/grant`, 'POST', { email: 'nobody@nowhere.test', plan: 'MONTH' }, admin)).status, 404);
  assert.equal((await call(`${A}/grant`, 'POST', { email: 'not-an-email', plan: 'MONTH' }, admin)).status, 400);
  const g = await call(`${A}/grant`, 'POST', { email: `${lect.toUpperCase()}@test.local`, plan: 'MONTH', months: 2, note: 'MoMo 14,800 RWF' }, admin);
  assert.equal(g.status, 200); assert.ok(g.json.data.monthUntil);
  assert.equal((await call(A, 'GET', undefined, admin)).json.data.pending.filter((r: any) => r.userId === lect).length, 0, 'their waiting request was closed');
  assert.equal((await call(L)).json.data.status.hasAccess, true);
  // approve a request (with the plan changed), reject another
  await call(`${L}/request`, 'POST', { plan: 'MONTH' }, other);
  const req = (await call(A, 'GET', undefined, admin)).json.data.pending.find((r: any) => r.userId === other);
  assert.equal((await call(`${A}/requests/${req.id}/approve`, 'POST', { plan: 'TEST', tests: 3 }, admin)).status, 200);
  assert.equal((await S.accessOf(other)).tests, 3, 'the plan chosen at approval is the one given');
  assert.equal((await call(`${A}/requests/${req.id}/approve`, 'POST', {}, admin)).status, 404, 'already decided');
  const x = `rej-${randomUUID().slice(0, 6)}`; await db.user.create({ data: { id: x, email: `${x}@test.local`, name: 'Rej', passwordHash: 'x', role: 'INSTRUCTOR' } });
  await call(`${L}/request`, 'POST', { plan: 'TEST', note: 'I did not really pay' }, x);
  const rej = (await call(A, 'GET', undefined, admin)).json.data.pending.find((r: any) => r.userId === x);
  assert.equal((await call(`${A}/requests/${rej.id}/reject`, 'POST', {}, admin)).status, 200); assert.equal((await S.accessOf(x)).tests, 0, 'nothing is given on a rejection');
  const list = (await call(A, 'GET', undefined, admin)).json.data;
  assert.ok(list.subscribers.some((s: any) => s.userId === lect && s.monthUntil) && list.subscribers.some((s: any) => s.userId === other && s.tests >= 2));
  assert.ok(list.recent.some((r: any) => r.userId === x && r.status === 'rejected'));
  assert.equal((await call(`${A}/revoke`, 'POST', { userId: other }, admin)).status, 200); assert.equal((await call(`${A}/revoke`, 'POST', { userId: other }, admin)).status, 404, 'nothing left to remove');
  const log = (await db.auditLog.findMany({ where: { resourceId: { in: [lect, other, x] }, action: { startsWith: 'MYSEB_ACCESS' } } })).map((r: any) => r.action);
  for (const a of ['MYSEB_ACCESS_GRANT', 'MYSEB_ACCESS_REJECT', 'MYSEB_ACCESS_REVOKE']) assert.ok(log.includes(a), `${a} is in the audit log`);
});
