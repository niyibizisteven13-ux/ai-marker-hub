import { randomUUID } from 'node:crypto';
import { storageSummary } from './storage.js';
import { prisma } from '../../db.js';
import { PLANS, currentGoPacks, planFor, walletBalance, type PlanId, type PlanInfo, type UsageKind } from './plans.js';
import { BATCH_PRICE_FACTOR } from '../ai/batchMode.js';
import { guardFor } from './aiGuard.js';
import { markingEntitled } from './entitlements.js';
import { calibration, familyOf, loadCalibration, type Family } from './costCalibration.js';

/**
 * Usage metering and plan limits. Every AI action is recorded with its real token usage and priced in
 * credits (1 credit = $0.001 of model cost, at least 1). Before an action, the user's day, ISO week and
 * month totals and the per-feature daily counts are checked against their plan. Periods follow Kigali time.
 */

const db = prisma as any;
const KIGALI_OFFSET_MS = 2 * 3600_000;
const DAY = 86_400_000;
const FIVE_HOURS = 5 * 3_600_000;
export const USD_PER_CREDIT = 0.001;

/** The built-in price table: USD per million tokens [input, output] by model family. Other models use AI_PRICE_* (defaults below). */
export function tablePrice(family: Family): [number, number] {
  if (family === 'haiku') return [0.10, 0.50];
  if (family === 'sonnet') return [2, 10];
  if (family === 'opus') return [4, 20];
  if (family === 'fable') return [10, 50];
  const env = (k: string, d: number) => (Number(process.env[k]) >= 0 && process.env[k] ? Number(process.env[k]) : d);
  return [env('AI_PRICE_IN_PER_MTOK', 0.10), env('AI_PRICE_OUT_PER_MTOK', 0.50)];
}

/** USD per million tokens [input, output]: the admin's calibration for this model family if set, else the table. */
function pricePerMTok(model?: string | null): [number, number] {
  const family = familyOf(model);
  const override = calibration().prices[family];   // set in Admin → Billing → Cost calibration
  return override ? [override.in, override.out] : tablePrice(family);
}

export function costUsd(model: string | null | undefined, inputTokens: number, outputTokens: number): number {
  const [i, o] = pricePerMTok(model);
  return ((Math.max(0, inputTokens) * i + Math.max(0, outputTokens) * o) / 1_000_000) * calibration().multiplier;
}

/** Credits for a model call; batch (overnight) calls cost half, like the API price. */
export const creditsFor = (model: string | null | undefined, inputTokens: number, outputTokens: number, batch = false) =>
  Math.max(1, Math.ceil((costUsd(model, inputTokens, outputTokens) * (batch ? BATCH_PRICE_FACTOR : 1)) / USD_PER_CREDIT - 1e-9));

/** Start of the current day, ISO week (Monday) and month in Kigali time, and when each resets. */
export function periods(now = Date.now()) {
  const k = new Date(now + KIGALI_OFFSET_MS);
  const day = Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()) - KIGALI_OFFSET_MS;
  const week = day - ((k.getUTCDay() + 6) % 7) * DAY;
  const month = Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), 1) - KIGALI_OFFSET_MS;
  const nextMonth = Date.UTC(k.getUTCFullYear(), k.getUTCMonth() + 1, 1) - KIGALI_OFFSET_MS;
  const fiveHours = Math.floor((now + KIGALI_OFFSET_MS) / FIVE_HOURS) * FIVE_HOURS - KIGALI_OFFSET_MS;
  return { fiveHours: new Date(fiveHours), day: new Date(day), week: new Date(week), month: new Date(month), resets: { fiveHours: new Date(fiveHours + FIVE_HOURS), day: new Date(day + DAY), week: new Date(week + 7 * DAY), month: new Date(nextMonth) } };
}

const windows = ['fiveHours', 'day', 'week', 'month'] as const;
type CreditWindow = (typeof windows)[number];
type CreditTotals = Record<CreditWindow, number>;
const featureKinds = ['tool', 'vision', 'artifact', 'marking'] as const;

