import { prisma } from '../../db.js';

/**
 * Plans and their limits. Credits measure real AI cost: 1 credit = $0.001 of model spend, at least 1 per
 * action, so limits protect margins whatever mix of cheap chat and heavier tool/vision work a user does.
 * Prices are shown in USD with the Rwandan franc equivalent (FX_USD_RWF).
 */

export type PlanId = 'FREE' | 'GO' | 'PRO' | 'INSTITUTION';
export type UsageKind = 'chat' | 'tool' | 'vision' | 'artifact' | 'marking';

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
  /** Cross-chat memory: available on this plan, and how many memories it keeps. */
  memory: boolean;
  memoryItems: number;
}

export interface PlanInfo {
  id: PlanId;
  name: string;
  priceUsd: number | null;
  /** Original price shown struck through next to a launch discount. */
  listPriceUsd?: number;
  priceNote: string;
  limits: PlanLimits;
}

export const PLANS: Record<PlanId, PlanInfo> = {
  FREE: {
    id: 'FREE', name: 'Free', priceUsd: 0, priceNote: 'Free forever',
    limits: { daily: 20, weekly: 80, monthly: 250, perDay: { tool: 5, vision: 5, artifact: 2, marking: 3 }, maxMessageChars: 8_000, maxAttachments: 2, maxUploadMb: 10, memory: false, memoryItems: 0 },
  },
  // GO = the Free allowance plus purchased credits: once the allowance or a daily feature cap is used up,
  // further actions are paid from the credit wallet instead of being refused.
  GO: {
    id: 'GO', name: 'GO', priceUsd: null, priceNote: 'Pay as you go, from 500 RWF',
    limits: { daily: 20, weekly: 80, monthly: 250, perDay: { tool: 5, vision: 5, artifact: 2, marking: 3 }, maxMessageChars: 20_000, maxAttachments: 5, maxUploadMb: 25, memory: false, memoryItems: 0 },
  },
  PRO: {
    id: 'PRO', name: 'PRO', priceUsd: 3, listPriceUsd: 9, priceNote: 'per month',
    limits: { daily: 120, weekly: 500, monthly: 1_000, perDay: { tool: 60, vision: 100, artifact: 25, marking: 60 }, maxMessageChars: 40_000, maxAttachments: 10, maxUploadMb: 50, memory: true, memoryItems: 2_000 },
  },
  INSTITUTION: {
    id: 'INSTITUTION', name: 'Institution', priceUsd: 50, priceNote: 'per month and up, 25 seats',
    limits: { daily: 400, weekly: 1_800, monthly: 5_000, perDay: { tool: 200, vision: 300, artifact: 80, marking: 300 }, maxMessageChars: 60_000, maxAttachments: 20, maxUploadMb: 100, memory: true, memoryItems: 10_000 },
  },
};

export interface GoPack { id: string; rwf: number; credits: number }
export const DEFAULT_GO_PACKS: GoPack[] = [
  { id: 'go-500', rwf: 500, credits: 100 },
  { id: 'go-1000', rwf: 1_000, credits: 220 },
  { id: 'go-2500', rwf: 2_500, credits: 600 },
  { id: 'go-5000', rwf: 5_000, credits: 1_300 },
];

/** Admin-editable billing settings (AppSetting "billing"), applied over the defaults above. */
export interface BillingSettings {
  fxUsdRwf?: number;
  pro?: { priceUsd?: number; listPriceUsd?: number | null };
  institution?: { priceUsd?: number };
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
  settings = next ?? {};
  for (const id of Object.keys(DEFAULTS) as PlanId[]) {
    const base = JSON.parse(JSON.stringify(DEFAULTS[id])) as PlanInfo;
    const o = settings.limits?.[id];
    if (o) base.limits = { ...base.limits, ...o, perDay: { ...base.limits.perDay, ...(o.perDay ?? {}) } } as PlanLimits;
    Object.assign(PLANS[id], base);
  }
  if (settings.pro?.priceUsd != null) PLANS.PRO.priceUsd = settings.pro.priceUsd;
  if (settings.pro && 'listPriceUsd' in settings.pro) PLANS.PRO.listPriceUsd = settings.pro.listPriceUsd ?? undefined;
  if (settings.institution?.priceUsd != null) PLANS.INSTITUTION.priceUsd = settings.institution.priceUsd;
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
  const fromSub: PlanId | null = !active ? null
    : sub.planType === 'ORGANIZATION' || sub.planType === 'INSTITUTION' ? 'INSTITUTION'
      : sub.planType === 'PRO' || sub.planType === 'BUSINESS' ? 'PRO'
        : sub.planType === 'GO' ? 'GO' : null;
  // Admins always keep Institution limits, even after buying or being granted a smaller plan.
  if (user?.role === 'ADMIN') return PLANS.INSTITUTION;
  if (fromSub) return PLANS[fromSub];
  return (await walletBalance(userId)) > 0 ? PLANS.GO : PLANS.FREE;
}
