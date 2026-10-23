import { prisma } from '../../db.js';
import logger from '../../utils/logger.js';
import { periods } from './usage.js';

/**
 * AI guard: an admin pause switch for all AI generation, and a profit guard that compares this month's AI cost
 * with this month's revenue, across web and Telegram, and stops generation by itself when the platform is losing
 * money. Every AI action passes through checkUsage, which asks this module first.
 *
 * Profit guard, per calendar month (Kigali time):
 *  - "free cost" is what users without a paid plan or GO credits cost; it may use up to `freeBudgetUsd`
 *    (the marketing allowance the admin accepts to lose on free users);
 *  - "paying cost" is what PRO, Institution and GO users cost; it should stay below what they paid.
 * When free cost passes its budget, free users are paused (paying users continue). When the whole platform is in
 * loss (total cost > revenue + free budget) and the mode is "all", every non-admin user is paused.
 * Admins are never paused, so they can still test and fix things.
 */

const db = prisma as any;
const KEY = 'ai_guard';
const CACHE_MS = 60_000;

export interface GuardSettings {
  paused: boolean;
  pausedReason?: string | null;
  pausedAt?: string | null;
  pausedBy?: string | null;
  lossGuard: { enabled: boolean; freeBudgetUsd: number; mode: 'free_only' | 'all' };
}
const DEFAULTS: GuardSettings = { paused: false, lossGuard: { enabled: true, freeBudgetUsd: 10, mode: 'free_only' } };

export interface Economics {
  month: string;
  revenueUsd: number;
  costUsd: number;
  marginUsd: number;
  free: { users: number; costUsd: number; credits: number; actions: number };
  paying: { users: number; costUsd: number; credits: number; actions: number; revenueUsd: number };
  byChannel: Array<{ channel: string; users: number; costUsd: number; credits: number; actions: number }>;
  topUsers: Array<{ user: string; paying: boolean; costUsd: number; credits: number; actions: number }>;
  costPerFreeUser: number | null;
  costPerPayingUser: number | null;
  revenuePerPayingUser: number | null;
  conversionPercent: number | null;
}

export interface GuardState {
  settings: GuardSettings;
  economics: Economics;
  /** What the guard does right now. */
  block: 'none' | 'free' | 'all';
  reason: string | null;
}

let settingsCache: { at: number; value: GuardSettings } | null = null;
let stateCache: { at: number; value: GuardState } | null = null;
let lastBlock: GuardState['block'] = 'none';

export async function guardSettings(force = false): Promise<GuardSettings> {
  if (!force && settingsCache && Date.now() - settingsCache.at < CACHE_MS) return settingsCache.value;
  const row = await db.appSetting.findUnique({ where: { key: KEY } }).catch(() => null);
  const v = (row?.value && typeof row.value === 'object' ? row.value : {}) as Partial<GuardSettings>;
  const value: GuardSettings = { ...DEFAULTS, ...v, lossGuard: { ...DEFAULTS.lossGuard, ...(v.lossGuard ?? {}) } };
  settingsCache = { at: Date.now(), value };
  return value;
}