export async function usedTotals(userId: string, now = Date.now(), client = db) {
  const p = periods(now);
  const starts = windows.map(key => p[key].getTime());
  const earliest = new Date(Math.min(...starts));
  const [records, debits] = await Promise.all([
    client.usageRecord.findMany({ where: { userId, createdAt: { gte: earliest } }, select: { credits: true, createdAt: true, kind: true } }),
    client.creditLedger.findMany({ where: { userId, reason: 'usage', delta: { lt: 0 }, createdAt: { gte: earliest } }, select: { delta: true, createdAt: true } }),
  ]);
  const walletUsed: CreditTotals = { fiveHours: 0, day: 0, week: 0, month: 0 };
  const used: CreditTotals = { ...walletUsed };
  const perDay = { tool: 0, vision: 0, artifact: 0, marking: 0 };
  for (const debit of debits) {
    for (const key of windows) if (new Date(debit.createdAt) >= p[key]) walletUsed[key] -= debit.delta;
  }
  for (const record of records) {
    const at = new Date(record.createdAt);
    for (const key of windows) if (at >= p[key]) used[key] += record.credits;
    const kind = record.kind as keyof typeof perDay;
    if (at >= p.day && featureKinds.includes(kind)) perDay[kind]++;
  }
  for (const key of windows) used[key] = Math.max(0, used[key] - walletUsed[key]);
  return { p, used, walletUsed, perDay };
}

function walletLimits(plan: PlanInfo) {
  return { fiveHours: Math.max(50, plan.limits.fiveHours), week: Math.max(200, plan.limits.weekly) };
}

function creditRoom(plan: PlanInfo, kind: UsageKind, usage: Awaited<ReturnType<typeof usedTotals>>, balance: number) {
  const { used, walletUsed, perDay } = usage;
  const L = plan.limits;
  const limit = walletLimits(plan);
  const planLeft = kind !== 'chat' && perDay[kind] >= L.perDay[kind]
    ? 0 : Math.max(0, Math.min(L.fiveHours - used.fiveHours, L.daily - used.day, L.weekly - used.week, L.monthly - used.month));
  const walletLeft = Math.max(0, Math.min(balance, limit.fiveHours - walletUsed.fiveHours, limit.week - walletUsed.week));
  return { planLeft, walletLeft, limit };
}

export type LimitCode = 'FIVE_HOURS' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'FEATURE' | 'MESSAGE_TOO_LONG' | 'TOO_MANY_ATTACHMENTS' | 'PAUSED' | 'PROTECTED';
export interface GateResult {
  allowed: boolean;
  plan: PlanInfo;
  /** Allowed beyond the plan allowance because the user holds GO credits (they pay for this action). */
  wallet?: boolean;
  code?: LimitCode;
  message?: string;
  resetsAt?: string;
  upgrade?: { plan: PlanId; url: string };
}

const FEATURE_LABEL: Record<Exclude<UsageKind, 'chat'>, string> = { tool: 'data and tool answers', vision: 'image and scan reads', artifact: 'files, charts and dashboards', marking: 'marked scripts' };

function until(d: Date, now: number) {
  const h = Math.max(0, Math.round((d.getTime() - now) / 3600_000));
  return h < 1 ? 'within the hour' : h < 48 ? `in ${h} h` : `on ${d.toISOString().slice(0, 10)}`;
}

/** The plan to suggest next: Pro for Free / top-up / Starter users, Pro Plus for Pro users. */
function nextPlan(plan: PlanInfo): PlanId | null {
  return plan.id === 'FREE' || plan.id === 'GO' || plan.id === 'STARTER' ? 'PRO' : plan.id === 'PRO' ? 'PLUS' : null;
}
const rwf = (n: number | null) => `${(n ?? 0).toLocaleString('en-US')} RWF`;

function upsell(plan: PlanInfo): string {
  const next = nextPlan(plan);
  const minPack = currentGoPacks()[0];
  const topUp = minPack ? `, or top up from ${rwf(minPack.rwf)}` : '';
  if (!next) return `Top up credits to keep going${minPack ? ` (from ${rwf(minPack.rwf)})` : ''}.`;
  const p = PLANS[next];
  return `${p.name} (${rwf(p.priceRwf)} a month, about $${p.priceUsd}) gives ${p.limits.monthly.toLocaleString('en-US')} credits a month${p.limits.memory ? ' and memory across all chats' : ''}${topUp}.`;
}

