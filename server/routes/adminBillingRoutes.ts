import { hasBadge, setBadge } from '../services/billing/badge.js';
import { badgeGrantedEmail, planGrantedEmail, type Email } from '../services/billing/emails.js';
import { EmailService } from '../services/EmailService.js';
import { approveManualPayment, MANUAL_PAYMENT, startManualPayment } from '../services/billing/manual.js';
import { BillingError, notifyReceipt, receiptDelivery, renderPaidReceipt } from '../services/billing/payments.js';
import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import logger from '../utils/logger.js';
import { DEFAULT_GO_PACKS, PLANS, SOLD_PLANS, currentGoPacks, planIdForSubscription, subscriptionTypeFor, fxUsdRwf, planFor, refreshBillingSettings, toRwf, walletBalance, type BillingSettings } from '../services/billing/plans.js';
import { momoConfig, momoHealth, momoMode } from '../services/billing/momo.js';
import { checkPayment, publicPayment, runRenewalSweep } from '../services/billing/payments.js';
import { periods, tablePrice, usedTotals } from '../services/billing/usage.js';
import { FAMILIES, MAX_MULTIPLIER, MIN_MULTIPLIER, calibration, familyOf, loadCalibration, saveCalibration, suggestMultiplier } from '../services/billing/costCalibration.js';
import { looksLikePayRef, normalizePayRef, payRef } from '../services/billing/payRef.js';
import { guardState, saveGuardSettings } from '../services/billing/aiGuard.js';
import { DEFAULT_PAUSE_MESSAGE, salesState, setSalesPaused } from '../services/billing/sales.js';

/**
 * Admin billing control (/api/admin/billing, ADMIN only): revenue vs AI cost, prices and limits, Mobile Money
 * payments, and per-user plans and GO credits. Every change is logged with the admin's id.
 */
const router = Router();
const db = prisma as any;
const adminId = (req: Request) => (req as any).user?.userId as string;
const fail = (res: Response, e: any) => (e instanceof z.ZodError ? res.status(400).json({ error: 'Invalid request.', details: e.issues.slice(0, 5) }) : e instanceof BillingError ? res.status(e.status).json({ error: e.message, code: e.code }) : e?.code === 'P2002' ? res.status(409).json({ error: 'This MoMo transaction has already been used.' }) : res.status(500).json({ error: e?.message ?? 'Failed.' }));

async function deliverGrant(user: { email: string | null; name: string }, message: Email) {
  const email = user.email && !user.email.toLowerCase().endsWith('@users.invalid') ? user.email : null;
  if (!email) return { status: 'unavailable', email } as const;
  const result = await EmailService.getInstance().sendEmail({ to: email, ...message }).catch(() => null);
  return { status: result?.success ? 'sent' : 'failed', email };
}

