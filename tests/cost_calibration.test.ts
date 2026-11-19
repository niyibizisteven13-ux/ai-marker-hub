// Cost calibration: the platform's cost figures can be made to match the provider's real prices, safely, from the admin page.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { randomUUID } from 'node:crypto';

const { prisma } = await import('../server/db.js');
const cal = await import('../server/services/billing/costCalibration.js');
const { costUsd, creditsFor } = await import('../server/services/billing/usage.js');
const { default: router } = await import('../server/routes/adminBillingRoutes.js');
const db = prisma as any;

test.afterEach(async () => { cal.applyCalibration({ multiplier: 1, prices: {}, changedAt: null, changedBy: null }); await db.appSetting.deleteMany({ where: { key: 'ai_cost_calibration' } }).catch(() => undefined); });
test.after(async () => { await prisma.$disconnect(); });

test('model families are told apart', () => {
  assert.deepEqual(['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-2', 'mythos-x', 'zai-org/glm'].map(cal.familyOf), ['haiku', 'sonnet', 'opus', 'fable', 'fable', 'other']);
  assert.equal(cal.familyOf(null), 'other');
});

test('junk is dropped and the multiplier is kept in range', () => {
  assert.equal(cal.cleanCalibration({ multiplier: 'x' }).multiplier, 1);
  assert.equal(cal.cleanCalibration({ multiplier: 0 }).multiplier, cal.MIN_MULTIPLIER);
  assert.equal(cal.cleanCalibration({ multiplier: 9999 }).multiplier, cal.MAX_MULTIPLIER);
  assert.equal(cal.cleanCalibration({ multiplier: '2.5' }).multiplier, 2.5);
  const c = cal.cleanCalibration({ prices: { haiku: { in: 1, out: 5 }, sonnet: { in: -1, out: 5 }, opus: { in: 'a', out: 1 }, gpt: { in: 1, out: 1 }, fable: { in: 5000, out: 1 } } });
  assert.deepEqual(c.prices, { haiku: { in: 1, out: 5 } }, 'negative, non-numeric, unknown and absurd prices are ignored');
  assert.deepEqual(cal.cleanCalibration(null), { multiplier: 1, prices: {}, changedAt: null, changedBy: null });
});

test('the multiplier and a price override change what a call costs, and so the credits it takes', () => {
  const tokens = [1_000_000, 200_000] as const;
  const base = costUsd('claude-haiku-5-5', ...tokens);
  assert.ok(Math.abs(base - (0.10 + 0.5 * 0.2)) < 1e-9, `table: ${base}`);
  const baseCredits = creditsFor('claude-haiku-5-5', ...tokens);
  cal.applyCalibration({ multiplier: 3, prices: {}, changedAt: null, changedBy: null });
  assert.ok(Math.abs(costUsd('claude-haiku-5-5', ...tokens) - base * 3) < 1e-9);
  assert.ok(creditsFor('claude-haiku-5-5', ...tokens) >= baseCredits * 3 - 1);
  // A price override replaces the table for that family only, and the multiplier still applies on top.
  cal.applyCalibration({ multiplier: 1, prices: { haiku: { in: 1, out: 5 } }, changedAt: null, changedBy: null });
  assert.ok(Math.abs(costUsd('claude-haiku-5-5', ...tokens) - (1 + 5 * 0.2)) < 1e-9);
  assert.ok(Math.abs(costUsd('claude-sonnet-5-5', ...tokens) - (2 + 10 * 0.2)) < 1e-9, 'sonnet keeps the table');
  assert.ok(creditsFor('claude-haiku-5-5', ...tokens) > baseCredits * 8, 'a ten-times price means about ten times the credits');
});