/** Checks the plan limits before an AI action. Totals are compared before the action is charged. */
export async function checkUsage(userId: string, req: { kind: UsageKind; chars?: number; attachments?: number; minCredits?: number }, now = Date.now()): Promise<GateResult> {
  await loadCalibration().catch(() => undefined);
  const plan = await planFor(userId);
  const L = plan.limits;
  const next = nextPlan(plan);
  const deny = (code: LimitCode, message: string, resetsAt?: Date): GateResult => ({
    allowed: false, plan, code, message: `${message} ${upsell(plan)}`, resetsAt: resetsAt?.toISOString(),
    ...(next ? { upgrade: { plan: next, url: '/upgrade?reason=limit' } } : {}),
  });
  // The admin pause switch and the profit guard come first: they apply whatever the plan allowance says.
  {
    const role = (await db.user.findUnique({ where: { id: userId } }).catch(() => null))?.role ?? null;
    const paying = plan.id !== 'FREE' || (await walletBalance(userId)) > 0;
    const g = await guardFor(userId, { role, paying });
    if ('code' in g) {
      return g.code === 'PAUSED' || paying
        ? { allowed: false, plan, code: g.code === 'PAUSED' ? 'PAUSED' : 'PROTECTED', message: g.message }
        : deny('PROTECTED', g.message);
    }
  }
  if ((req.chars ?? 0) > L.maxMessageChars) return deny('MESSAGE_TOO_LONG', `Your message is ${req.chars!.toLocaleString('en-US')} characters; the ${plan.name} plan allows ${L.maxMessageChars.toLocaleString('en-US')}. Attach long text as a file instead.`);
  if ((req.attachments ?? 0) > L.maxAttachments) return deny('TOO_MANY_ATTACHMENTS', `The ${plan.name} plan allows ${L.maxAttachments} attachments per message.`);
  const usage = await usedTotals(userId, now);
  const { p, used, perDay, walletUsed } = usage;
  const balance = await walletBalance(userId);
  const need = Math.max(1, Math.ceil(req.minCredits ?? 1));
  const { planLeft, walletLeft, limit } = creditRoom(plan, req.kind, usage, balance);
  if (planLeft >= need) return { allowed: true, plan };
  if (planLeft + walletLeft >= need) return { allowed: true, plan, wallet: true };
  if (balance > walletLeft) {
    if (limit.week - walletUsed.week <= limit.fiveHours - walletUsed.fiveHours) {
      return deny('WEEKLY', 'Your wallet has credits held for the next weekly allowance.', p.resets.week);
    }
    return deny('FIVE_HOURS', 'Your wallet has credits held for the next five-hour allowance.', p.resets.fiveHours);
  }
  if (used.month + need > L.monthly) return deny('MONTHLY', `You have reached this month's ${L.monthly.toLocaleString('en-US')}-credit limit. It renews ${until(p.resets.month, now)}.`, p.resets.month);
  if (used.week + need > L.weekly) return deny('WEEKLY', `You have reached this week's ${L.weekly.toLocaleString('en-US')}-credit limit. It renews ${until(p.resets.week, now)}.`, p.resets.week);
  if (used.day + need > L.daily) return deny('DAILY', `You have reached today's ${L.daily}-credit limit. It renews ${until(p.resets.day, now)} (midnight, Kigali time).`, p.resets.day);
  if (used.fiveHours + need > L.fiveHours) return deny('FIVE_HOURS', `You have reached the ${L.fiveHours}-credit limit for this five-hour window. It renews ${until(p.resets.fiveHours, now)}.`, p.resets.fiveHours);
  if (req.kind !== 'chat' && perDay[req.kind] >= L.perDay[req.kind]) return deny('FEATURE', `You have reached today's limit of ${L.perDay[req.kind]} ${FEATURE_LABEL[req.kind]}. Plain chat still works.`, p.resets.day);
  return { allowed: true, plan };
}

