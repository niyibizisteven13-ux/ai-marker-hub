import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';

// MTN Mobile Money payments end to end against a fake MTN Collections API: request-to-pay, status confirmed
// with MTN (never trusted from the callback body), fulfilment exactly once, GO credits, receipts by email,
// renewal reminders and merging a Telegram-only account into the web account. Local test database.

// ── Fake MTN Collections API ─────────────────────────────────────────────────
const mtn = { requests: new Map<string, any>(), statuses: new Map<string, any>(), tokenCalls: 0, refuseNext: false };
const fake = express();
fake.use(express.json());
fake.post('/collection/token/', (req, res) => {
  if (!String(req.headers.authorization ?? '').startsWith('Basic ') || req.headers['ocp-apim-subscription-key'] !== 'sub-key') return res.status(401).end();
  mtn.tokenCalls++;
  res.json({ access_token: 'tok', token_type: 'access_token', expires_in: 3600 });
});
fake.post('/collection/v1_0/requesttopay', (req, res) => {
  if (req.headers.authorization !== 'Bearer tok') return res.status(401).end();
  if (mtn.refuseNext) { mtn.refuseNext = false; return res.status(500).json({ message: 'boom' }); }
  const ref = String(req.headers['x-reference-id']);
  mtn.requests.set(ref, { body: req.body, headers: req.headers });
  mtn.statuses.set(ref, { status: 'PENDING' });
  res.status(202).end();
});
fake.get('/collection/v1_0/requesttopay/:id', (req, res) => {
  const s = mtn.statuses.get(req.params.id);
  if (!s) return res.status(404).end();
  res.json({ amount: mtn.requests.get(req.params.id)?.body.amount, currency: 'EUR', ...s });
});
const server: Server = await new Promise((resolve) => { const s = fake.listen(0, () => resolve(s)); });
const mtnUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

Object.assign(process.env, { MOMO_BASE_URL: mtnUrl, MOMO_COLLECTION_PRIMARY_KEY: 'sub-key', MOMO_API_USER: randomUUID(), MOMO_API_KEY: 'api-key', MOMO_TARGET_ENV: 'sandbox', MOMO_CALLBACK_HOST: 'https://pay.example.test' });
delete process.env.MOMO_SIMULATE;

const { prisma } = await import('../server/db.js');
const { EmailService } = await import('../server/services/EmailService.js');
const { PLANS, planFor, walletBalance, toRwf, currentGoPacks } = await import('../server/services/billing/plans.js');
const { checkUsage, recordUsage } = await import('../server/services/billing/usage.js');
const { startPayment, checkPayment, fulfil, quote, runRenewalSweep, billingState } = await import('../server/services/billing/payments.js');
const { momoMode, normalizeMsisdn, resetMomo } = await import('../server/services/billing/momo.js');
const { mergePlaceholderAccount } = await import('../server/services/billing/accounts.js');
const { momoCallbackRouter } = await import('../server/routes/billingRoutes.js');
const db = prisma as any;

const mails: any[] = [];
EmailService.setTestTransport({ sendMail: async (m: any) => { mails.push(m); return { messageId: randomUUID() }; } } as any);

const newUser = async (extra: Record<string, unknown> = {}) => {
  const id = `u-${randomUUID()}`;
  await db.user.create({ data: { id, email: `${id}@test.local`, name: 'Aline Uwase', passwordHash: 'x', role: 'INSTRUCTOR', ...extra } });
  return id;
};
const settle = () => new Promise((r) => setTimeout(r, 50));
const mailsTo = (userId: string) => mails.filter((m) => String(m.to).startsWith(userId));

test.after(() => { EmailService.setTestTransport(null); server.close(); });

test('MoMo mode and phone numbers: sandbox accepts test numbers, production only MTN 078/079', () => {
  assert.equal(momoMode(), 'sandbox');
  assert.equal(normalizeMsisdn('0788 123 456').msisdn, '250788123456');
  assert.equal(normalizeMsisdn('+250 788 123 456').masked, '25078•••456');
  const prev = process.env.MOMO_TARGET_ENV;
  process.env.MOMO_TARGET_ENV = 'mtnrwanda';
  try {
    assert.equal(momoMode(), 'live');
    assert.throws(() => normalizeMsisdn('0728123456'), /078 or 079/);
    assert.equal(normalizeMsisdn('0798123456').msisdn, '250798123456');
  } finally { process.env.MOMO_TARGET_ENV = prev; }
});

