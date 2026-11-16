import { test as baseTest } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

const NO_PG = !process.env.DATABASE_URL && 'needs PostgreSQL (DATABASE_URL); CI provides it';
const test = (name: string, fn: () => Promise<void>) => baseTest(name, { skip: NO_PG }, fn);
// The administrator's platform controls against the real routes and database: switches and maintenance, the audit log, one person's account,
// everyone's content, organisations, background jobs, Telegram and security. Auth is simulated (the real app mounts the router behind
// requireAuth + requireRole('ADMIN')).
const { prisma } = await import('../server/db.js');
const db = prisma as any;
const router = (await import('../server/routes/adminPlatformRoutes.js')).default;
const settings = await import('../server/services/platform/settings.js');
const { platformGate, platformStatus } = await import('../server/services/platform/gate.js');
const { recordAuthFailure, isBlockedIp } = await import('../server/services/platform/security.js');
const { FileJobQueue } = await import('../server/services/ai/jobs/fileJobQueue.js');

const app = express();
app.set('trust proxy', true);
app.use(express.json());
app.use('/api', platformGate);
app.get('/api/platform/status', platformStatus);
app.get('/api/ping', (_req, res) => res.json({ ok: true }));
app.use('/api/admin/platform', (req, res, next) => { const u = req.headers['x-test-user']; if (typeof u !== 'string') return res.status(401).json({ error: 'no' }); (req as any).user = { userId: u }; next(); }, router);
const server = app.listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'adminplat-'));
const admin = `adm-${randomUUID().slice(0, 8)}`; const person = `usr-${randomUUID().slice(0, 8)}`; const other = `oth-${randomUUID().slice(0, 8)}`;
for (const [id, role] of [[admin, 'ADMIN'], [person, 'INSTRUCTOR'], [other, 'INSTRUCTOR']] as const) await db.user.create({ data: { id, email: `${id}@test.local`, name: `Name ${id}`, passwordHash: 'x', role } });
baseTest.after(async () => { await settings.savePlatformSettings({ flags: Object.fromEntries(settings.FLAG_IDS.map((f) => [f, true])), maintenance: { on: false, message: '' }, announcement: null, blockedIps: [], storageOverridesMb: { [person]: 0 } }, admin).catch(() => undefined); server.close(); await fs.rm(dir, { recursive: true, force: true }); });