router.get('/payment-method', async (_req, res) => {
  try { res.json({ success: true, automaticEnabled: false, manual: MANUAL_PAYMENT }); } catch (e) { fail(res, e); }
});
router.put('/payment-method', async (req, res) => {
  try {
    const { automaticEnabled } = z.object({ automaticEnabled: z.boolean() }).strict().parse(req.body);
    if (automaticEnabled) return res.status(409).json({ error: 'Automatic MTN payment is not available. Manual MoMo Pay is the active payment method.' });
    await db.appSetting.upsert({ where: { key: 'billing-automatic-payments' }, create: { key: 'billing-automatic-payments', value: { enabled: automaticEnabled }, updatedBy: adminId(req) }, update: { value: { enabled: automaticEnabled }, updatedBy: adminId(req) } });
    res.json({ success: true, automaticEnabled, manual: MANUAL_PAYMENT });
  } catch (e) { fail(res, e); }
});
router.post('/users/:id/manual-payment', async (req, res) => {
  try {
    const body = z.object({ purpose: z.enum(['STARTER', 'PRO', 'PLUS', 'GO_PACK', 'VERIFIED_BADGE']), packId: z.string().max(40).optional(), months: z.number().int().min(1).max(12).optional(), transactionId: z.string().trim().min(3).max(100).regex(/^[a-zA-Z0-9-]+$/) }).strict().parse(req.body);
    if (!(await db.user.findUnique({ where: { id: req.params.id } }))) return res.status(404).json({ error: 'User not found.' });
    const p = await startManualPayment(req.params.id, body, true);
    res.json({ success: true, payment: await approveManualPayment(p.id, body.transactionId.toUpperCase(), adminId(req)) });
  } catch (e) { fail(res, e); }
});
/** Gives or takes back the verified badge by hand (a mistake, abuse, or a gift); the payment itself is not refunded here. */
router.post('/users/:id/badge', async (req, res) => {
  try {
    const { active } = z.object({ active: z.boolean() }).strict().parse(req.body);
    const user = await db.user.findUnique({ where: { id: req.params.id }, select: { email: true, name: true } });
    if (!user) return res.status(404).json({ error: 'User not found.' });
    const wasVerified = await hasBadge(req.params.id);
    if (wasVerified !== active) await setBadge(req.params.id, active, adminId(req));
    const grantEmail = active && !wasVerified ? await deliverGrant(user, badgeGrantedEmail(user.name)) : undefined;
    logger.info('[admin billing] verified badge changed', { admin: adminId(req), userId: req.params.id, active });
    res.json({ success: true, active, grantEmail });
  } catch (e) { fail(res, e); }
});
router.post('/payments/:id/approve', async (req, res) => {
  try {
    const { transactionId } = z.object({ transactionId: z.string().trim().min(3).max(100).regex(/^[a-zA-Z0-9-]+$/) }).strict().parse(req.body);
    res.json({ success: true, payment: await approveManualPayment(req.params.id, transactionId.toUpperCase(), adminId(req)) });
  } catch (e) { fail(res, e); }
});
router.get('/payments/:id/receipt', async (req, res) => {
  try {
    const p = await db.billingPayment.findUnique({ where: { id: req.params.id } });
    if (!p?.fulfilledAt || p.status !== 'SUCCESSFUL' || !p.receiptNumber) return res.status(404).json({ error: 'Paid receipt not found.' });
    const user = await db.user.findUnique({ where: { id: p.userId }, select: { name: true } });
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:");
    res.type('html').send(renderPaidReceipt(p, user?.name ?? '').html);
  } catch (e) { fail(res, e); }
});
router.post('/payments/:id/receipt', async (req, res) => {
  try {
    const p = await db.billingPayment.findUnique({ where: { id: req.params.id } });
    if (!p?.fulfilledAt || p.status !== 'SUCCESSFUL') return res.status(404).json({ error: 'Paid receipt not found.' });
    await notifyReceipt(p);
    const after = await db.billingPayment.findUnique({ where: { id: p.id } });
    res.json({ success: true, payment: { ...publicPayment(after), receiptEmail: await receiptDelivery(after) } });
  } catch (e) { fail(res, e); }
});