test('quotes come from the server price list: PRO $3 a month in RWF, GO packs, months capped at 12', async () => {
  const pro = await quote('PRO', { months: 3 });
  assert.equal(PLANS.PRO.priceUsd, 3);
  assert.equal(pro.amountRwf, toRwf(3) * 3);
  assert.equal((await quote('PRO', { months: 99 })).months, 12);
  const pack = currentGoPacks()[0];
  const go = await quote('GO_PACK', { packId: pack.id });
  assert.equal(go.amountRwf, pack.rwf);
  assert.equal(go.credits, pack.credits);
  await assert.rejects(quote('GO_PACK', { packId: 'nope' }), /GO credit pack/);
});

test('PRO purchase: request-to-pay reaches MTN, status is confirmed with MTN, plan granted once, receipt emailed once', async () => {
  resetMomo();
  const userId = await newUser();
  const { payment } = await startPayment(userId, { purpose: 'PRO', months: 1, phone: '0788123456' });
  const sent = mtn.requests.get(payment.id);
  assert.ok(sent, 'MTN received the request with our payment id as X-Reference-Id');
  assert.equal(sent.body.amount, String(toRwf(3)));
  assert.equal(sent.body.payer.partyId, '250788123456');
  assert.equal(sent.headers['x-target-environment'], 'sandbox');
  assert.equal(sent.headers['x-callback-url'], `https://pay.example.test/api/billing/momo/callback/${payment.id}`);
  assert.equal(payment.status, 'PENDING');
  assert.equal(payment.phoneMasked, '25078•••456');

  // A second tap within two minutes reuses the open request instead of charging twice.
  const again = await startPayment(userId, { purpose: 'PRO', months: 1, phone: '0788123456' });
  assert.equal(again.reused, true);
  assert.equal(again.payment.id, payment.id);

  assert.equal((await checkPayment(payment.id, userId)).status, 'PENDING');
  assert.equal((await planFor(userId)).id, 'FREE');

  mtn.statuses.set(payment.id, { status: 'SUCCESSFUL', financialTransactionId: '987654321' });
  const done = await checkPayment(payment.id, userId);
  assert.equal(done.status, 'SUCCESSFUL');
  assert.match(done.receiptNumber!, /^BW-\d{8}-[0-9A-F]{6}$/);
  assert.equal(done.transactionId, '987654321');
  assert.equal((await planFor(userId)).id, 'PRO');
  const sub = await db.subscription.findUnique({ where: { userId } });
  const days = (new Date(sub.endDate).getTime() - Date.now()) / 86_400_000;
  assert.ok(days > 29 && days <= 30, `30 days of PRO, got ${days}`);

  // Repeated checks and a direct second fulfil do not extend twice or resend the receipt.
  await checkPayment(payment.id, userId);
  await fulfil(await db.billingPayment.findUnique({ where: { id: payment.id } }), '987654321');
  await settle();
  const after = await db.subscription.findUnique({ where: { userId } });
  assert.equal(new Date(after.endDate).getTime(), new Date(sub.endDate).getTime());
  const receipts = mailsTo(userId);
  assert.equal(receipts.length, 1, 'one receipt email');
  assert.match(receipts[0].subject, /receipt/i);
  assert.match(receipts[0].html, new RegExp(done.receiptNumber!));
  assert.match(receipts[0].text, /PRO/);

  // Someone else cannot read or check this payment.
  await assert.rejects(checkPayment(payment.id, await newUser()), /not found/i);
});

test('an admin who buys PRO keeps Institution limits', async () => {
  const admin = await newUser({ role: 'ADMIN' });
  const { payment } = await startPayment(admin, { purpose: 'PRO', months: 1, phone: '0788343434' });
  mtn.statuses.set(payment.id, { status: 'SUCCESSFUL', financialTransactionId: 'adm' });
  await checkPayment(payment.id);
  assert.equal((await planFor(admin)).id, 'INSTITUTION');
});