/** Records one AI action and returns the credits charged. Never throws: metering must not break a reply. */
export async function recordUsage(userId: string, u: { kind: UsageKind; model?: string | null; inputTokens?: number; outputTokens?: number; channel?: 'web' | 'telegram'; minCredits?: number; /** Sent as an overnight batch (half price). */ batch?: boolean;
  /** Other model calls that belong to the same action (for example reading a script's handwriting before marking it): charged in this one record, so the action counts once. */
  extra?: Array<{ model: string | null; inputTokens: number; outputTokens: number }> }): Promise<number> {
  await loadCalibration().catch(() => undefined);
  const input = Math.max(0, Math.round(u.inputTokens ?? 0));
  const output = Math.max(0, Math.round(u.outputTokens ?? 0));
  const extra = (u.extra ?? []).filter((x) => x.inputTokens > 0 || x.outputTokens > 0);
  const credits = Math.max(u.minCredits ?? 1, creditsFor(u.model, input, output, u.batch)) + extra.reduce((a, x) => a + creditsFor(x.model, x.inputTokens, x.outputTokens, u.batch), 0);
  try {
    const plan = await planFor(userId);
    const createdAt = new Date();
    const id = randomUUID();
    for (let attempt = 0; ; attempt++) {
      try {
        await db.$transaction(async (tx: typeof db) => {
          const [usage, wallet] = await Promise.all([
            usedTotals(userId, createdAt.getTime(), tx),
            tx.creditLedger.aggregate({ where: { userId }, _sum: { delta: true } }),
          ]);
          const { planLeft, walletLeft } = creditRoom(plan, u.kind, usage, Math.max(0, Number(wallet?._sum?.delta ?? 0)));
          const debit = Math.min(walletLeft, Math.max(0, credits - planLeft));
          if (debit > 0) await tx.creditLedger.create({ data: { id, userId, delta: -debit, reason: 'usage', note: u.kind, createdAt } });
          await tx.usageRecord.create({ data: { id, userId, kind: u.kind, credits, model: u.model ?? null, inputTokens: input, outputTokens: output, costUsd: (costUsd(u.model, input, output) + extra.reduce((a, x) => a + costUsd(x.model, x.inputTokens, x.outputTokens), 0)) * (u.batch ? BATCH_PRICE_FACTOR : 1), channel: u.channel ?? 'web', createdAt } });
        }, { isolationLevel: 'Serializable' });
        break;
      } catch (error) {
        if ((error as { code?: string })?.code !== 'P2034' || attempt >= 3) throw error;
      }
    }
  } catch {
    /* Metering is best-effort. The provider cost is never a reason to debit past a wallet cap. */
  }
  return credits;
}

/** Everything the Usage settings page shows. */
export async function usageSummary(userId: string, now = Date.now()) {
  const plan = await planFor(userId);
  const usage = await usedTotals(userId, now);
  const { p, used, perDay, walletUsed } = usage;
  const recent = await db.usageRecord.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 15 });
  const L = plan.limits;
  const wallet = await walletBalance(userId);
  const room = creditRoom(plan, 'chat', usage, wallet);
  return {
    wallet: { credits: wallet, available: room.walletLeft, packs: currentGoPacks(),
      fiveHours: { used: walletUsed.fiveHours, limit: room.limit.fiveHours, resetsAt: p.resets.fiveHours.toISOString() },
      week: { used: walletUsed.week, limit: room.limit.week, resetsAt: p.resets.week.toISOString() },
    },
    plan: { id: plan.id, name: plan.name, priceUsd: plan.priceUsd, listPriceUsd: plan.listPriceUsd ?? null, priceRwf: plan.priceRwf, priceNote: plan.priceNote },
    credits: {
      fiveHours: { used: used.fiveHours, limit: L.fiveHours, resetsAt: p.resets.fiveHours.toISOString() },
      day: { used: used.day, limit: L.daily, resetsAt: p.resets.day.toISOString() },
      week: { used: used.week, limit: L.weekly, resetsAt: p.resets.week.toISOString() },
      month: { used: used.month, limit: L.monthly, resetsAt: p.resets.month.toISOString() },
    },
    features: (['tool', 'vision', 'artifact', 'marking'] as const).map((k) => ({ kind: k, label: FEATURE_LABEL[k], used: perDay[k], limit: L.perDay[k] })),
    limits: { maxMessageChars: L.maxMessageChars, maxAttachments: L.maxAttachments, maxUploadMb: L.maxUploadMb, storageMb: L.storageMb, memory: L.memory, memoryItems: L.memoryItems, autonomousMarking: markingEntitled(L) },
    storage: await storageSummary(userId),
    recent: recent.map((r: any) => ({ at: new Date(r.createdAt).toISOString(), kind: r.kind, credits: r.credits, channel: r.channel })),
    upgrade: nextPlan(plan),
    /** The plan suggested next (name, price and monthly credits), for the upgrade note. */
    pro: (() => { const n = PLANS[nextPlan(plan) ?? 'PRO']; return { id: n.id, name: n.name, priceUsd: n.priceUsd, listPriceUsd: n.listPriceUsd ?? null, priceRwf: n.priceRwf ?? 0, daily: n.limits.daily, monthly: n.limits.monthly, memory: n.limits.memory }; })(),
  };
}