router.get('/overview', async (_req, res) => {
  try {
    await refreshBillingSettings();
    const p = periods();
    const [paid, pending, subs, usage, sold, spent] = await Promise.all([
      db.billingPayment.findMany({ where: { status: 'SUCCESSFUL', fulfilledAt: { gte: p.month } } }),
      db.billingPayment.count({ where: { status: 'PENDING' } }),
      db.subscription.findMany({ where: { status: 'ACTIVE' } }),
      db.usageRecord.aggregate({ where: { createdAt: { gte: p.month } }, _sum: { costUsd: true, credits: true } }),
      db.creditLedger.aggregate({ where: { reason: 'purchase', createdAt: { gte: p.month } }, _sum: { delta: true } }),
      db.creditLedger.aggregate({ where: { reason: 'usage', createdAt: { gte: p.month } }, _sum: { delta: true } }),
    ]);
    const revenueRwf = paid.reduce((a: number, x: any) => a + (x.currency === 'RWF' ? x.amountRwf : 0), 0);
    const revenueUsd = paid.reduce((a: number, x: any) => a + (x.amountUsd ?? 0), 0);
    const costUsd = Number(usage?._sum?.costUsd ?? 0);
    const activeSubs = subs.filter((s: any) => !s.endDate || new Date(s.endDate).getTime() > Date.now());
    res.json({
      success: true,
      month: p.month.toISOString(),
      revenue: { rwf: revenueRwf, usd: Math.round(revenueUsd * 100) / 100, payments: paid.length },
      aiCost: { usd: Math.round(costUsd * 100) / 100, rwf: toRwf(costUsd), credits: Number(usage?._sum?.credits ?? 0) },
      margin: { usd: Math.round((revenueUsd - costUsd) * 100) / 100, percent: revenueUsd > 0 ? Math.round(((revenueUsd - costUsd) / revenueUsd) * 100) : null },
      pendingPayments: pending,
      subscriptions: Object.fromEntries((['STARTER', 'PRO', 'PLUS', 'INSTITUTION'] as const).map((id) => [id, activeSubs.filter((s: any) => planIdForSubscription(s.planType) === id).length])),
      goCredits: { sold: Number(sold?._sum?.delta ?? 0), used: -Number(spent?._sum?.delta ?? 0) },
      momo: { mode: momoMode(), targetEnv: momoConfig().targetEnv, currency: momoConfig().currency, callback: momoConfig().callbackHost.startsWith('https://') },
    });
  } catch (e) { fail(res, e); }
});

// AI generation: pause switch, profit guard and the economics behind it (cost vs revenue, free vs paying, web vs Telegram).
router.get('/ai-guard', async (_req, res) => {
  try { res.json({ success: true, ...(await guardState(true)) }); } catch (e) { fail(res, e); }
});
router.put('/ai-guard', async (req, res) => {
  try {
    const body = z.object({
      paused: z.boolean().optional(),
      pausedReason: z.string().trim().max(200).nullable().optional(),
      lossGuard: z.object({ enabled: z.boolean().optional(), freeBudgetUsd: z.number().min(0).max(100_000).optional(), mode: z.enum(['free_only', 'all']).optional() }).optional(),
    }).strict().parse(req.body ?? {});
    await saveGuardSettings(body as any, adminId(req));
    res.json({ success: true, ...(await guardState(true)) });
  } catch (e) { fail(res, e); }
});

// Cost calibration: makes recorded AI cost match the provider's real prices (credits, the profit guard and margins all depend on it).
async function calibrationState() {
  const cal = await loadCalibration(true);
  const since = periods().month;
  const rows: Array<{ model: string | null; costUsd: number | null }> = await db.usageRecord.findMany({ where: { createdAt: { gte: since } }, select: { model: true, costUsd: true } }).catch(() => []);
  const byFamily: Record<string, { costUsd: number; actions: number }> = {};
  for (const r of rows) {
    const f = familyOf(r.model); const e = (byFamily[f] ??= { costUsd: 0, actions: 0 });
    e.costUsd += Number(r.costUsd ?? 0); e.actions++;
  }
  const recordedUsd = Object.values(byFamily).reduce((a, x) => a + x.costUsd, 0);
  return {
    calibration: cal,
    families: FAMILIES.map((f) => ({ family: f, table: { in: tablePrice(f)[0], out: tablePrice(f)[1] }, override: cal.prices[f] ?? null })),
    limits: { min: MIN_MULTIPLIER, max: MAX_MULTIPLIER },
    month: { since: since.toISOString(), recordedUsd: Math.round(recordedUsd * 10_000) / 10_000, actions: Object.values(byFamily).reduce((a, x) => a + x.actions, 0), byFamily,
      /** Costs recorded before the last change used the older setting, so a comparison for this month is approximate. */
      changedThisMonth: !!cal.changedAt && new Date(cal.changedAt) >= since },
  };
}
router.get('/cost-calibration', async (_req, res) => {
  try { res.json({ success: true, ...(await calibrationState()) }); } catch (e) { fail(res, e); }
});
const modelPriceSchema = z.object({ in: z.number().min(0).max(1000), out: z.number().min(0).max(1000) });
router.put('/cost-calibration', async (req, res) => {
  try {
    const body = z.object({
      multiplier: z.number().min(MIN_MULTIPLIER).max(MAX_MULTIPLIER).optional(),
      prices: z.object(Object.fromEntries(FAMILIES.map((f) => [f, modelPriceSchema.nullable().optional()]))).strict().optional(),
    }).strict().parse(req.body ?? {});
    await saveCalibration(body as any, adminId(req));
    logger.info(`AI cost calibration changed by ${adminId(req)}: multiplier ${calibration().multiplier}`);
    res.json({ success: true, ...(await calibrationState()) });
  } catch (e) { fail(res, e); }
});
router.post('/cost-calibration/reconcile', async (req, res) => {
  try {
    const { invoiceUsd, apply } = z.object({ invoiceUsd: z.number().positive().max(10_000_000), apply: z.boolean().optional() }).strict().parse(req.body ?? {});
    const st = await calibrationState();
    const suggestion = suggestMultiplier({ invoiceUsd, recordedUsd: st.month.recordedUsd, currentMultiplier: st.calibration.multiplier });
    if (apply && suggestion.ratio !== null) {
      await saveCalibration({ multiplier: suggestion.suggested }, adminId(req));
      logger.info(`AI cost calibration applied from invoice by ${adminId(req)}: multiplier ${suggestion.suggested}`);
      return res.json({ success: true, applied: true, suggestion, ...(await calibrationState()) });
    }
    res.json({ success: true, applied: false, suggestion, ...st });
  } catch (e) { fail(res, e); }
});