const call = async (p: string, method = 'GET', body?: unknown, who: string | null = admin, ip?: string) => {
  const r = await fetch(`${base}${p}`, { method, headers: { 'Content-Type': 'application/json', ...(who ? { 'x-test-user': who } : {}), ...(ip ? { 'x-forwarded-for': ip } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let json: any = {}; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, json, text, headers: r.headers };
};
const P = '/api/admin/platform';

test('switches: validated, saved, and they take effect (chat tools, MySEB)', async () => {
  assert.equal((await call(`${P}/settings`, 'GET', undefined, null)).status, 401);
  const first = (await call(`${P}/settings`)).json.data;
  assert.ok(first.flags.length >= 10 && first.flags.every((f: any) => f.on), 'everything is on by default');
  assert.ok(first.flags.some((f: any) => f.id === 'myseb.browserMode'));
  assert.equal((await call(`${P}/settings`, 'PUT', { flags: { 'not.a.switch': false } })).status, 400, 'an unknown switch is refused');
  assert.equal((await call(`${P}/settings`, 'PUT', { surprise: 1 })).status, 400, 'unknown fields are refused');
  const off = await call(`${P}/settings`, 'PUT', { flags: { 'chat.workTools': false, 'myseb.browserMode': false } });
  assert.equal(off.status, 200); assert.equal(off.json.data.flags.find((f: any) => f.id === 'chat.workTools').on, false);
  assert.ok(settings.disabledTools().has('mark_task') && settings.disabledTools().has('release_task_results'), 'the chat tools of that group are switched off');
  assert.ok(!settings.disabledTools().has('create_form'), 'other groups are untouched');
  assert.equal(settings.flagOn('myseb.browserMode'), false);
  await call(`${P}/settings`, 'PUT', { flags: { 'chat.workTools': true, 'myseb.browserMode': true } });
  assert.equal(settings.disabledTools().size, 0);
});

test('the chat agent really stops offering a switched-off tool', async () => {
  const { buildToolkit } = await import('../server/services/ai/tools/index.js');
  const full = buildToolkit({ platform: {} as any, work: {} as any }).names();
  assert.ok(full.includes('mark_task') && full.includes('live_room_status'));
  await call(`${P}/settings`, 'PUT', { flags: { 'chat.platformTools': false } });
  const off = settings.disabledTools();
  assert.ok(['list_live_rooms', 'live_room_student', 'list_courses'].every((n) => off.has(n)));
  assert.ok(full.filter((n) => !off.has(n)).includes('mark_task'), 'the other groups stay');
  await call(`${P}/settings`, 'PUT', { flags: { 'chat.platformTools': true } });
});

test('maintenance mode and the announcement: the public sees them, the administrator can always get in', async () => {
  assert.deepEqual((await call('/api/platform/status', 'GET', undefined, null)).json.maintenance, { on: false });
  assert.equal((await call(`${P}/settings`, 'PUT', { announcement: { text: 'x'.repeat(400) } })).status, 400, 'too long');
  await call(`${P}/settings`, 'PUT', { announcement: { text: 'Exams paused at 14:00 for 10 minutes', level: 'warning', until: new Date(Date.now() + 3600_000).toISOString() } });
  let st = (await call('/api/platform/status', 'GET', undefined, null)).json;
  assert.equal(st.announcement.text, 'Exams paused at 14:00 for 10 minutes'); assert.equal(st.announcement.level, 'warning');
  await call(`${P}/settings`, 'PUT', { announcement: { text: 'Old news', level: 'info', until: new Date(Date.now() - 1000).toISOString() } });
  assert.equal((await call('/api/platform/status', 'GET', undefined, null)).json.announcement, null, 'an expired announcement is not shown');
  await call(`${P}/settings`, 'PUT', { announcement: null });

  await call(`${P}/settings`, 'PUT', { maintenance: { on: true, message: 'Back in 10 minutes' } });
  const held = await call('/api/ping', 'GET', undefined, null);
  assert.equal(held.status, 503); assert.equal(held.json.maintenance, true); assert.equal(held.json.error, 'Back in 10 minutes');
  assert.equal((await call('/api/platform/status', 'GET', undefined, null)).json.maintenance.message, 'Back in 10 minutes');
  assert.equal((await call(`${P}/settings`)).status, 200, 'the admin pages stay open');
  await call(`${P}/settings`, 'PUT', { maintenance: { on: false, message: '' } });
  assert.equal((await call('/api/ping', 'GET', undefined, null)).status, 200);
});

test('blocked addresses: refused everywhere except the status, and you cannot block yourself', async () => {
  assert.equal((await call(`${P}/settings`, 'PUT', { blockedIps: ['203.0.113.9'] }, admin, '203.0.113.9')).status, 400, 'that is your own address');
  assert.equal((await call(`${P}/settings`, 'PUT', { blockedIps: ['203.0.113.'] }, admin, '203.0.113.77')).status, 400, 'a prefix that covers you');
  assert.equal((await call(`${P}/settings`, 'PUT', { blockedIps: ['203.0.113.9', '198.51.100.'] }, admin, '192.0.2.1')).status, 200);
  assert.equal((await call('/api/ping', 'GET', undefined, null, '203.0.113.9')).status, 403);
  assert.equal((await call('/api/ping', 'GET', undefined, null, '198.51.100.42')).status, 403, 'a prefix blocks the whole range');
  assert.equal((await call('/api/ping', 'GET', undefined, null, '192.0.2.50')).status, 200);
  assert.equal((await call('/api/platform/status', 'GET', undefined, null, '203.0.113.9')).status, 200, 'status stays readable');
  assert.ok(isBlockedIp('198.51.100.1', ['198.51.100.']) && !isBlockedIp('198.51.1001.1', ['198.51.100.']) && !isBlockedIp('', ['x.x.x.x']));
  await call(`${P}/settings`, 'PUT', { blockedIps: [] });
});

test('the audit log: every change is recorded; filters, paging and CSV export', async () => {
  const mark = new Date().toISOString();
  await call(`${P}/settings`, 'PUT', { flags: { 'chat.python': false } }); await call(`${P}/settings`, 'PUT', { flags: { 'chat.python': true } });
  const all = (await call(`${P}/audit?action=UPDATE_PLATFORM_SETTINGS&actor=${admin}&limit=2`)).json;
  assert.equal(all.data.length, 2); assert.ok(all.next, 'more pages');
  assert.ok(all.data.every((r: any) => r.actorId === admin && r.action === 'UPDATE_PLATFORM_SETTINGS'));
  const page2 = (await call(`${P}/audit?action=UPDATE_PLATFORM_SETTINGS&actor=${admin}&limit=2&before=${encodeURIComponent(all.next)}`)).json;
  assert.ok(page2.data.every((r: any) => new Date(r.createdAt) < new Date(all.next)));
  assert.ok((await call(`${P}/audit?q=chat.python&from=${encodeURIComponent(mark)}`)).json.data.length >= 2, 'search inside the details, from a time');
  assert.equal((await call(`${P}/audit?actor=nobody-${randomUUID()}`)).json.data.length, 0);
  assert.equal((await call(`${P}/audit?limit=9999`)).status, 400);
  const csv = await call(`${P}/audit?format=csv&action=UPDATE_PLATFORM_SETTINGS`);
  assert.match(csv.headers.get('content-type') ?? '', /text\/csv/); assert.match(csv.text, /^time,actor,action,resource type,resource id,details\n/); assert.match(csv.text, /UPDATE_PLATFORM_SETTINGS/);
  assert.match(csv.text, /"\{""changed"":/, 'commas and quotes in the details are escaped');
});

test("one person's account: details, storage, sessions, export, and erasing", async () => {
  await db.refreshSession.create({ data: { id: randomUUID(), userId: person, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 86400_000), createdAt: new Date() } }).catch(() => undefined);
  const formId = randomUUID();
  await db.applicationForm.create({ data: { id: formId, userId: person, title: 'Biology midterm', schema: JSON.stringify({ title: 'Biology midterm', fields: [], exam: { enabled: true, minutes: 45, requireMyseb: true } }), rubric: null, selectionSettings: null, createdAt: new Date(), updatedAt: new Date() } });
  const d = (await call(`${P}/users/${person}`)).json.data;
  assert.equal(d.user.id, person); assert.equal(d.content.forms.length, 1); assert.equal(d.content.forms[0].myseb, true); assert.ok(d.storage && d.storage.extraMb === 0);
  assert.equal((await call(`${P}/users/nope-${randomUUID()}`)).status, 404);
  // extra storage on top of the plan
  const before = d.storage.limitMb;
  assert.equal((await call(`${P}/users/${person}/storage`, 'POST', { extraMb: 500 })).json.data.extraMb, 500);
  const after = (await call(`${P}/users/${person}`)).json.data.storage; assert.equal(after.limitMb, before + 500); assert.equal(after.extraMb, 500);
  assert.equal((await call(`${P}/users/${person}/storage`, 'POST', { extraMb: -1 })).status, 400);
  await call(`${P}/users/${person}/storage`, 'POST', { extraMb: 0 });
  assert.equal((await call(`${P}/users/${person}`)).json.data.storage.extraMb, 0);
  // sessions
  assert.ok((await call(`${P}/users/${person}/revoke-sessions`, 'POST')).json.data.revoked >= 0);
  // export
  const ex = await call(`${P}/users/${person}/export`);
  assert.match(ex.headers.get('content-disposition') ?? '', /attachment/); assert.equal(JSON.parse(ex.text).user.email, `${person}@test.local`);
  // erase: needs the right email, not yourself
  assert.equal((await call(`${P}/users/${person}/erase`, 'POST', { confirmEmail: 'wrong@x.y' })).status, 400);
  assert.equal((await call(`${P}/users/${admin}/erase`, 'POST', { confirmEmail: `${admin}@test.local` })).status, 400, 'not your own account');
  const gone = await call(`${P}/users/${person}/erase`, 'POST', { confirmEmail: `${person.toUpperCase()}@test.local` });
  assert.equal(gone.status, 200); assert.equal(gone.json.data.formsClosed, 1);
  const row = await db.user.findUnique({ where: { id: person } });
  assert.match(row.email, /^erased-.*@erased\.invalid$/); assert.equal(row.name, 'Erased user'); assert.ok(row.disabledAt);
  assert.equal(JSON.parse((await db.applicationForm.findUnique({ where: { id: formId } })).schema).acceptingResponses, false, 'their forms stop taking answers');
  assert.ok((await db.auditLog.findMany({ where: { action: 'ERASE_USER', resourceId: person } })).length === 1, 'recorded');
});

test("everyone's content: find a form, close it, and a task on behalf of its owner", async () => {
  const fid = randomUUID(); const tag = `Runaway${randomUUID().slice(0, 6)}`;
  await db.applicationForm.create({ data: { id: fid, userId: other, title: `${tag} survey`, schema: JSON.stringify({ title: `${tag} survey`, fields: [] }), rubric: null, selectionSettings: null, createdAt: new Date(), updatedAt: new Date() } });
  const list = (await call(`${P}/content/forms?q=${tag}`)).json.data;
  assert.equal(list.length, 1); assert.equal(list[0].owner.email, `${other}@test.local`); assert.equal(list[0].open, true);
  assert.equal((await call(`${P}/content/forms/${fid}/close`, 'POST', { reason: 'reported as spam' })).status, 200);
  assert.equal((await call(`${P}/content/forms?q=${tag}`)).json.data[0].open, false);
  assert.equal((await call(`${P}/content/forms/${randomUUID()}/close`, 'POST')).status, 404);
  const log = (await call(`${P}/audit?action=CLOSE_FORM&q=${fid}`)).json.data; assert.equal(log.length, 0, 'the log holds the owner and reason, not the id as text'); assert.equal((await call(`${P}/audit?action=CLOSE_FORM&actor=${admin}`)).json.data.length, 1);
});

test('organisations: members come and go, and removing needs care', async () => {
  const org = await db.organization.create({ data: { name: 'Old name' } });
  assert.equal((await call(`${P}/organizations/${org.id}/members`, 'POST', { email: `${other}@test.local`, role: 'TEACHER' })).status, 200);
  assert.equal((await call(`${P}/organizations/${org.id}/members`, 'POST', { email: 'nobody@nowhere.test' })).status, 404, 'must have an account');
  assert.equal((await call(`${P}/organizations/${org.id}/members`, 'POST', { email: 'not-an-email' })).status, 400);
  const listed = (await call(`${P}/organizations`)).json.data.find((o: any) => o.id === org.id);
  assert.equal(listed.members.length, 1); assert.equal(listed.members[0].email, `${other}@test.local`);
  assert.equal((await call(`${P}/organizations/${org.id}`, 'PATCH', { name: 'New name' })).status, 200);
  assert.equal((await call(`${P}/organizations/${randomUUID()}`, 'PATCH', { name: 'x' })).status, 404);
  assert.equal((await call(`${P}/organizations/${org.id}`, 'DELETE')).status, 409, 'it has a member');
  assert.equal((await call(`${P}/organizations/${org.id}/members/${other}`, 'DELETE')).status, 200);
  assert.equal((await call(`${P}/organizations/${org.id}/members/${other}`, 'DELETE')).status, 404);
  assert.equal((await call(`${P}/organizations/${org.id}`, 'DELETE')).status, 200);
  assert.equal(await db.organization.findUnique({ where: { id: org.id } }), null);
});

test('background jobs: the queue shows what is stuck without its contents, and cancel / retry work', async () => {
  const q = new FileJobQueue({ storageDir: path.join(dir, 'jobs'), concurrency: 1, retryDelayMs: 1 });
  let release!: () => void; const gate = new Promise<void>((r) => { release = r; });
  q.register('slow', async () => { await gate; return { ok: true }; });
  q.register('boom', async () => { throw Object.assign(new Error('provider down'), { code: 'X' }); });
  // one slot: the failing job runs first and fails, then one slow job holds the slot and another waits behind it
  const failing = (await q.submit({ type: 'boom', ownerId: other, payload: { x: 1 }, maxAttempts: 1 })).job;
  for (let i = 0; i < 200; i++) { if ((await q.snapshot()).counts.failed) break; await new Promise((r) => setTimeout(r, 20)); }
  const running = (await q.submit({ type: 'slow', ownerId: person, payload: { secret: 'student answers' } })).job;
  const queued = (await q.submit({ type: 'slow', ownerId: other, payload: { secret: 'more answers' } })).job;
  for (let i = 0; i < 200; i++) { if ((await q.snapshot()).counts.processing) break; await new Promise((r) => setTimeout(r, 20)); }
  const snap = await q.snapshot();
  assert.equal(snap.counts.processing, 1); assert.ok(snap.counts.queued >= 1); assert.equal(snap.counts.failed, 1); assert.equal(snap.byType.slow, 2);
  assert.ok(!JSON.stringify(snap).includes('student answers') && !JSON.stringify(snap).includes('more answers'), 'job contents are never shown');
  assert.equal((await q.adminCancel(queued.id))?.status, 'cancelled');
  assert.equal(await q.adminCancel(randomUUID()), null);
  assert.equal(await q.adminRetry(running.id), null, 'a running job cannot be retried');
  const again = await q.adminRetry(failing.id); assert.ok(again && again.id !== failing.id && again.type === 'boom' && again.ownerId === other);
  release(); await q.stop();
  // the failed-jobs table and stuck batches, through the route
  const fj = await db.failedJob.create({ data: { jobId: 'j1', jobType: 'mark', payload: '{}', errorMessage: 'provider down', attempts: 2 } });
  const jobs = (await call(`${P}/jobs`)).json.data;
  assert.ok(jobs.failed.some((f: any) => f.id === fj.id) && jobs.queue.counts && 'processing' in jobs.queue.counts);
  assert.equal((await call(`${P}/jobs/failed/${fj.id}/resolve`, 'POST')).status, 200);
  assert.ok(!(await call(`${P}/jobs`)).json.data.failed.some((f: any) => f.id === fj.id));
  assert.equal((await call(`${P}/jobs/failed/nope/resolve`, 'POST')).status, 404);
  assert.equal((await call(`${P}/jobs/failed/${fj.id}/resolve`, 'POST')).status, 404, 'already resolved');
  const b = await db.batchJob.create({ data: { userId: other, status: 'PROCESSING', paperType: 'essay' } });
  await db.batchJob.update({ where: { id: b.id }, data: { updatedAt: new Date(Date.now() - 2 * 3600_000) } }).catch(() => undefined);
  assert.equal((await call(`${P}/jobs/batches/${b.id}/fail`, 'POST')).status, 200);
  assert.equal((await db.batchJob.findUnique({ where: { id: b.id } })).status, 'FAILED');
  assert.equal((await call(`${P}/jobs/batches/${b.id}/fail`, 'POST')).status, 404, 'not running any more');
});

test('Telegram: counts, masked chats, unlink', async () => {
  const s = await db.telegramSession.create({ data: { chatId: `9${Date.now()}1234`, userId: other, language: 'rw' } });
  const t = (await call(`${P}/telegram`)).json.data;
  assert.ok(t.total >= 1 && t.linked >= 1 && t.active24h >= 1);
  const row = t.recent.find((r: any) => r.id === s.id); assert.match(row.chat, /^…1234$/, 'the chat id is masked'); assert.equal(row.user.id, other);
  assert.equal((await call(`${P}/telegram/${s.id}/unlink`, 'POST')).status, 200);
  assert.equal((await db.telegramSession.findUnique({ where: { id: s.id } })).userId, null);
  assert.equal((await call(`${P}/telegram/${randomUUID()}/unlink`, 'POST')).status, 404);
});

test('security: failed sign-ins are counted, grouped by source, and the list can be blocked', async () => {
  const req: any = { ip: '203.0.113.50', headers: {} };
  for (let i = 0; i < 3; i++) await recordAuthFailure(req, 'code_invalid', { email: 'guess@test.local' });
  await recordAuthFailure({ ip: '198.51.100.7', headers: {} } as any, 'disabled_account', { email: `${other}@test.local`, userId: other });
  const s = (await call(`${P}/security`)).json.data;
  assert.ok(s.failedSignIns.last24h >= 4 && s.failedSignIns.byHour.length === 24 && s.failedSignIns.byHour[23] >= 4);
  const top = s.topSources.find((x: any) => x.ip === '203.0.113.50'); assert.ok(top && top.attempts >= 3 && top.blocked === false);
  assert.ok(s.recent.some((e: any) => e.type === 'disabled_account' && e.ip === '198.51.100.7'));
  await call(`${P}/settings`, 'PUT', { blockedIps: ['203.0.113.50'] });
  assert.equal((await call(`${P}/security`)).json.data.topSources.find((x: any) => x.ip === '203.0.113.50').blocked, true);
  await call(`${P}/settings`, 'PUT', { blockedIps: [] });
  // old failures are removed when the view is opened
  await db.authEvent.create({ data: { type: 'code_invalid', meta: JSON.stringify({ ip: '192.0.2.200' }), createdAt: new Date(Date.now() - 40 * 86400_000) } });
  await call(`${P}/security`);
  assert.equal(await db.authEvent.count({ where: { createdAt: { lt: new Date(Date.now() - 31 * 86400_000) } } }), 0, 'kept 30 days');
});

test('retention is listed, and the MySEB period can be set', async () => {
  const r = (await call(`${P}/settings`)).json.data.retention;
  assert.ok(r.some((x: any) => x.id === 'myseb' && x.editable) && r.some((x: any) => x.id === 'tasks' && !x.editable));
  assert.equal((await call(`${P}/settings`, 'PUT', { retention: { mysebDays: 3 } })).status, 400, 'too short');
  const set = (await call(`${P}/settings`, 'PUT', { retention: { mysebDays: 45 } })).json.data.retention.find((x: any) => x.id === 'myseb');
  assert.equal(set.value, '45 days'); assert.equal(set.source, 'set here');
  await call(`${P}/settings`, 'PUT', { retention: { mysebDays: null } });
});
