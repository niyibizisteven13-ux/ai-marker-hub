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
const mtn = { requests: new Map<string, any>(), statuses: new Map<string, any>(), tokenCalls: 0, refuseNext: false, refuseCallback: false, attempts: [] as any[] };
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
  mtn.attempts.push({ headers: req.headers, body: req.body });
  // Like the real API: a bare 400 for characters it does not accept, or a callback host it does not allow.
  if (/[^\x20-\x7e]/.test(`${req.body.payerMessage}${req.body.payeeNote}`)) return res.status(400).end();
  if (mtn.refuseCallback && req.headers['x-callback-url']) return res.status(400).end();
  const ref = String(req.headers['x-reference-id']);
  mtn.requests.set(ref, { body: req.body, headers: req.headers });
  mtn.statuses.set(ref, { status: 'PENDING' });
  res.status(202).end();
});
fake.get('/collection/v1_0/account/balance', (req, res) => {
  if (req.headers.authorization !== 'Bearer tok') return res.status(401).end();
  res.json({ availableBalance: '1000', currency: 'EUR' });
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
const { momoMode, momoHealth, normalizeMsisdn, resetMomo } = await import('../server/services/billing/momo.js');
const { mergePlaceholderAccount } = await import('../server/services/billing/accounts.js');
const { platformContext } = await import('../server/services/platformContext.js');
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

test('quotes come from the server price list: Starter / Pro / Pro Plus in RWF, top-ups, months capped at 12', async () => {
  const pro = await quote('PRO', { months: 3 });
  assert.equal(PLANS.PRO.name, 'Pro');
  assert.equal(pro.amountRwf, 4_500 * 3);
  assert.equal((await quote('STARTER')).amountRwf, 1_500);
  assert.equal((await quote('PLUS')).amountRwf, 7_000);
  assert.match((await quote('PLUS')).item, /Pro Plus plan · 1 month/);
  await assert.rejects(quote('INSTITUTION' as any), /not available for online payment/);
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
  assert.equal(sent.body.amount, '4500');
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
  assert.match(receipts[0].text, /Pro/);

  // Someone else cannot read or check this payment.
  await assert.rejects(checkPayment(payment.id, await newUser()), /not found/i);
});

test('MTN quirks: messages are sent as plain ASCII; a refused callback URL is retried without it, then skipped', async () => {
  resetMomo();
  mtn.refuseCallback = true;
  const userId = await newUser();
  const pack = currentGoPacks()[0];
  mtn.attempts.length = 0;
  const { payment } = await startPayment(userId, { purpose: 'GO_PACK', packId: pack.id, phone: '46733123456' });
  assert.equal(payment.status, 'PENDING');
  assert.equal(mtn.attempts.length, 2, 'refused once with the callback, accepted without it');
  assert.ok(mtn.attempts[0].headers['x-callback-url']);
  assert.equal(mtn.attempts[1].headers['x-callback-url'], undefined);
  const sent = mtn.requests.get(payment.id);
  assert.match(sent.body.payerMessage, /^Bwenge AI GO credits \d[\d,]* credits$/);
  assert.equal(sent.body.amount, String(pack.rwf));
  assert.equal(sent.body.payer.partyId, '46733123456', 'sandbox test numbers are sent as typed');

  mtn.attempts.length = 0;
  await startPayment(await newUser(), { purpose: 'PRO', months: 1, phone: '46733123457' });
  assert.equal(mtn.attempts.length, 1, 'later payments skip the refused callback');
  assert.equal(mtn.attempts[0].headers['x-callback-url'], undefined);
  mtn.refuseCallback = false;
  resetMomo();
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

test('admin connection test: token and Collections account checked, secrets never returned, missing keys named', async () => {
  const h = await momoHealth();
  assert.equal(h.ok, true);
  assert.deepEqual(h.steps.map((x) => x.step), ['Configuration', 'Access token', 'Collections account']);
  assert.ok(!JSON.stringify(h).includes('api-key') && !JSON.stringify(h).includes('sub-key'), 'no secrets in the result');
  const keep = process.env.MOMO_API_KEY;
  delete process.env.MOMO_API_KEY;
  try {
    const off = await momoHealth();
    assert.equal(off.ok, false);
    assert.match(off.steps[0].detail, /MOMO_API_KEY/);
  } finally { process.env.MOMO_API_KEY = keep; }
});

test('platform context: the AI knows the plan, credits left, real links, and when (not) to suggest upgrading', async () => {
  const free = await newUser();
  const web = await platformContext(free, 'web');
  assert.match(web, /Free plan/);
  assert.match(web, /Credits left: \d+ of 15 today/);
  assert.match(web, /Starter 1,500 RWF a month/);
  assert.match(web, /Pro 4,500 RWF a month/);
  assert.match(web, /overnight marking/);
  assert.match(web, /\[Open the scanner\]\([^)]*\/scan\)/);
  assert.match(web, /\[The results page\]\([^)]*\/exams\)/);
  assert.match(web, /\[Upgrade\]\([^)]*\/upgrade\)/);
  assert.match(web, /Without a scheme, Bwenge writes one from the questions and marks straight away/);
  assert.match(web, /red pen/);
  assert.match(web, /Never ask the user to confirm a scheme/);
  assert.match(web, /Suggest upgrading at most once/);
  const tg = await platformContext(free, 'telegram');
  assert.match(tg, /\/scan command/);
  assert.match(tg, /\]\(https:\/\/[^)]+\/upgrade\)/, 'absolute links in Telegram');

  const pro = await newUser();
  await db.subscription.create({ data: { id: randomUUID(), userId: pro, planType: 'PRO', status: 'ACTIVE', startDate: new Date(), endDate: new Date(Date.now() + 10 * 86_400_000) } });
  const p = await platformContext(pro, 'web');
  assert.match(p, /Pro plan, active until/);
  assert.match(p, /do not suggest upgrading/);
  assert.equal(await platformContext(null, 'web'), '');
});

