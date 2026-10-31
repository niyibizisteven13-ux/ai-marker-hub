import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import express from 'express';

// Plan limits (credits per day / week / month, per-feature daily caps, message size) and memory across chats
// (PRO only, captured from chats, recalled within a budget, editable, gated by plan). Local test database.

const { prisma } = await import('../server/db.js');
const { PLANS, planFor, toRwf, currentGoPacks, applyBillingSettings } = await import('../server/services/billing/plans.js');
const { periods, creditsFor, checkUsage, recordUsage, usageSummary } = await import('../server/services/billing/usage.js');
const { MemoryService, MemoryUpgradeRequired, extractFacts } = await import('../server/services/MemoryService.js');
const { default: memoryRoutes } = await import('../server/routes/memoryRoutes.js');
const db = prisma as any;

const newUser = async (plan?: 'STARTER' | 'PRO' | 'PLUS' | 'BUSINESS' | 'ORGANIZATION' | 'GO', extra: Record<string, unknown> = {}) => {
  const id = `u-${randomUUID()}`;
  await db.user.create({ data: { id, email: `${id}@test.local`, name: 'Test User', passwordHash: 'x', role: 'INSTRUCTOR', ...extra } });
  if (plan) await db.subscription.create({ data: { id: randomUUID(), userId: id, planType: plan, status: 'ACTIVE', startDate: new Date(), endDate: new Date(Date.now() + 30 * 86_400_000) } });
  return id;
};
const addUsage = (userId: string, credits: number, at: Date, kind = 'chat') => db.usageRecord.create({ data: { id: randomUUID(), userId, kind, credits, model: 'gonka', inputTokens: 0, outputTokens: 0, costUsd: 0, channel: 'web', createdAt: at } });

test('periods: day, ISO week and month start at midnight Kigali time (UTC+2)', () => {
  const now = Date.parse('2026-10-22T22:30:00Z'); // 00:30 on Friday 23 October in Kigali
  const p = periods(now);
  assert.equal(p.day.toISOString(), '2026-10-22T22:00:00.000Z');
  assert.equal(p.week.toISOString(), '2026-10-18T22:00:00.000Z', 'Monday 19 October 00:00 Kigali');
  assert.equal(p.month.toISOString(), '2026-09-30T22:00:00.000Z');
  assert.equal(p.resets.day.toISOString(), '2026-10-23T22:00:00.000Z');
  assert.equal(p.resets.month.toISOString(), '2026-10-31T22:00:00.000Z');
});

test('credits follow real model cost: 1 credit = $0.001, at least 1', () => {
  assert.equal(creditsFor('claude-haiku-5-5', 45_000, 1_500), 6, '45k in + 1.5k out on Haiku = $0.00525');
  assert.equal(creditsFor('claude-haiku-5-5', 300, 80), 1, 'tiny replies still cost 1 credit');
  assert.ok(creditsFor('claude-sonnet-5-5', 45_000, 1_500) > creditsFor('claude-haiku-5-5', 45_000, 1_500));
  assert.equal(toRwf(3), 4400, 'USD amounts in RWF, rounded to 100 (rate 1470)');
});

test('plans: subscriptions map to Starter / Pro / Pro Plus / Institution; expired ones and admins fall back correctly', async () => {
  assert.equal((await planFor(await newUser())).id, 'FREE');
  assert.equal((await planFor(await newUser('STARTER'))).id, 'STARTER');
  assert.equal((await planFor(await newUser('PLUS'))).id, 'PLUS');
  assert.equal((await planFor(await newUser('PRO'))).id, 'PRO');
  assert.equal((await planFor(await newUser('BUSINESS'))).id, 'PRO', 'legacy Business Pro is PRO');
  assert.equal((await planFor(await newUser('ORGANIZATION'))).id, 'INSTITUTION');
  assert.equal((await planFor(await newUser(undefined, { role: 'ADMIN' }))).id, 'INSTITUTION');
  const expired = await newUser('PRO');
  await db.subscription.update({ where: { userId: expired }, data: { endDate: new Date(Date.now() - 1000) } });
  assert.equal((await planFor(expired)).id, 'FREE');
});

