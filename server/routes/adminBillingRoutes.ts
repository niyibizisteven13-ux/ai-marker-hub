import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import logger from '../utils/logger.js';
import { DEFAULT_GO_PACKS, PLANS, SOLD_PLANS, currentGoPacks, planIdForSubscription, subscriptionTypeFor, fxUsdRwf, planFor, refreshBillingSettings, toRwf, walletBalance, type BillingSettings } from '../services/billing/plans.js';
import { momoConfig, momoHealth, momoMode } from '../services/billing/momo.js';
import { checkPayment, publicPayment, runRenewalSweep } from '../services/billing/payments.js';
import { periods, usedTotals } from '../services/billing/usage.js';
import { guardState, saveGuardSettings } from '../services/billing/aiGuard.js';
import { DEFAULT_PAUSE_MESSAGE, salesState, setSalesPaused } from '../services/billing/sales.js';

/**
 * Admin billing control (/api/admin/billing, ADMIN only): revenue vs AI cost, prices and limits, Mobile Money
 * payments, and per-user plans and GO credits. Every change is logged with the admin's id.
 */
const router = Router();
const db = prisma as any;
const adminId = (req: Request) => (req as any).user?.userId as string;
const fail = (res: Response, e: any) => (e instanceof z.ZodError ? res.status(400).json({ error: 'Invalid request.', details: e.issues.slice(0, 5) }) : res.status(500).json({ error: e?.message ?? 'Failed.' }));

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

const limitsSchema = z.object({
  daily: z.number().int().min(1).max(1_000_000), weekly: z.number().int().min(1).max(5_000_000), monthly: z.number().int().min(1).max(20_000_000),
  perDay: z.object({ tool: z.number().int().min(0), vision: z.number().int().min(0), artifact: z.number().int().min(0), marking: z.number().int().min(0) }).partial(),
  maxMessageChars: z.number().int().min(500).max(500_000), maxAttachments: z.number().int().min(0).max(100), maxUploadMb: z.number().int().min(1).max(500), storageMb: z.number().int().min(10).max(10_000_000),
  memory: z.boolean(), memoryItems: z.number().int().min(0).max(1_000_000),
}).partial();
const priceSchema = z.object({ priceRwf: z.number().int().min(100).max(10_000_000).optional() });
const settingsSchema = z.object({
  schema: z.literal(2).default(2),
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
    const q = z.object({ status: z.enum(['PENDING', 'SUCCESSFUL', 'FAILED', 'EXPIRED']).optional(), limit: z.coerce.number().int().min(1).max(200).optional() }).parse(req.query);
    const rows = await db.billingPayment.findMany({ where: q.status ? { status: q.status } : {}, orderBy: { createdAt: 'desc' }, take: q.limit ?? 100 });
    const users = await db.user.findMany({ where: { id: { in: [...new Set(rows.map((r: any) => r.userId))] } }, select: { id: true, email: true, name: true } });
    const byId = new Map(users.map((u: any) => [u.id, u]));
    res.json({ success: true, payments: rows.map((r: any) => ({ ...publicPayment(r), user: byId.get(r.userId) ?? { id: r.userId } })) });
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
    const all = await db.user.findMany({ orderBy: { createdAt: 'desc' }, take: 500, select: { id: true, email: true, name: true, role: true, createdAt: true } });
    const list = all.filter((u: any) => !String(u.email).endsWith('@users.invalid') && (!q || `${u.email} ${u.name}`.toLowerCase().includes(q))).slice(0, 25);
    const out = await Promise.all(list.map(async (u: any) => {
      const [plan, sub, wallet, used, tg] = await Promise.all([planFor(u.id), db.subscription.findUnique({ where: { userId: u.id } }).catch(() => null), walletBalance(u.id), usedTotals(u.id), db.telegramSession.findFirst({ where: { userId: u.id } }).catch(() => null)]);
      return { ...u, plan: plan.id, subscription: sub ? { planType: sub.planType, status: sub.status, endDate: sub.endDate } : null, wallet, usedToday: used.used.day, dailyLimit: plan.limits.daily, telegram: Boolean(tg) };
    }));
    res.json({ success: true, users: out });
  } catch (e) { fail(res, e); }
});

/** Grants a plan for N days, or moves the user back to Free (ends the subscription now). */
router.post('/users/:id/plan', async (req, res) => {
  try {
    const body = z.object({ plan: z.enum(['FREE', 'STARTER', 'PRO', 'PLUS', 'INSTITUTION']), days: z.number().int().min(1).max(3660).optional() }).strict().parse(req.body ?? {});
    const userId = req.params.id;
    if (!(await db.user.findUnique({ where: { id: userId } }))) return res.status(404).json({ error: 'User not found.' });
    const sub = await db.subscription.findUnique({ where: { userId } });
    const now = new Date();
    if (body.plan === 'FREE') {
      if (sub) await db.subscription.update({ where: { userId }, data: { status: 'CANCELED', endDate: now } });
    } else {
      const planType = subscriptionTypeFor(body.plan);
      const endDate = new Date(now.getTime() + (body.days ?? 30) * 86_400_000);
      if (sub) await db.subscription.update({ where: { userId }, data: { planType, status: 'ACTIVE', startDate: now, endDate } });
      else await db.subscription.create({ data: { id: randomUUID(), userId, planType, status: 'ACTIVE', startDate: now, endDate, createdAt: now, updatedAt: now } });
    }
    logger.info('[admin billing] plan changed', { admin: adminId(req), userId, plan: body.plan, days: body.days });
    res.json({ success: true, plan: (await planFor(userId)).id });
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
