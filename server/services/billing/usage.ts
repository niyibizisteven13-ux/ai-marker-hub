import { randomUUID } from 'node:crypto';
import { prisma } from '../../db.js';
import { PLANS, planFor, toRwf, type PlanId, type PlanInfo, type UsageKind } from './plans.js';

/**
 * Usage metering and plan limits. Every AI action is recorded with its real token usage and priced in
 * credits (1 credit = $0.001 of model cost, at least 1). Before an action, the user's day, ISO week and
 * month totals and the per-feature daily counts are checked against their plan. Periods follow Kigali time.
 */

const db = prisma as any;
const KIGALI_OFFSET_MS = 2 * 3600_000;
const DAY = 86_400_000;
export const USD_PER_CREDIT = 0.001;

/** USD per million tokens [input, output]. Gonka and unknown models use GONKA_PRICE_* (conservative defaults). */
function pricePerMTok(model?: string | null): [number, number] {
  const m = (model ?? '').toLowerCase();
  if (m.includes('haiku')) return [0.10, 0.50];
  if (m.includes('sonnet')) return [2, 10];
  if (m.includes('opus')) return [4, 20];
  if (m.includes('fable') || m.includes('mythos')) return [10, 50];
  const env = (k: string, d: number) => (Number(process.env[k]) >= 0 && process.env[k] ? Number(process.env[k]) : d);
  return [env('GONKA_PRICE_IN_PER_MTOK', 0.10), env('GONKA_PRICE_OUT_PER_MTOK', 0.40)];
}

export function costUsd(model: string | null | undefined, inputTokens: number, outputTokens: number): number {
  const [i, o] = pricePerMTok(model);
  return (Math.max(0, inputTokens) * i + Math.max(0, outputTokens) * o) / 1_000_000;
}

export const creditsFor = (model: string | null | undefined, inputTokens: number, outputTokens: number) =>
  Math.max(1, Math.ceil(costUsd(model, inputTokens, outputTokens) / USD_PER_CREDIT - 1e-9));

/** Start of the current day, ISO week (Monday) and month in Kigali time, and when each resets. */
export function periods(now = Date.now()) {
  const k = new Date(now + KIGALI_OFFSET_MS);
  const day = Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()) - KIGALI_OFFSET_MS;
  const week = day - ((k.getUTCDay() + 6) % 7) * DAY;
  const month = Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), 1) - KIGALI_OFFSET_MS;
  const nextMonth = Date.UTC(k.getUTCFullYear(), k.getUTCMonth() + 1, 1) - KIGALI_OFFSET_MS;
  return { day: new Date(day), week: new Date(week), month: new Date(month), resets: { day: new Date(day + DAY), week: new Date(week + 7 * DAY), month: new Date(nextMonth) } };
}

async function creditsSince(userId: string, since: Date): Promise<number> {
  const r = await db.usageRecord.aggregate({ where: { userId, createdAt: { gte: since } }, _sum: { credits: true } });
  return Number(r?._sum?.credits ?? 0);
}

export async function usedTotals(userId: string, now = Date.now()) {
  const p = periods(now);
  const [day, week, month] = await Promise.all([creditsSince(userId, p.day), creditsSince(userId, p.week), creditsSince(userId, p.month)]);
  const kinds = ['tool', 'vision', 'artifact', 'marking'] as const;
  const counts = await Promise.all(kinds.map((kind) => db.usageRecord.count({ where: { userId, kind, createdAt: { gte: p.day } } })));
  return { p, used: { day, week, month }, perDay: Object.fromEntries(kinds.map((k, i) => [k, Number(counts[i] ?? 0)])) as Record<(typeof kinds)[number], number> };
}