test('marking access follows the plan and GO credits: no "free result used, pay per result" lock', async () => {
  const { PaywallService } = await import('../server/services/PaywallService.js');
  const paywall = PaywallService.getInstance();
  // A user with GO credits whose daily allowance is used up (the reported case: 440 GO, result "locked").
  const paid = await newUser();
  await db.creditLedger.create({ data: { id: randomUUID(), userId: paid, delta: 440, reason: 'purchase', paymentId: null, note: 'go', createdAt: new Date() } });
  await db.usageRecord.create({ data: { id: randomUUID(), userId: paid, kind: 'chat', credits: 25, model: 'gonka', inputTokens: 0, outputTokens: 0, costUsd: 0, channel: 'web', createdAt: new Date() } });
  await db.usageQuota.create({ data: { id: randomUUID(), userId: paid, service: 'grading', freeUsed: 5 } }).catch(() => undefined);
  for (let i = 0; i < 3; i++) assert.equal((await paywall.checkAccess(paid, 'grading', randomUUID())).allowed, true, 'GO credits pay for marking, every time');

  // Starter users mark from their monthly credits; Free users (no marking on Free) and paid users who ran out
  // with no top-up get an upgrade message, never a "free result".
  const starter = await newUser();
  await db.subscription.create({ data: { id: randomUUID(), userId: starter, planType: 'STARTER', status: 'ACTIVE', startDate: new Date(), endDate: new Date(Date.now() + 10 * 86_400_000) } });
  assert.equal((await paywall.checkAccess(starter, 'grading', randomUUID())).allowed, true);
  const free = await newUser();
  await db.usageRecord.create({ data: { id: randomUUID(), userId: free, kind: 'chat', credits: 25, model: 'gonka', inputTokens: 0, outputTokens: 0, costUsd: 0, channel: 'web', createdAt: new Date() } });
  const denied = await paywall.checkAccess(free, 'grading', randomUUID());
  assert.equal(denied.allowed, false);
  assert.match(denied.upgradeUrl!, /^\/upgrade\?reason=limit/);
  const msg = paywall.buildUpgradeMessage('grading', denied.upgradeUrl!, denied.message);
  assert.match(msg, /Limit reached/);
  assert.match(msg, /say \*\*"continue"\*\*/);
  assert.doesNotMatch(msg, /free .*result|one-time/i);
  assert.match(paywall.buildUpgradeMessage('grading', '/upgrade', denied.message, false), /send the request again/);
});

