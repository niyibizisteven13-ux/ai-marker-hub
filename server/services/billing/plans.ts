import { prisma } from '../../db.js';

/**
 * Plans and their limits. Credits measure real AI cost: 1 credit = $0.001 of model spend, at least 1 per
 * action, so limits protect margins whatever mix of cheap chat and heavier tool/vision work a user does.
 * Prices are shown in USD with the Rwandan franc equivalent (FX_USD_RWF).
 */

export type PlanId = 'FREE' | 'GO' | 'STARTER' | 'PRO' | 'PLUS' | 'INSTITUTION';
export type UsageKind = 'chat' | 'tool' | 'vision' | 'artifact' | 'marking';
/** Plans sold online, cheapest first. INSTITUTION is kept for existing subscribers and admins only. */
export const SOLD_PLANS = ['STARTER', 'PRO', 'PLUS'] as const;
export type SoldPlanId = (typeof SOLD_PLANS)[number];

export interface PlanLimits {
  /** Credits per calendar day, ISO week (Monday) and calendar month, in Kigali time. */
  daily: number;
  weekly: number;
  monthly: number;
  /** Actions per day for the expensive features. */
  perDay: Record<Exclude<UsageKind, 'chat'>, number>;
  /** Longest message (characters) and attachments per message. */
  maxMessageChars: number;
  maxAttachments: number;
  maxUploadMb: number;
  /** Storage kept for the user's files: chat uploads, task files and the work students hand in (MB). */
  storageMb: number;
  /** Cross-chat memory: available on this plan, and how many memories it keeps. */
  memory: boolean;
  memoryItems: number;
  /** Autonomous handwriting marking (exams, red-pen PDFs, reports). Admin-editable per plan. */
  autonomousMarking: boolean;
}

export interface PlanInfo {
  id: PlanId;
  name: string;
  /** The price charged, in RWF per month (Mobile Money). null = not sold for a fixed monthly price. */
  priceRwf: number | null;
  /** USD equivalent of priceRwf, for display only (derived from the exchange rate). */
  priceUsd: number | null;
  /** Original price shown struck through next to a launch discount. */
  listPriceUsd?: number;
  priceNote: string;
  limits: PlanLimits;
}

// Paid plans keep high daily caps (a whole class can be marked in one evening); the monthly credits are the
// cost control. 1 credit ≈ $0.001 of model spend, so 1,700 credits ≈ 120 Haiku-marked scripts plus chat.
export const PLANS: Record<PlanId, PlanInfo> = {
  FREE: {
    id: 'FREE', name: 'Free', priceRwf: 0, priceUsd: 0, priceNote: 'Free forever',
    limits: { daily: 15, weekly: 40, monthly: 50, perDay: { tool: 3, vision: 3, artifact: 1, marking: 0 }, maxMessageChars: 8_000, maxAttachments: 2, maxUploadMb: 100, storageMb: 200, memory: false, memoryItems: 0, autonomousMarking: false },
  },
  // GO = the Free allowance plus purchased credits: once the allowance or a daily feature cap is used up,
  // further actions are paid from the credit wallet instead of being refused.
  GO: {
    id: 'GO', name: 'Top-up', priceRwf: null, priceUsd: null, priceNote: 'Pay as you go, from 500 RWF',
    limits: { daily: 15, weekly: 40, monthly: 50, perDay: { tool: 3, vision: 3, artifact: 1, marking: 0 }, maxMessageChars: 20_000, maxAttachments: 5, maxUploadMb: 100, storageMb: 500, memory: false, memoryItems: 0, autonomousMarking: true },
  },
  STARTER: {
    id: 'STARTER', name: 'Starter', priceRwf: 1_500, priceUsd: 1, priceNote: 'per month',
    limits: { daily: 400, weekly: 400, monthly: 400, perDay: { tool: 60, vision: 100, artifact: 15, marking: 60 }, maxMessageChars: 20_000, maxAttachments: 10, maxUploadMb: 100, storageMb: 2_048, memory: false, memoryItems: 0, autonomousMarking: true },
  },
  PRO: {
    id: 'PRO', name: 'Pro', priceRwf: 4_500, priceUsd: 3, priceNote: 'per month',
    limits: { daily: 1_700, weekly: 1_700, monthly: 1_700, perDay: { tool: 200, vision: 300, artifact: 40, marking: 200 }, maxMessageChars: 40_000, maxAttachments: 20, maxUploadMb: 100, storageMb: 10_240, memory: true, memoryItems: 2_000, autonomousMarking: true },
  },
  PLUS: {
    id: 'PLUS', name: 'Pro Plus', priceRwf: 7_000, priceUsd: 4.75, priceNote: 'per month',
    limits: { daily: 2_800, weekly: 2_800, monthly: 2_800, perDay: { tool: 300, vision: 500, artifact: 60, marking: 400 }, maxMessageChars: 60_000, maxAttachments: 20, maxUploadMb: 200, storageMb: 25_600, memory: true, memoryItems: 5_000, autonomousMarking: true },
  },
  INSTITUTION: {
    id: 'INSTITUTION', name: 'Institution', priceRwf: null, priceUsd: null, priceNote: 'by arrangement',
    limits: { daily: 2_800, weekly: 2_800, monthly: 2_800, perDay: { tool: 300, vision: 500, artifact: 80, marking: 400 }, maxMessageChars: 60_000, maxAttachments: 20, maxUploadMb: 200, storageMb: 51_200, memory: true, memoryItems: 10_000, autonomousMarking: true },
  },
};