test('renewing PRO early adds the new months to the current end date', async () => {
  const userId = await newUser();
  const first = (await startPayment(userId, { purpose: 'PRO', months: 1, phone: '0788000111' })).payment;
  mtn.statuses.set(first.id, { status: 'SUCCESSFUL', financialTransactionId: '1' });
  await checkPayment(first.id);
  const end1 = new Date((await db.subscription.findUnique({ where: { userId } })).endDate).getTime();
  await db.billingPayment.update({ where: { id: first.id }, data: { createdAt: new Date(Date.now() - 10 * 60_000) } });
  const second = (await startPayment(userId, { purpose: 'PRO', months: 3, phone: '0788000111' })).payment;
  mtn.statuses.set(second.id, { status: 'SUCCESSFUL', financialTransactionId: '2' });
  await checkPayment(second.id);
  const end2 = new Date((await db.subscription.findUnique({ where: { userId } })).endDate).getTime();
  assert.equal(Math.round((end2 - end1) / 86_400_000), 90);
});

test('declined and refused payments: FAILED with a reason, nothing granted, one failure email', async () => {
  const userId = await newUser();
  const { payment } = await startPayment(userId, { purpose: 'PRO', months: 1, phone: '0788555666' });
  mtn.statuses.set(payment.id, { status: 'FAILED', reason: 'APPROVAL_REJECTED' });
  const failed = await checkPayment(payment.id);
  assert.equal(failed.status, 'FAILED');
  assert.equal(failed.reason, 'APPROVAL_REJECTED');
  await checkPayment(payment.id);
  await settle();
  assert.equal((await planFor(userId)).id, 'FREE');
  assert.equal(mailsTo(userId).length, 1);
  assert.match(mailsTo(userId)[0].subject, /not completed|failed|didn/i);

  const other = await newUser();
  mtn.refuseNext = true;
  await assert.rejects(startPayment(other, { purpose: 'PRO', months: 1, phone: '0788555667' }), /could not start/);
  const row = await db.billingPayment.findFirst({ where: { userId: other } });
  assert.equal(row.status, 'FAILED');
});

test('a payment left unapproved for 15 minutes expires', async () => {
  const userId = await newUser();
  const { payment } = await startPayment(userId, { purpose: 'PRO', months: 1, phone: '0788777888' });
  await db.billingPayment.update({ where: { id: payment.id }, data: { createdAt: new Date(Date.now() - 16 * 60_000) } });
  assert.equal((await checkPayment(payment.id)).status, 'EXPIRED');
});