test('a request stopped by a limit resumes on "continue" / "give me result" after paying, without re-uploading', async () => {
  const { rememberBlocked, takeResumable, peekPending, resetPending } = await import('../server/services/billing/pendingRequest.js');
  resetPending();
  rememberBlocked('u-r', { query: 'Mark these scripts with the attached rubric', attachmentIds: ['f1', 'f2'], history: [{ role: 'user', text: 'x' }], learning: { mode: 'socratic' } }, 'marking');
  assert.equal(takeResumable('u-r', 'What is photosynthesis?', false), null, 'other messages do not resume');
  assert.equal(takeResumable('u-r', 'continue', true), null, 'a message with new files is a new request');
  assert.ok(peekPending('u-r'));
  const r = takeResumable('u-r', 'Now give me result then', false)!;
  assert.deepEqual(r.body, { query: 'Mark these scripts with the attached rubric', attachmentIds: ['f1', 'f2'] }, 'only the request itself is replayed');
  assert.equal(peekPending('u-r'), null, 'resumed once');
  for (const m of ['continue', 'OK, continue', 'I paid', "I've upgraded", 'give me the results please', 'show my marked scripts']) {
    rememberBlocked('u-r', { query: 'q' });
    assert.ok(takeResumable('u-r', m, false), m);
  }
  rememberBlocked('u-big', { query: 'q', attachments: [{ base64: 'x'.repeat(26 * 1024 * 1024) }], attachmentIds: ['f9'] });
  assert.deepEqual(peekPending('u-big')!.body, { query: 'q', attachmentIds: ['f9'] }, 'huge inline uploads are not kept in memory');
  resetPending();
});