const limitsSchema = z.object({
  fiveHours: z.number().int().min(1).max(1_000_000), daily: z.number().int().min(1).max(1_000_000), weekly: z.number().int().min(1).max(5_000_000), monthly: z.number().int().min(1).max(20_000_000),
  perDay: z.object({ tool: z.number().int().min(0), vision: z.number().int().min(0), artifact: z.number().int().min(0), marking: z.number().int().min(0) }).partial(),
  maxMessageChars: z.number().int().min(500).max(500_000), maxAttachments: z.number().int().min(0).max(100), maxUploadMb: z.number().int().min(1).max(500), storageMb: z.number().int().min(10).max(10_000_000),
  memory: z.boolean(), memoryItems: z.number().int().min(0).max(1_000_000),
}).partial();
const priceSchema = z.object({ priceRwf: z.number().int().min(100).max(10_000_000).optional() });
const settingsSchema = z.object({
  schema: z.union([z.literal(2), z.literal(3)]).default(3),
  fxUsdRwf: z.number().min(100).max(100_000).optional(),
  prices: z.object({ STARTER: priceSchema, PRO: priceSchema, PLUS: priceSchema }).partial().optional(),
  goPacks: z.array(z.object({ id: z.string().regex(/^[a-z0-9-]{2,30}$/), rwf: z.number().int().min(100).max(10_000_000), credits: z.number().int().min(1).max(10_000_000) })).min(1).max(8).optional(),
  limits: z.object({ FREE: limitsSchema, GO: limitsSchema, STARTER: limitsSchema, PRO: limitsSchema, PLUS: limitsSchema, INSTITUTION: limitsSchema }).partial().optional(),
}).strict();

router.get('/settings', async (_req, res) => {
  const row = await db.appSetting.findUnique({ where: { key: 'billing' } }).catch(() => null);
  await refreshBillingSettings(true);
  res.json({
    success: true, settings: row?.value ?? {}, updatedAt: row?.updatedAt ?? null,
    effective: { fxUsdRwf: fxUsdRwf(), goPacks: currentGoPacks(), defaultGoPacks: DEFAULT_GO_PACKS, plans: Object.fromEntries(Object.values(PLANS).map((p) => [p.id, { name: p.name, sold: (SOLD_PLANS as readonly string[]).includes(p.id), priceUsd: p.priceUsd, priceRwf: p.priceRwf, limits: p.limits }])) },
  });
});