/** Largest single upload the server accepts for any plan (CHAT_MAX_FILE_MB, default 200 MB). */
export const UPLOAD_CEILING_BYTES = (Number(process.env.CHAT_MAX_FILE_MB) > 0 ? Number(process.env.CHAT_MAX_FILE_MB) : 200) * 1024 * 1024;

/** Largest single file this user's plan may upload (Pro Plus and Institution: 200 MB; other plans: 100 MB). */
export async function uploadLimitBytes(userId: string): Promise<{ bytes: number; plan: PlanInfo }> {
  const plan = await planFor(userId).catch(() => PLANS.FREE);
  return { bytes: Math.min(UPLOAD_CEILING_BYTES, Math.max(1, plan.limits.maxUploadMb) * 1024 * 1024), plan };
}

/** The message for a file over the plan's limit, pointing to the plan that allows it. */
export function uploadTooLargeMessage(name: string, plan: PlanInfo, limitBytes: number): string {
  const mb = Math.round(limitBytes / 1048576);
  const bigger = (['PLUS', 'INSTITUTION'] as PlanId[]).includes(plan.id) ? '' : ' Pro Plus uploads files up to 200 MB.';
  return `${name} is larger than ${mb} MB, the largest file your ${plan.name} plan can upload.${bigger}`;
}

/** Maps a stored Subscription.planType to a plan (older rows say ORGANIZATION / BUSINESS). */
export function planIdForSubscription(planType: string | null | undefined): PlanId | null {
  switch (planType) {
    case 'ORGANIZATION': case 'INSTITUTION': return 'INSTITUTION';
    case 'PRO': case 'BUSINESS': return 'PRO';
    case 'STARTER': return 'STARTER';
    case 'PLUS': return 'PLUS';
    case 'GO': return 'GO';
    default: return null;
  }
}
/** Subscription.planType stored for a plan. */
export const subscriptionTypeFor = (id: PlanId) => (id === 'INSTITUTION' ? 'ORGANIZATION' : id);

export interface GoPack { id: string; rwf: number; credits: number }
// About 2.3 RWF per credit: dearer than a plan's credits, so a plan stays the better deal for regular use.
export const DEFAULT_GO_PACKS: GoPack[] = [
  { id: 'go-500', rwf: 500, credits: 215 },
  { id: 'go-1000', rwf: 1_000, credits: 430 },
  { id: 'go-2500', rwf: 2_500, credits: 1_080 },
  { id: 'go-5000', rwf: 5_000, credits: 2_170 },
];