test('AI guard: admin pause stops everyone, admins included; the profit guard stops free users when they cost more than the budget', async () => {
  const { decide, saveGuardSettings, resetGuard, guardState } = await import('../server/services/billing/aiGuard.js');
  const base = { paused: false, lossGuard: { enabled: true, freeBudgetUsd: 5, mode: 'free_only' as const } };
  assert.equal(decide(base, { revenueUsd: 0, costUsd: 4, free: { users: 3, costUsd: 4, credits: 0, actions: 0 } }).block, 'none');
  assert.equal(decide(base, { revenueUsd: 0, costUsd: 6, free: { users: 3, costUsd: 6, credits: 0, actions: 0 } }).block, 'free');
  assert.equal(decide({ ...base, lossGuard: { ...base.lossGuard, mode: 'all' } }, { revenueUsd: 10, costUsd: 16, free: { users: 3, costUsd: 1, credits: 0, actions: 0 } }).block, 'all', 'paying users cost more than they paid');
  assert.equal(decide({ ...base, lossGuard: { ...base.lossGuard, enabled: false } }, { revenueUsd: 0, costUsd: 99, free: { users: 3, costUsd: 99, credits: 0, actions: 0 } }).block, 'none');
  assert.equal(decide({ ...base, paused: true }, { revenueUsd: 99, costUsd: 0, free: { users: 0, costUsd: 0, credits: 0, actions: 0 } }).block, 'all');

  const free = await newUser();
  const go = await newUser();
  await db.creditLedger.create({ data: { id: randomUUID(), userId: go, delta: 100, reason: 'purchase', paymentId: null, note: 'go', createdAt: new Date() } });
  const admin = await newUser({ role: 'ADMIN' });

  // Pause: nobody, admins included (they resume it in the admin console).
  await saveGuardSettings({ paused: true, pausedReason: 'maintenance' }, admin);
  try {
  const p1 = await checkUsage(free, { kind: 'chat' });
  assert.equal(p1.allowed, false);
  assert.equal(p1.code, 'PAUSED');
  assert.equal((await checkUsage(go, { kind: 'chat' })).code, 'PAUSED');
  const a = await checkUsage(admin, { kind: 'chat' });
  assert.equal(a.allowed, false, 'the pause also stops admins');
  assert.match(a.message!, /Resume it in Admin/);
  } finally { await saveGuardSettings({ paused: false }, admin); }
  assert.equal((await checkUsage(free, { kind: 'chat' })).allowed, true);

  // Free users this month cost more than the budget: free users stop, paying users continue.
  await db.usageRecord.create({ data: { id: randomUUID(), userId: free, kind: 'chat', credits: 1, model: 'claude-opus', inputTokens: 0, outputTokens: 0, costUsd: 50, channel: 'telegram', createdAt: new Date() } });
  await saveGuardSettings({ lossGuard: { enabled: true, freeBudgetUsd: 5, mode: 'free_only' } }, admin);
  const st = await guardState(true);
  assert.equal(st.block, 'free');
  assert.ok(st.economics.byChannel.some((c) => c.channel === 'telegram' && c.costUsd >= 50), 'cost tracked per platform');
  const f = await checkUsage(free, { kind: 'chat' });
  assert.equal(f.allowed, false);
  assert.equal(f.code, 'PROTECTED');
  assert.match(f.message!, /Free AI answers are paused/);
  assert.match(f.message!, /top up/, 'offers a way to continue');
  assert.equal((await checkUsage(go, { kind: 'chat' })).allowed, true, 'paying users continue');
  assert.equal((await checkUsage(admin, { kind: 'chat' })).allowed, true, 'the profit guard never stops admins');
  await saveGuardSettings({ lossGuard: { enabled: false } }, admin);
  assert.equal((await checkUsage(free, { kind: 'chat' })).allowed, true);
  await db.usageRecord.deleteMany({ where: { userId: free } });
  await saveGuardSettings({ lossGuard: { enabled: true, freeBudgetUsd: 10 } }, admin);
  resetGuard();
});

test('Pause upgrades: no new plan or top-up can be bought until an admin resumes; the price list says so', async () => {
  const { setSalesPaused, salesState } = await import('../server/services/billing/sales.js');
  const { default: billingRoutes } = await import('../server/routes/billingRoutes.js');
  const userId = await newUser();
  await setSalesPaused(true, 'admin-1', 'Back on Monday.');
  try {
    const sent = mtn.requests.size;
    await assert.rejects(startPayment(userId, { purpose: 'PRO', months: 1, phone: '0788123456' }), (e: any) => e.code === 'SALES_PAUSED' && e.message === 'Back on Monday.');
    await assert.rejects(startPayment(userId, { purpose: 'GO_PACK', packId: currentGoPacks()[0].id, phone: '0788123456' }), (e: any) => e.code === 'SALES_PAUSED');
    assert.equal(mtn.requests.size, sent, 'nothing reached MTN');
    const app = express().use('/api/billing', billingRoutes);
    const srv: Server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
    try {
      const plans = await (await fetch(`http://127.0.0.1:${(srv.address() as AddressInfo).port}/api/billing/plans`)).json();
      assert.deepEqual(plans.sales, { paused: true, message: 'Back on Monday.' });
    } finally { srv.close(); }
  } finally {
    await setSalesPaused(false, 'admin-1');
  }
  assert.equal((await salesState(true)).paused, false);
  resetMomo();
  const { payment } = await startPayment(userId, { purpose: 'STARTER', months: 1, phone: '0788123457' });
  assert.equal(payment.status, 'PENDING', 'resumed: buying works again');
});