test('the invoice comparison: suggests the multiplier that makes recorded cost match, replacing rather than compounding', () => {
  const s = cal.suggestMultiplier({ invoiceUsd: 30, recordedUsd: 10, currentMultiplier: 1 });
  assert.equal(s.suggested, 3); assert.equal(s.ratio, 3); assert.match(s.message, /3\.00× what was recorded/);
  // Costs recorded with multiplier 2 that are still 1.5× too low: the new multiplier is 3, not 1.5.
  assert.equal(cal.suggestMultiplier({ invoiceUsd: 30, recordedUsd: 20, currentMultiplier: 2 }).suggested, 3);
  assert.match(cal.suggestMultiplier({ invoiceUsd: 10.2, recordedUsd: 10, currentMultiplier: 1 }).message, /No change needed/);
  assert.match(cal.suggestMultiplier({ invoiceUsd: 5, recordedUsd: 10, currentMultiplier: 1 }).message, /over-priced/);
  assert.equal(cal.suggestMultiplier({ invoiceUsd: 5000, recordedUsd: 1, currentMultiplier: 1 }).suggested, cal.MAX_MULTIPLIER, 'limited to the allowed range');
  assert.equal(cal.suggestMultiplier({ invoiceUsd: 0, recordedUsd: 10, currentMultiplier: 1.7 }).suggested, 1.7);
  assert.equal(cal.suggestMultiplier({ invoiceUsd: 30, recordedUsd: 0, currentMultiplier: 1.7 }).ratio, null);
});

test('admin page: read, save, reconcile with an invoice and apply; bad input is refused', async () => {
  const app = express(); app.use(express.json()); app.use((req: any, _r, n) => { req.user = { userId: 'admin-cal', role: 'ADMIN' }; n(); }); app.use('/', router);
  const server = app.listen(0); const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const user = `u-${randomUUID()}`;
  const call = async (path: string, method = 'GET', body?: unknown) => { const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json().catch(() => ({})) as any }; };
  try {
    await db.user.create({ data: { id: user, email: `${user}@test.local`, name: 'T', passwordHash: 'x', role: 'INSTRUCTOR' } });
    // $2 of recorded cost this month, on a haiku model.
    await db.usageRecord.create({ data: { id: randomUUID(), userId: user, kind: 'chat', credits: 2000, model: 'claude-haiku-5-5', inputTokens: 1, outputTokens: 1, costUsd: 2 } });
    const get = await call('/cost-calibration');
    assert.equal(get.status, 200, JSON.stringify(get.json)); assert.equal(get.json.calibration.multiplier, 1);
    assert.deepEqual(get.json.families.find((f: any) => f.family === 'haiku').table, { in: 0.1, out: 0.5 });
    assert.ok(get.json.month.recordedUsd >= 2);
    assert.equal((await call('/cost-calibration', 'PUT', { multiplier: 0 })).status, 400);
    assert.equal((await call('/cost-calibration', 'PUT', { multiplier: 2, extra: 1 })).status, 400, 'unknown fields are refused');
    const saved = await call('/cost-calibration', 'PUT', { multiplier: 2, prices: { haiku: { in: 1, out: 5 } } });
    assert.equal(saved.json.calibration.multiplier, 2); assert.deepEqual(saved.json.calibration.prices.haiku, { in: 1, out: 5 });
    assert.equal(saved.json.calibration.changedBy, 'admin-cal'); assert.equal(saved.json.month.changedThisMonth, true);
    assert.ok(Math.abs(costUsd('claude-haiku-5-5', 1_000_000, 0) - 2) < 1e-9, 'in effect straight away: $1 per million times 2');
    // Removing an override with null.
    assert.deepEqual((await call('/cost-calibration', 'PUT', { prices: { haiku: null } })).json.calibration.prices, {});
    // Invoice comparison does not change anything until applied.
    const rec = get.json.month.recordedUsd;
    const preview = await call('/cost-calibration/reconcile', 'POST', { invoiceUsd: rec * 4 });
    assert.equal(preview.json.applied, false); assert.ok(Math.abs(preview.json.suggestion.ratio - 4) < 0.01, `invoice is 4× what was recorded: ${preview.json.suggestion.ratio}`);
    assert.equal(cal.calibration().multiplier, 2);
    const applied = await call('/cost-calibration/reconcile', 'POST', { invoiceUsd: rec * 4, apply: true });
    assert.equal(applied.json.applied, true);
    assert.equal(cal.calibration().multiplier, Math.round(2 * (rec * 4 / applied.json.month.recordedUsd) * 1000) / 1000);
    assert.equal((await call('/cost-calibration/reconcile', 'POST', { invoiceUsd: -5 })).status, 400);
    // It survives a restart: the stored setting is read back.
    cal.applyCalibration({ multiplier: 1, prices: {}, changedAt: null, changedBy: null });
    assert.equal((await cal.loadCalibration(true)).multiplier, applied.json.calibration.multiplier);
  } finally {
    await db.usageRecord.deleteMany({ where: { userId: user } }); await db.user.delete({ where: { id: user } }).catch(() => undefined);
    server.close();
  }
});