/** Admin-editable billing settings (AppSetting "billing"), applied over the defaults above. */
export interface BillingSettings {
  /** 2 = saved for the Starter / Pro / Pro Plus price list. Older saves keep only the exchange rate. */
  schema?: number;
  fxUsdRwf?: number;
  /** Monthly price in RWF per plan sold online. */
  prices?: Partial<Record<SoldPlanId, { priceRwf?: number }>>;
  goPacks?: GoPack[];
  limits?: Partial<Record<PlanId, Partial<Omit<PlanLimits, 'perDay'>> & { perDay?: Partial<PlanLimits['perDay']> }>>;
}

const DEFAULTS: Record<PlanId, PlanInfo> = JSON.parse(JSON.stringify(PLANS));
let settings: BillingSettings = {};
let goPacks: GoPack[] = DEFAULT_GO_PACKS;
let loadedAt = 0;

/** Re-reads the admin settings (cached for a minute) and applies them to PLANS in place. */
export async function refreshBillingSettings(force = false): Promise<BillingSettings> {
  if (!force && Date.now() - loadedAt < 60_000) return settings;
  loadedAt = Date.now();
  const row = await (prisma as any).appSetting.findUnique({ where: { key: 'billing' } }).catch(() => null);
  applyBillingSettings((row?.value && typeof row.value === 'object' ? row.value : {}) as BillingSettings);
  return settings;
}

export function applyBillingSettings(next: BillingSettings) {
  next = next ?? {};
  // Prices, packs and limits saved before the new price list would otherwise override it.
  settings = (next.schema ?? 1) >= 2 ? next : { fxUsdRwf: next.fxUsdRwf };
  for (const id of Object.keys(DEFAULTS) as PlanId[]) {
    const base = JSON.parse(JSON.stringify(DEFAULTS[id])) as PlanInfo;
    const o = settings.limits?.[id];
    if (o) base.limits = { ...base.limits, ...o, perDay: { ...base.limits.perDay, ...(o.perDay ?? {}) } } as PlanLimits;
    Object.assign(PLANS[id], base);
  }
  for (const id of SOLD_PLANS) {
    const rwf = settings.prices?.[id]?.priceRwf;
    if (rwf && rwf > 0) PLANS[id].priceRwf = Math.round(rwf);
    PLANS[id].priceUsd = Math.round(((PLANS[id].priceRwf ?? 0) / fxUsdRwf()) * 100) / 100;
  }
  goPacks = settings.goPacks?.length ? settings.goPacks : DEFAULT_GO_PACKS;
}

export const currentGoPacks = () => goPacks;
export const fxUsdRwf = () => settings.fxUsdRwf && settings.fxUsdRwf > 0 ? settings.fxUsdRwf : Number(process.env.FX_USD_RWF) > 0 ? Number(process.env.FX_USD_RWF) : 1470;
/** RWF equivalent rounded to a friendly amount (nearest 100). */
export const toRwf = (usd: number) => Math.round((usd * fxUsdRwf()) / 100) * 100;

const db = prisma as any;

/** GO credit balance: purchases and adjustments minus usage paid from the wallet. */
export async function walletBalance(userId: string): Promise<number> {
  const r = await (prisma as any).creditLedger.aggregate({ where: { userId }, _sum: { delta: true } }).catch(() => null);
  return Math.max(0, Number(r?._sum?.delta ?? 0));
}

/**
 * The user's effective plan: an active, unexpired subscription; else GO when they hold purchased credits;
 * else Free. Admins always get Institution limits.
 */
export async function planFor(userId: string): Promise<PlanInfo> {
  await refreshBillingSettings();
  const [user, sub] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { role: true } }).catch(() => null),
    db.subscription.findUnique({ where: { userId } }).catch(() => null),
  ]);
  const active = sub && sub.status === 'ACTIVE' && (!sub.endDate || new Date(sub.endDate).getTime() > Date.now());
  const fromSub = active ? planIdForSubscription(sub.planType) : null;
  // Admins always keep Institution limits, even after buying or being granted a smaller plan.
  if (user?.role === 'ADMIN') return PLANS.INSTITUTION;
  if (fromSub) return PLANS[fromSub];
  return (await walletBalance(userId)) > 0 ? PLANS.GO : PLANS.FREE;
}