router.put('/settings', async (req, res) => {
  try {
    const value = settingsSchema.parse(req.body ?? {}) as BillingSettings;
    const existing = await db.appSetting.findUnique({ where: { key: 'billing' } });
    if (existing) await db.appSetting.update({ where: { key: 'billing' }, data: { value, updatedBy: adminId(req), updatedAt: new Date() } });
    else await db.appSetting.create({ data: { key: 'billing', value, updatedBy: adminId(req), updatedAt: new Date() } });
    await refreshBillingSettings(true);
    logger.info('[admin billing] settings updated', { admin: adminId(req) });
    res.json({ success: true });
  } catch (e) { fail(res, e); }
});

/** The "Pause upgrades" switch: stops new plan and top-up purchases until it is turned off. */
router.get('/sales', async (_req, res) => {
  try { res.json({ success: true, ...(await salesState(true)), defaultMessage: DEFAULT_PAUSE_MESSAGE }); } catch (e) { fail(res, e); }
});
router.put('/sales', async (req, res) => {
  try {
    const body = z.object({ paused: z.boolean(), message: z.string().max(300).nullable().optional() }).strict().parse(req.body ?? {});
    const state = await setSalesPaused(body.paused, adminId(req), body.message);
    logger.info('[admin billing] upgrades ' + (state.paused ? 'paused' : 'resumed'), { admin: adminId(req) });
    res.json({ success: true, ...state, defaultMessage: DEFAULT_PAUSE_MESSAGE });
  } catch (e) { fail(res, e); }
});

router.get('/payments', async (req, res) => {
  try {
    const q = z.object({ purpose: z.enum(['STARTER', 'PRO', 'PLUS', 'GO_PACK', 'VERIFIED_BADGE']).optional(), status: z.enum(['PENDING', 'SUCCESSFUL', 'FAILED', 'EXPIRED']).optional(), limit: z.coerce.number().int().min(1).max(200).optional(), page: z.coerce.number().int().min(1).max(100000).default(1) }).parse(req.query);
    const limit = q.limit ?? 100;
    const matches = await db.billingPayment.findMany({ where: { status: q.status, purpose: q.purpose }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (q.page - 1) * limit, take: limit + 1 });
    const rows = matches.slice(0, limit);
    const users = await db.user.findMany({ where: { id: { in: [...new Set(rows.map((r: any) => r.userId))] } }, select: { id: true, email: true, name: true } });
    const byId = new Map(users.map((u: any) => [u.id, u]));
    res.json({ success: true, hasMore: matches.length > limit, payments: await Promise.all(rows.map(async (r: any) => ({ ...publicPayment(r), receiptEmail: await receiptDelivery(r), user: byId.get(r.userId) ?? { id: r.userId } }))) });
  } catch (e) { fail(res, e); }
});

router.post('/payments/:id/recheck', async (req, res) => {
  try { res.json({ success: true, payment: await checkPayment(req.params.id) }); } catch (e) { fail(res, e); }
});

router.post('/renewals/run', async (_req, res) => {
  try { res.json({ success: true, ...(await runRenewalSweep()) }); } catch (e) { fail(res, e); }
});

/** Checks the MTN MoMo connection with the server's credentials (token + Collections account). */
router.post('/momo/test', async (_req, res) => {
  try { res.json({ success: true, ...(await momoHealth()) }); } catch (e) { fail(res, e); }
});

