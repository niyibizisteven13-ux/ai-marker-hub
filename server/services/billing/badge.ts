import { prisma } from '../../db.js';

/**
 * The verified badge: a one-time payment (1,000 RWF) that puts a check mark next to the owner's name on their business pages and in their profile.
 * It belongs to the person, not to one page, never expires, and is granted by the same checkout and manual approval as every other purchase
 * (purpose VERIFIED_BADGE). It says "this owner paid and is a real, reachable person"; it is not an endorsement of the business.
 */
export const VERIFIED_BADGE_RWF = 1000;
const db = prisma as any;
export const badgeKey = (userId: string) => `verified-badge:${userId}`;

const cache = new Map<string, { at: number; v: boolean }>();
const TTL = 60_000;
export async function hasBadge(userId: string): Promise<boolean> {
  const hit = cache.get(userId); if (hit && Date.now() - hit.at < TTL) return hit.v;
  const v = !!(await db.appSetting.findUnique({ where: { key: badgeKey(userId) } }).catch(() => null))?.value?.active;
  cache.set(userId, { at: Date.now(), v }); if (cache.size > 5000) cache.clear(); return v;
}
export const forgetBadge = (userId: string) => { cache.delete(userId); };

/** Used inside the payment transaction (`tx`), so the badge and the payment are recorded together or not at all. */
export async function grantBadgeIn(tx: any, userId: string, paymentId: string | null, by: string, now: Date) {
  const value = { active: true, at: now.toISOString(), paymentId, by };
  await tx.appSetting.upsert({ where: { key: badgeKey(userId) }, create: { key: badgeKey(userId), value, updatedBy: by }, update: { value, updatedBy: by } });
}
export async function setBadge(userId: string, active: boolean, by: string) {
  const now = new Date();
  if (active) await grantBadgeIn(db, userId, null, by, now);
  else await db.appSetting.upsert({ where: { key: badgeKey(userId) }, create: { key: badgeKey(userId), value: { active: false, at: now.toISOString(), by }, updatedBy: by }, update: { value: { active: false, at: now.toISOString(), by }, updatedBy: by } });
  forgetBadge(userId);
}
