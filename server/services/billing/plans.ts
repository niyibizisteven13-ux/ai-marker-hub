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
  GO: {
    id: 'GO', name: 'GO', priceUsd: null, priceNote: 'Pay as you go, from 500 RWF',
    limits: { daily: 60, weekly: 300, monthly: 1_000, perDay: { tool: 20, vision: 30, artifact: 8, marking: 15 }, maxMessageChars: 20_000, maxAttachments: 5, maxUploadMb: 25, memory: false, memoryItems: 0 },
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

export const fxUsdRwf = () => Number(process.env.FX_USD_RWF) > 0 ? Number(process.env.FX_USD_RWF) : 1470;
/** RWF equivalent rounded to a friendly amount (nearest 100). */
export const toRwf = (usd: number) => Math.round((usd * fxUsdRwf()) / 100) * 100;

const db = prisma as any;

/** The user's effective plan: an active, unexpired subscription, else Free. Admins get Institution limits. */
export async function planFor(userId: string): Promise<PlanInfo> {
  const [user, sub] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { role: true } }).catch(() => null),
    db.subscription.findUnique({ where: { userId } }).catch(() => null),
  ]);
  const active = sub && sub.status === 'ACTIVE' && (!sub.endDate || new Date(sub.endDate).getTime() > Date.now());
  const fromSub: PlanId | null = !active ? null
    : sub.planType === 'ORGANIZATION' || sub.planType === 'INSTITUTION' ? 'INSTITUTION'
      : sub.planType === 'PRO' || sub.planType === 'BUSINESS' ? 'PRO'
        : sub.planType === 'GO' ? 'GO' : null;
  if (fromSub) return PLANS[fromSub];
  return user?.role === 'ADMIN' ? PLANS.INSTITUTION : PLANS.FREE;
}