export type LimitCode = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'FEATURE' | 'MESSAGE_TOO_LONG' | 'TOO_MANY_ATTACHMENTS';
export interface GateResult {
  allowed: boolean;
  plan: PlanInfo;
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

function nextPlan(plan: PlanInfo): PlanId | null {
  return plan.id === 'FREE' || plan.id === 'GO' ? 'PRO' : plan.id === 'PRO' ? 'INSTITUTION' : null;
}

function upsell(plan: PlanInfo): string {
  const next = nextPlan(plan);
  if (!next) return 'Contact your administrator to raise the limit.';
  const p = PLANS[next];
  if (next === 'PRO') return `Upgrade to PRO ($${p.priceUsd}/month, about ${toRwf(p.priceUsd!).toLocaleString('en-US')} RWF) for ${p.limits.daily} credits a day and memory across all chats, or top up with GO credits.`;
  return `Institutions get ${p.limits.daily} credits a day per member, from $${p.priceUsd}/month.`;
}

/** Checks the plan limits before an AI action. Totals are compared before the action is charged. */
export async function checkUsage(userId: string, req: { kind: UsageKind; chars?: number; attachments?: number }, now = Date.now()): Promise<GateResult> {
  const plan = await planFor(userId);
  const L = plan.limits;
  const next = nextPlan(plan);
  const deny = (code: LimitCode, message: string, resetsAt?: Date): GateResult => ({
    allowed: false, plan, code, message: `${message} ${upsell(plan)}`, resetsAt: resetsAt?.toISOString(),
    ...(next ? { upgrade: { plan: next, url: '/upgrade?reason=limit' } } : {}),
  });
  if ((req.chars ?? 0) > L.maxMessageChars) return deny('MESSAGE_TOO_LONG', `Your message is ${req.chars!.toLocaleString('en-US')} characters; the ${plan.name} plan allows ${L.maxMessageChars.toLocaleString('en-US')}. Attach long text as a file instead.`);
  if ((req.attachments ?? 0) > L.maxAttachments) return deny('TOO_MANY_ATTACHMENTS', `The ${plan.name} plan allows ${L.maxAttachments} attachments per message.`);
  const { p, used, perDay } = await usedTotals(userId, now);
  if (used.month >= L.monthly) return deny('MONTHLY', `You have used this month's ${L.monthly.toLocaleString('en-US')} credits. They renew ${until(p.resets.month, now)}.`, p.resets.month);
  if (used.week >= L.weekly) return deny('WEEKLY', `You have used this week's ${L.weekly.toLocaleString('en-US')} credits. They renew ${until(p.resets.week, now)}.`, p.resets.week);
  if (used.day >= L.daily) return deny('DAILY', `You have used today's ${L.daily} credits. They renew ${until(p.resets.day, now)} (midnight, Kigali time).`, p.resets.day);
  if (req.kind !== 'chat' && perDay[req.kind] >= L.perDay[req.kind]) return deny('FEATURE', `You have reached today's limit of ${L.perDay[req.kind]} ${FEATURE_LABEL[req.kind]}. Plain chat still works.`, p.resets.day);
  return { allowed: true, plan };
}

/** Records one AI action and returns the credits charged. Never throws: metering must not break a reply. */
export async function recordUsage(userId: string, u: { kind: UsageKind; model?: string | null; inputTokens?: number; outputTokens?: number; channel?: 'web' | 'telegram'; minCredits?: number }): Promise<number> {
  const input = Math.max(0, Math.round(u.inputTokens ?? 0));
  const output = Math.max(0, Math.round(u.outputTokens ?? 0));
  const credits = Math.max(u.minCredits ?? 1, creditsFor(u.model, input, output));
  try {
    await db.usageRecord.create({ data: { id: randomUUID(), userId, kind: u.kind, credits, model: u.model ?? null, inputTokens: input, outputTokens: output, costUsd: costUsd(u.model, input, output), channel: u.channel ?? 'web', createdAt: new Date() } });
  } catch {
    /* metering is best-effort */
  }
  return credits;
}

/** Everything the Usage settings page shows. */
export async function usageSummary(userId: string, now = Date.now()) {
  const plan = await planFor(userId);
  const { p, used, perDay } = await usedTotals(userId, now);
  const recent = await db.usageRecord.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 15 });
  const L = plan.limits;
  return {
    plan: { id: plan.id, name: plan.name, priceUsd: plan.priceUsd, listPriceUsd: plan.listPriceUsd ?? null, priceRwf: plan.priceUsd ? toRwf(plan.priceUsd) : null, priceNote: plan.priceNote },
    credits: {
      day: { used: used.day, limit: L.daily, resetsAt: p.resets.day.toISOString() },
      week: { used: used.week, limit: L.weekly, resetsAt: p.resets.week.toISOString() },
      month: { used: used.month, limit: L.monthly, resetsAt: p.resets.month.toISOString() },
    },
    features: (['tool', 'vision', 'artifact', 'marking'] as const).map((k) => ({ kind: k, label: FEATURE_LABEL[k], used: perDay[k], limit: L.perDay[k] })),
    limits: { maxMessageChars: L.maxMessageChars, maxAttachments: L.maxAttachments, maxUploadMb: L.maxUploadMb, memory: L.memory, memoryItems: L.memoryItems },
    recent: recent.map((r: any) => ({ at: new Date(r.createdAt).toISOString(), kind: r.kind, credits: r.credits, channel: r.channel })),
    upgrade: nextPlan(plan),
    pro: { priceUsd: PLANS.PRO.priceUsd, listPriceUsd: PLANS.PRO.listPriceUsd ?? null, priceRwf: toRwf(PLANS.PRO.priceUsd!), daily: PLANS.PRO.limits.daily },
  };
}
