import { prisma } from '../../db.js';

/**
 * The admin "Pause upgrades" switch: while paused, nobody can start buying a plan or a top-up. Payments already
 * started still finish, current plans keep working, and admins can still give a plan by hand.
 */

export interface SalesState { paused: boolean; message: string | null; pausedAt: string | null; pausedBy: string | null }

const KEY = 'billing-sales';
const db = prisma as any;
export const DEFAULT_PAUSE_MESSAGE = 'Upgrades are paused for a short while. Your current plan keeps working. Please check back soon.';
let cached: { at: number; state: SalesState } | null = null;

export async function salesState(force = false): Promise<SalesState> {
  if (!force && cached && Date.now() - cached.at < 15_000) return cached.state;
  const row = await db.appSetting.findUnique({ where: { key: KEY } }).catch(() => null);
  const v = (row?.value && typeof row.value === 'object' ? row.value : {}) as Partial<SalesState>;
  const state: SalesState = { paused: v.paused === true, message: v.message?.trim() || null, pausedAt: v.pausedAt ?? null, pausedBy: v.pausedBy ?? null };
  cached = { at: Date.now(), state };
  return state;
}

export async function setSalesPaused(paused: boolean, adminId: string, message?: string | null): Promise<SalesState> {
  const value: SalesState = { paused, message: paused ? (message?.trim().slice(0, 300) || null) : null, pausedAt: paused ? new Date().toISOString() : null, pausedBy: paused ? adminId : null };
  const existing = await db.appSetting.findUnique({ where: { key: KEY } }).catch(() => null);
  if (existing) await db.appSetting.update({ where: { key: KEY }, data: { value, updatedBy: adminId, updatedAt: new Date() } });
  else await db.appSetting.create({ data: { key: KEY, value, updatedBy: adminId, updatedAt: new Date() } });
  cached = null;
  return salesState(true);
}

/** What buyers are told while upgrades are paused. */
export const pauseMessage = (s: SalesState) => s.message || DEFAULT_PAUSE_MESSAGE;