test('limits: daily, weekly and monthly credits, per-feature daily caps, message size and attachments', async () => {
  const now = Date.parse('2026-10-21T10:00:00Z'); // Wednesday
  const day = (d: number) => new Date(now - d * 86_400_000);

  const daily = await newUser();
  await addUsage(daily, 15, day(0));
  const d = await checkUsage(daily, { kind: 'chat' }, now);
  assert.equal(d.allowed, false);
  assert.equal(d.code, 'DAILY');
  assert.match(d.message!, /today's 15 credits/);
  assert.match(d.message!, /Pro \(4,500 RWF a month, about \$3\.06\) gives 1,700 credits a month/);
  assert.deepEqual(d.upgrade, { plan: 'PRO', url: '/upgrade?reason=limit' });
  assert.equal(d.resetsAt, '2026-10-21T22:00:00.000Z');

  const weekly = await newUser();
  await addUsage(weekly, 14, day(2)); // Monday
  await addUsage(weekly, 14, day(1)); // Tuesday
  await addUsage(weekly, 11, day(0));
  assert.equal((await checkUsage(weekly, { kind: 'chat' }, now)).allowed, true, '39 of 40 this week, 11 of 15 today');
  await addUsage(weekly, 1, day(0));
  assert.equal((await checkUsage(weekly, { kind: 'chat' }, now)).code, 'WEEKLY', 'the week is checked before the day');

  const monthly = await newUser();
  for (const back of [15, 13, 9, 5]) await addUsage(monthly, 14, day(back));
  assert.equal((await checkUsage(monthly, { kind: 'chat' }, now)).code, 'MONTHLY', '56 credits since 1 October');

  const feature = await newUser();
  for (let i = 0; i < 3; i++) await addUsage(feature, 1, day(0), 'tool');
  const f = await checkUsage(feature, { kind: 'tool' }, now);
  assert.equal(f.code, 'FEATURE');
  assert.match(f.message!, /3 data and tool answers/);
  assert.equal((await checkUsage(feature, { kind: 'chat' }, now)).allowed, true, 'plain chat still works');
  assert.equal((await checkUsage(feature, { kind: 'marking' }, now)).allowed, false, 'no marking on Free');

  const fresh = await newUser();
  assert.equal((await checkUsage(fresh, { kind: 'chat', chars: 9_000 }, now)).code, 'MESSAGE_TOO_LONG');
  assert.equal((await checkUsage(fresh, { kind: 'chat', attachments: 3 }, now)).code, 'TOO_MANY_ATTACHMENTS');
  assert.equal((await checkUsage(fresh, { kind: 'vision', attachments: 2 }, now)).allowed, true);

  // Paid plans: a whole class can be marked in one evening; the monthly credits are the limit.
  const pro = await newUser('PRO');
  await addUsage(pro, 1_600, day(0));
  assert.equal((await checkUsage(pro, { kind: 'marking' }, now)).allowed, true, 'Pro allows 1,600 credits in one day');
  await addUsage(pro, 100, day(0));
  const p = await checkUsage(pro, { kind: 'chat' }, now);
  assert.equal(p.code, 'MONTHLY');
  assert.match(p.message!, /Pro Plus \(7,000 RWF a month/);
});

test('metering records real usage; the summary shows plan, meters, features and the Pro offer', async () => {
  const u = await newUser();
  assert.equal(await recordUsage(u, { kind: 'tool', model: 'claude-haiku-5-5', inputTokens: 45_000, outputTokens: 1_500 }), 6);
  assert.equal(await recordUsage(u, { kind: 'chat', model: 'gonka', inputTokens: 500, outputTokens: 200, channel: 'telegram' }), 1);
  const s = await usageSummary(u);
  assert.equal(s.plan.id, 'FREE');
  assert.equal(s.credits.day.used, 7);
  assert.equal(s.credits.day.limit, 15);
  assert.equal(s.credits.month.limit, 50);
  assert.deepEqual(s.features.find((f) => f.kind === 'tool'), { kind: 'tool', label: 'data and tool answers', used: 1, limit: 3 });
  assert.deepEqual(s.recent.map((r) => [r.kind, r.credits, r.channel]), [['chat', 1, 'telegram'], ['tool', 6, 'web']]);
  assert.equal(s.limits.memory, false);
  assert.deepEqual(s.pro, { id: 'PRO', name: 'Pro', priceUsd: 3.06, listPriceUsd: null, priceRwf: 4_500, daily: 1_700, monthly: 1_700, memory: true });
});

test('memory: facts and preferences are recognised; secrets are not', () => {
  const f = extractFacts("Hi, my name is Aline Uwase and I teach S3 physics. I prefer short answers with examples.");
  assert.deepEqual(f.map((x) => x.content), ["The user's name is Aline Uwase.", 'The user teaches S3 physics.', 'The user prefers short answers with examples.']);
  assert.deepEqual(f.map((x) => x.kind), ['fact', 'fact', 'preference']);
  assert.deepEqual(extractFacts('What is the capital of France?'), []);
});

test('memory: Free cannot turn it on; PRO captures, recalls within budget, forgets on request and filters secrets', async () => {
  const m = MemoryService.getInstance();
  const free = await newUser();
  await assert.rejects(m.setEnabled(free, true), MemoryUpgradeRequired);
  assert.deepEqual(await m.status(free), { available: false, enabled: false, plan: 'FREE', count: 0, capacity: 0 });
  assert.deepEqual(await m.capture(free, 'My name is Eric and I teach chemistry.'), { saved: [], forgotten: 0 }, 'nothing is saved without memory');

  const pro = await newUser('PRO');
  assert.equal((await m.setEnabled(pro, true)).enabled, true);
  const a = await m.capture(pro, 'My name is Aline and I teach S3 physics at Lycée de Kigali.');
  assert.ok(a.saved.some((s) => s.content === "The user's name is Aline." && s.source === 'auto'));
  assert.ok(a.saved.some((s) => s.content === 'The user teaches S3 physics at Lycée de Kigali.'));
  const b = await m.capture(pro, 'Remember that my exams are always on Fridays');
  assert.deepEqual(b.saved.map((s) => [s.content, s.kind, s.source]), [['my exams are always on Fridays', 'note', 'user']]);
  await assert.rejects(m.add(pro, 'my password is hunter22'), /not saved/);
  assert.equal((await m.capture(pro, 'Remember my password is hunter22')).saved.length, 0);

  const ctx = await m.getLongTermContext(pro, 'When should I schedule the physics exam?');
  assert.match(ctx, /What you remember about this user/);
  assert.match(ctx, /The user's name is Aline\./);
  assert.match(ctx, /exams are always on Fridays/);
  assert.doesNotMatch(ctx, /hunter22/);

  const list = await m.list(pro);
  assert.ok(list.items.some((i) => i.kind === 'episode' && /On \d{4}-\d{2}-\d{2} the user asked: My name is Aline/.test(i.content)), 'conversation trace kept');
  const forgot = await m.capture(pro, 'Forget that my exams are on Fridays');
  assert.equal(forgot.forgotten, 1);
  assert.doesNotMatch(await m.getLongTermContext(pro, 'exams Fridays'), /Fridays/);

  // Downgrade: memories stay but are no longer used; the user can still delete them.
  await db.subscription.update({ where: { userId: pro }, data: { status: 'EXPIRED' } });
  assert.equal((await m.status(pro)).enabled, false);
  assert.doesNotMatch(await m.getLongTermContext(pro, 'my name'), /Aline/);
  assert.ok((await m.clear(pro)) >= 3);
});

test('memory API: Free sees an upgrade offer (402 with price); PRO turns it on, adds, edits and deletes', async () => {
  let current = '';
  const app = express();
  app.use(express.json());
  app.use('/api/memory', (req, _res, next) => { (req as any).user = { userId: current }; next(); }, memoryRoutes);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/memory`;
  const call = (path: string, method = 'GET', body?: unknown) => fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  try {
    current = await newUser();
    const view = await (await call('')).json();
    assert.equal(view.available, false);
    assert.deepEqual(view.pro, { name: 'Pro', priceUsd: 3.06, priceRwf: 4_500 });
    const on = await call('/settings', 'PATCH', { enabled: true });
    assert.equal(on.status, 402);
    const body = await on.json();
    assert.equal(body.code, 'UPGRADE_REQUIRED');
    assert.equal(body.upgrade.url, '/upgrade?reason=memory');
    assert.equal((await call('', 'POST', { content: 'I teach biology' })).status, 402);

    current = await newUser('PRO');
    assert.equal((await (await call('/settings', 'PATCH', { enabled: true })).json()).enabled, true);
    const added = await (await call('', 'POST', { content: 'I teach biology to S5', kind: 'fact' })).json();
    assert.equal(added.item.content, 'I teach biology to S5');
    const edited = await (await call(`/${added.item.id}`, 'PATCH', { content: 'I teach biology and chemistry to S5' })).json();
    assert.equal(edited.item.content, 'I teach biology and chemistry to S5');
    assert.equal((await call('', 'POST', { content: 'card 4111 1111 1111 1111' })).status, 400, 'secrets are refused');
    const all = await (await call('')).json();
    assert.equal(all.enabled, true);
    assert.equal(all.total, 1);
    assert.equal((await call(`/${added.item.id}`, 'DELETE')).status, 200);
    assert.equal((await (await call('')).json()).total, 0);
    current = await newUser();
    assert.equal((await call(`/${added.item.id}`, 'DELETE')).status, 404, 'other users cannot touch it');
  } finally {
    server.close();
  }
});

test('plan catalog: Starter 1,500 / Pro 4,500 / Pro Plus 7,000 RWF; Free has no marking; top-ups at about 2.3 RWF a credit', () => {
  assert.deepEqual([PLANS.STARTER.priceRwf, PLANS.PRO.priceRwf, PLANS.PLUS.priceRwf], [1_500, 4_500, 7_000]);
  assert.deepEqual([PLANS.FREE.limits.monthly, PLANS.STARTER.limits.monthly, PLANS.PRO.limits.monthly, PLANS.PLUS.limits.monthly], [50, 400, 1_700, 2_800]);
  assert.equal(PLANS.FREE.limits.autonomousMarking, false);
  assert.equal(PLANS.STARTER.limits.memory, false);
  assert.equal(PLANS.PRO.limits.memory, true);
  assert.equal(PLANS.PLUS.limits.memory, true);
  assert.equal(PLANS.GO.priceRwf, null);
  assert.equal(PLANS.INSTITUTION.priceRwf, null, 'Institution is no longer sold online');
  for (const p of currentGoPacks()) assert.ok(Math.abs(p.rwf / p.credits - 2.3) < 0.05, p.id);
  for (const p of Object.values(PLANS)) assert.ok(p.limits.daily <= p.limits.weekly && p.limits.weekly <= p.limits.monthly, p.id);
});

test('billing settings saved before the new price list keep only the exchange rate; new ones set RWF prices', () => {
  try {
    applyBillingSettings({ fxUsdRwf: 1500, pro: { priceUsd: 3 }, limits: { PRO: { monthly: 1_000 } }, goPacks: [{ id: 'go-500', rwf: 500, credits: 100 }] } as any);
    assert.equal(PLANS.PRO.priceRwf, 4_500);
    assert.equal(PLANS.PRO.priceUsd, 3);
    assert.equal(PLANS.PRO.limits.monthly, 1_700, 'old limits are ignored');
    assert.equal(currentGoPacks()[0].credits, 215, 'old packs are ignored');
    applyBillingSettings({ schema: 2, prices: { PLUS: { priceRwf: 7_500 } }, limits: { STARTER: { monthly: 450 } } });
    assert.equal(PLANS.PLUS.priceRwf, 7_500);
    assert.equal(PLANS.STARTER.limits.monthly, 450);
  } finally {
    applyBillingSettings({});
  }
  assert.equal(PLANS.PLUS.priceRwf, 7_000);
});

test('storage: each plan keeps a set amount of files; a full Free account is refused with the plan that has more', async () => {
  const { ensureStorage, storageSummary, StorageFullError } = await import('../server/services/billing/storage.js');
  assert.ok(PLANS.FREE.limits.storageMb < PLANS.STARTER.limits.storageMb && PLANS.STARTER.limits.storageMb < PLANS.PRO.limits.storageMb && PLANS.PRO.limits.storageMb < PLANS.PLUS.limits.storageMb);
  const free = await newUser();
  const MB = 1024 * 1024;
  await db.fileRecord.create({ data: { id: randomUUID(), name: 'big.pdf', mimeType: 'application/pdf', size: (PLANS.FREE.limits.storageMb - 1) * MB, userId: free, path: null, url: null } });
  await ensureStorage(free, MB / 2);
  await assert.rejects(ensureStorage(free, 2 * MB), (e: any) => e instanceof StorageFullError && /storage is full/.test(e.message) && /Starter/.test(e.message) && e.upgrade?.plan === 'STARTER');
  await assert.rejects(ensureStorage(free, 2 * MB, { forOthers: true }), /shared this task/);
  assert.deepEqual(await storageSummary(free), { usedMb: PLANS.FREE.limits.storageMb - 1, usedBytes: (PLANS.FREE.limits.storageMb - 1) * MB, limitMb: PLANS.FREE.limits.storageMb, files: 1 });
  const pro = await newUser("PRO");
  await db.fileRecord.create({ data: { id: randomUUID(), name: 'big.pdf', mimeType: 'application/pdf', size: (PLANS.FREE.limits.storageMb - 1) * MB, userId: pro, path: null, url: null } });
  await ensureStorage(pro, 2 * MB);
  assert.equal((await usageSummary(pro)).storage.limitMb, PLANS.PRO.limits.storageMb);
});