/** Users with their plan, renewal, GO balance and usage today. */
router.get('/users', async (req, res) => {
  try {
    const q = String(req.query.q ?? '').trim().toLowerCase().slice(0, 100);
    const all = await db.user.findMany({ ...(q && !looksLikePayRef(q) ? { where: { OR: [{ email: { contains: q, mode: 'insensitive' } }, { name: { contains: q, mode: 'insensitive' } }] } } : {}), orderBy: { createdAt: 'desc' }, ...(q && looksLikePayRef(q) ? {} : { take: q ? 25 : 500 }), select: { id: true, email: true, name: true, role: true, createdAt: true } });
    // A payment code (BW-4F7K2A) from the person's WhatsApp message finds exactly that person.
    const byCode = looksLikePayRef(q) ? normalizePayRef(q) : null;
    const list = all.filter((u: any) => !String(u.email).endsWith('@users.invalid') && (byCode ? payRef(u.id) === byCode : !q || `${u.email} ${u.name}`.toLowerCase().includes(q))).slice(0, 25);
    const out = await Promise.all(list.map(async (u: any) => {
      const [plan, sub, wallet, used, tg, verified] = await Promise.all([planFor(u.id), db.subscription.findUnique({ where: { userId: u.id } }).catch(() => null), walletBalance(u.id), usedTotals(u.id), db.telegramSession.findFirst({ where: { userId: u.id } }).catch(() => null), hasBadge(u.id)]);
      return { ...u, payCode: payRef(u.id), plan: plan.id, subscription: sub ? { planType: sub.planType, status: sub.status, endDate: sub.endDate } : null, wallet, usedToday: used.used.day, dailyLimit: plan.limits.daily, telegram: Boolean(tg), verified };
    }));
    res.json({ success: true, users: out });
  } catch (e) { fail(res, e); }
});

/** Grants a plan for N days, or moves the user back to Free (ends the subscription now). */
router.post('/users/:id/plan', async (req, res) => {
  try {
    const body = z.object({ plan: z.enum(['FREE', 'STARTER', 'PRO', 'PLUS', 'INSTITUTION']), days: z.number().int().min(1).max(3660).optional() }).strict().parse(req.body ?? {});
    const userId = req.params.id;
    const user = await db.user.findUnique({ where: { id: userId }, select: { email: true, name: true } });
    if (!user) return res.status(404).json({ error: 'User not found.' });
    const now = new Date();
    let endDate: Date | null = null;
    if (body.plan === 'FREE') {
      await db.subscription.updateMany({ where: { userId }, data: { status: 'CANCELED', endDate: now } });
    } else {
      const planType = subscriptionTypeFor(body.plan);
      endDate = new Date(now.getTime() + (body.days ?? 30) * 86_400_000);
      const grant = { planType, status: 'ACTIVE', startDate: now, endDate };
      await db.subscription.upsert({
        where: { userId },
        update: grant,
        create: { id: randomUUID(), userId, ...grant, createdAt: now, updatedAt: now },
      });
    }
    logger.info('[admin billing] plan changed', { admin: adminId(req), userId, plan: body.plan, days: body.days });
    void import('../services/platformContext.js').then((m) => m.invalidatePlatformContext(userId)).catch(() => undefined);
    const plan = await planFor(userId);
    if (!endDate) return res.json({ success: true, plan: plan.id });
    const grantEmail = await deliverGrant(user, planGrantedEmail({ name: user.name, plan, endDate }));
    if (grantEmail.status === 'failed') logger.warn('[admin billing] plan grant email failed', { userId, plan: plan.id });
    res.json({ success: true, plan: plan.id, grantEmail });
  } catch (e) { fail(res, e); }
});

/** Adds (or removes, with a negative number) GO credits, with a note. */
router.post('/users/:id/credits', async (req, res) => {
  try {
    const body = z.object({ delta: z.number().int().min(-1_000_000).max(1_000_000).refine((n) => n !== 0), note: z.string().min(3).max(200) }).strict().parse(req.body ?? {});
    const userId = req.params.id;
    if (!(await db.user.findUnique({ where: { id: userId } }))) return res.status(404).json({ error: 'User not found.' });
    const balance = await walletBalance(userId);
    const delta = body.delta < 0 ? -Math.min(-body.delta, balance) : body.delta;
    if (delta === 0) return res.status(400).json({ error: 'The user has no credits to remove.' });
    await db.creditLedger.create({ data: { id: randomUUID(), userId, delta, reason: 'adjustment', note: body.note, createdBy: adminId(req), createdAt: new Date() } });
    logger.info('[admin billing] credits adjusted', { admin: adminId(req), userId, delta });
    res.json({ success: true, wallet: await walletBalance(userId) });
  } catch (e) { fail(res, e); }
});

export default router;