test('the MTN callback is only a hint: the body is ignored and status is re-checked with MTN', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/billing/momo/callback', momoCallbackRouter);
  const cb: Server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${(cb.address() as AddressInfo).port}/api/billing/momo/callback`;
  try {
    const userId = await newUser();
    const { payment } = await startPayment(userId, { purpose: 'PRO', months: 1, phone: '0788999000' });
    // A forged "SUCCESSFUL" body while MTN still says PENDING grants nothing.
    let res = await fetch(`${base}/${payment.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'SUCCESSFUL', financialTransactionId: 'forged' }) });
    assert.ok(res.ok);
    assert.equal((await db.billingPayment.findUnique({ where: { id: payment.id } })).status, 'PENDING');
    assert.equal((await planFor(userId)).id, 'FREE');

    mtn.statuses.set(payment.id, { status: 'SUCCESSFUL', financialTransactionId: 'real-1' });
    res = await fetch(`${base}/${payment.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.ok(res.ok);
    const row = await db.billingPayment.findUnique({ where: { id: payment.id } });
    assert.equal(row.status, 'SUCCESSFUL');
    assert.equal(row.financialTransactionId, 'real-1');

    res = await fetch(`${base}/${randomUUID()}`, { method: 'PUT' });
    assert.ok(res.status < 500, 'unknown ids are answered without errors');
  } finally { cb.close(); }
});

test('GO credits: purchase adds to the wallet, which is spent only after the plan allowance runs out', async () => {
  const userId = await newUser();
  const pack = currentGoPacks()[0];
  const { payment } = await startPayment(userId, { purpose: 'GO_PACK', packId: pack.id, phone: '0788121212' });
  mtn.statuses.set(payment.id, { status: 'SUCCESSFUL', financialTransactionId: 'go-1' });
  await checkPayment(payment.id);
  assert.equal(await walletBalance(userId), pack.credits);
  assert.equal((await planFor(userId)).id, 'GO');

  const daily = PLANS.GO.limits.daily;
  await recordUsage(userId, { kind: 'chat', minCredits: daily, model: 'gonka', channel: 'web' });
  assert.equal(await walletBalance(userId), pack.credits, 'within the daily allowance the wallet is untouched');
  const gate = await checkUsage(userId, { kind: 'chat' });
  assert.equal(gate.allowed, true);
  assert.equal(gate.wallet, true);
  await recordUsage(userId, { kind: 'chat', minCredits: 7, model: 'gonka', channel: 'web' });
  assert.equal(await walletBalance(userId), pack.credits - 7);

  const state = await billingState(userId);
  assert.equal(state.plan, 'GO');
  assert.equal(state.wallet, pack.credits - 7);
});

test('renewal sweep: reminder 3 days before the end, expiry notice after, each sent once', async () => {
  const userId = await newUser();
  await db.subscription.create({ data: { id: randomUUID(), userId, planType: 'PRO', status: 'ACTIVE', startDate: new Date(), endDate: new Date(Date.now() + 2.5 * 86_400_000) } });
  await runRenewalSweep();
  await runRenewalSweep();
  assert.equal(mailsTo(userId).length, 1);
  assert.match(mailsTo(userId)[0].subject, /ends|renew/i);

  await db.subscription.update({ where: { userId }, data: { endDate: new Date(Date.now() - 60_000) } });
  await runRenewalSweep();
  await runRenewalSweep();
  assert.equal(mailsTo(userId).length, 2);
  assert.equal((await db.subscription.findUnique({ where: { userId } })).status, 'EXPIRED');
  assert.equal((await planFor(userId)).id, 'FREE');
});

test('one account: a Telegram-only placeholder account is merged into the web account when linked', async () => {
  const web = await newUser();
  const tg = `tg-${randomUUID()}`;
  await db.user.create({ data: { id: tg, email: `telegram-${tg}@users.invalid`, name: 'Telegram user', passwordHash: 'x', role: 'INSTRUCTOR' } });
  await db.creditLedger.create({ data: { id: randomUUID(), userId: tg, delta: 220, reason: 'purchase', paymentId: null, note: 'go-1000', createdAt: new Date() } });
  await db.usageRecord.create({ data: { id: randomUUID(), userId: tg, kind: 'chat', credits: 3, model: 'gonka', inputTokens: 0, outputTokens: 0, costUsd: 0, channel: 'telegram', createdAt: new Date() } });

  const moved = await mergePlaceholderAccount(tg, web);
  assert.equal(moved.creditLedger, 1);
  assert.equal(moved.usageRecord, 1);
  assert.equal(await walletBalance(web), 220);
  assert.equal(await walletBalance(tg), 0);

  // Real accounts are never merged.
  const other = await newUser();
  await db.creditLedger.create({ data: { id: randomUUID(), userId: other, delta: 50, reason: 'grant', paymentId: null, note: null, createdAt: new Date() } });
  await mergePlaceholderAccount(other, web);
  assert.equal(await walletBalance(other), 50);
});

test('without MTN keys, checkout is refused cleanly and nothing is faked', async () => {
  const keep = process.env.MOMO_API_KEY;
  delete process.env.MOMO_API_KEY;
  try {
    assert.equal(momoMode(), 'off');
    await assert.rejects(startPayment(await newUser(), { purpose: 'PRO', months: 1, phone: '0788123456' }), (e: any) => e.status === 503 && e.code === 'NOT_CONFIGURED');
  } finally { process.env.MOMO_API_KEY = keep; }
});