export async function saveGuardSettings(patch: Partial<Omit<GuardSettings, 'lossGuard'>> & { lossGuard?: Partial<GuardSettings['lossGuard']> }, adminId: string): Promise<GuardSettings> {
  const cur = await guardSettings(true);
  const next: GuardSettings = { ...cur, ...patch, lossGuard: { ...cur.lossGuard, ...(patch.lossGuard ?? {}) } };
  if (patch.paused !== undefined && patch.paused !== cur.paused) {
    next.pausedAt = patch.paused ? new Date().toISOString() : null;
    next.pausedBy = patch.paused ? adminId : null;
    if (!patch.paused) next.pausedReason = null;
  }
  const now = new Date();
  const existing = await db.appSetting.findUnique({ where: { key: KEY } }).catch(() => null);
  if (existing) await db.appSetting.update({ where: { key: KEY }, data: { value: next, updatedBy: adminId, updatedAt: now } });
  else await db.appSetting.create({ data: { key: KEY, value: next, updatedBy: adminId, updatedAt: now } });
  logger.info('[ai-guard] settings changed', { adminId, paused: next.paused, lossGuard: next.lossGuard });
  settingsCache = { at: Date.now(), value: next };
  stateCache = null;
  return next;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const mask = (email: string | undefined, id: string) => (email ? email.replace(/^(.).*(@.*)$/, '$1•••$2') : `${id.slice(0, 6)}…`);

/** Users who paid this month or hold an active paid plan or GO credits: their usage is covered by revenue. */
async function payingUserIds(since: Date): Promise<Set<string>> {
  const [subs, buys, paid] = await Promise.all([
    db.subscription.findMany({ where: { status: 'ACTIVE' } }),
    db.creditLedger.findMany({ where: { reason: 'purchase' } }),
    db.billingPayment.findMany({ where: { status: 'SUCCESSFUL', fulfilledAt: { gte: since } } }),
  ]);
  const ids = new Set<string>();
  for (const s of subs) if (!s.endDate || new Date(s.endDate).getTime() > Date.now()) ids.add(s.userId);
  for (const b of buys) ids.add(b.userId);
  for (const p of paid) ids.add(p.userId);
  return ids;
}

export async function economics(now = Date.now()): Promise<Economics> {
  const p = periods(now);
  const [records, payments, paying] = await Promise.all([
    db.usageRecord.findMany({ where: { createdAt: { gte: p.month } } }),
    db.billingPayment.findMany({ where: { status: 'SUCCESSFUL', fulfilledAt: { gte: p.month } } }),
    payingUserIds(p.month),
  ]);
  const revenueUsd = payments.reduce((a: number, x: any) => a + Number(x.amountUsd ?? 0), 0);
  const per = new Map<string, { costUsd: number; credits: number; actions: number }>();
  const channels = new Map<string, { users: Set<string>; costUsd: number; credits: number; actions: number }>();
  const free = { users: new Set<string>(), costUsd: 0, credits: 0, actions: 0 };
  const pay = { users: new Set<string>(), costUsd: 0, credits: 0, actions: 0 };
  for (const r of records) {
    const cost = Number(r.costUsd ?? 0), credits = Number(r.credits ?? 0);
    const u = per.get(r.userId) ?? { costUsd: 0, credits: 0, actions: 0 };
    u.costUsd += cost; u.credits += credits; u.actions++; per.set(r.userId, u);
    const ch = channels.get(r.channel ?? 'web') ?? { users: new Set<string>(), costUsd: 0, credits: 0, actions: 0 };
    ch.users.add(r.userId); ch.costUsd += cost; ch.credits += credits; ch.actions++; channels.set(r.channel ?? 'web', ch);
    const g = paying.has(r.userId) ? pay : free;
    g.users.add(r.userId); g.costUsd += cost; g.credits += credits; g.actions++;
  }
  const top = [...per].sort((a, b) => b[1].costUsd - a[1].costUsd).slice(0, 8);
  const emails = new Map<string, string>();
  for (const [id] of top) { const u = await db.user.findUnique({ where: { id } }).catch(() => null); if (u?.email) emails.set(id, u.email); }
  const costUsd = free.costUsd + pay.costUsd;
  const activeUsers = free.users.size + pay.users.size;
  return {
    month: p.month.toISOString(),
    revenueUsd: r2(revenueUsd), costUsd: r2(costUsd), marginUsd: r2(revenueUsd - costUsd),
    free: { users: free.users.size, costUsd: r2(free.costUsd), credits: free.credits, actions: free.actions },
    paying: { users: pay.users.size, costUsd: r2(pay.costUsd), credits: pay.credits, actions: pay.actions, revenueUsd: r2(revenueUsd) },
    byChannel: [...channels].map(([channel, c]) => ({ channel, users: c.users.size, costUsd: r2(c.costUsd), credits: c.credits, actions: c.actions })).sort((a, b) => b.costUsd - a.costUsd),
    topUsers: top.map(([id, u]) => ({ user: mask(emails.get(id), id), paying: paying.has(id), costUsd: r2(u.costUsd), credits: u.credits, actions: u.actions })),
    costPerFreeUser: free.users.size ? Math.round((free.costUsd / free.users.size) * 10000) / 10000 : null,
    costPerPayingUser: pay.users.size ? Math.round((pay.costUsd / pay.users.size) * 10000) / 10000 : null,
    revenuePerPayingUser: pay.users.size ? r2(revenueUsd / pay.users.size) : null,
    conversionPercent: activeUsers ? Math.round((pay.users.size / activeUsers) * 1000) / 10 : null,
  };
}

/** Decides what is blocked from the settings and this month's numbers. Pure, for tests. */
export function decide(s: GuardSettings, e: Pick<Economics, 'revenueUsd' | 'costUsd' | 'free'>): { block: GuardState['block']; reason: string | null } {
  if (s.paused) return { block: 'all', reason: s.pausedReason || 'paused by an administrator' };
  if (!s.lossGuard.enabled) return { block: 'none', reason: null };
  const budget = Math.max(0, s.lossGuard.freeBudgetUsd);
  if (s.lossGuard.mode === 'all' && e.costUsd > e.revenueUsd + budget) return { block: 'all', reason: `this month's AI cost ($${e.costUsd.toFixed(2)}) is above revenue ($${e.revenueUsd.toFixed(2)}) plus the $${budget.toFixed(2)} free budget` };
  if (e.free.costUsd > budget) return { block: 'free', reason: `free usage this month ($${e.free.costUsd.toFixed(2)}) is above the $${budget.toFixed(2)} free budget` };
  return { block: 'none', reason: null };
}

export async function guardState(force = false): Promise<GuardState> {
  if (!force && stateCache && Date.now() - stateCache.at < CACHE_MS) return stateCache.value;
  const [settings, e] = await Promise.all([guardSettings(force), economics()]);
  const d = decide(settings, e);
  if (d.block !== lastBlock) {
    logger.warn('[ai-guard] generation guard changed', { from: lastBlock, to: d.block, reason: d.reason });
    lastBlock = d.block;
  }
  const value = { settings, economics: e, ...d };
  stateCache = { at: Date.now(), value };
  return value;
}

/** Whether this user may start an AI action now. Admins are never blocked. */
export async function guardFor(userId: string, opts: { role?: string | null; paying: boolean }): Promise<{ allowed: true } | { allowed: false; code: 'PAUSED' | 'BUDGET'; message: string }> {
  if (opts.role === 'ADMIN') return { allowed: true };
  const st = await guardState().catch(() => null);
  if (!st || st.block === 'none') return { allowed: true };
  if (st.settings.paused) return { allowed: false, code: 'PAUSED', message: 'Bwenge AI is paused for a short maintenance. Please try again a little later.' };
  if (st.block === 'all') return { allowed: false, code: 'BUDGET', message: 'Bwenge AI is temporarily unavailable because of very high demand. Please try again later.' };
  if (!opts.paying) return { allowed: false, code: 'BUDGET', message: 'Free AI answers are paused for now because of very high demand.' };
  return { allowed: true };
}

export function resetGuard() { settingsCache = null; stateCache = null; lastBlock = 'none'; }
