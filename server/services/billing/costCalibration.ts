import { prisma } from '../../db.js';

/**
 * Cost calibration: makes the platform's own cost figures match what the AI provider really charges.
 *
 * Credits, the profit guard and every margin figure come from a built-in price table ($ per million tokens, by model family). If the
 * provider's real prices differ, every credit is mispriced by the same factor and the profit guard cannot see it. This setting fixes that
 * without a code change:
 *   - `multiplier`: scales every cost (1 = the table is right; 2 = the provider really charges twice the table);
 *   - `prices`: replaces the table price of one model family (haiku, sonnet, opus, fable, other), in USD per million tokens in and out.
 * The admin can type the numbers, or enter the provider's invoice for a month and apply the multiplier that makes the recorded cost match it.
 *
 * Costs already recorded keep the figure they were recorded with; a change applies to new usage from the next minute (cached for 60 s).
 */

export const FAMILIES = ['haiku', 'sonnet', 'opus', 'fable', 'other'] as const;
export type Family = typeof FAMILIES[number];
export interface Price { in: number; out: number }
export interface CostCalibration {
  multiplier: number;
  prices: Partial<Record<Family, Price>>;
  changedAt: string | null;
  changedBy: string | null;
}

export const MIN_MULTIPLIER = 0.1;
export const MAX_MULTIPLIER = 50;
const KEY = 'ai_cost_calibration';
const CACHE_MS = 60_000;
const DEFAULT: CostCalibration = { multiplier: 1, prices: {}, changedAt: null, changedBy: null };

export function familyOf(model?: string | null): Family {
  const m = (model ?? '').toLowerCase();
  if (m.includes('haiku')) return 'haiku';
  if (m.includes('sonnet')) return 'sonnet';
  if (m.includes('opus')) return 'opus';
  if (m.includes('fable') || m.includes('mythos')) return 'fable';
  return 'other';
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

/** Turns anything stored or sent into a safe calibration: a bad number is dropped, never trusted. */
export function cleanCalibration(input: unknown): CostCalibration {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, any>;
  const m = num(raw.multiplier);
  const prices: CostCalibration['prices'] = {};
  for (const f of FAMILIES) {
    const p = raw.prices?.[f];
    const i = num(p?.in), o = num(p?.out);
    if (i !== null && o !== null && i >= 0 && o >= 0 && i <= 1000 && o <= 1000) prices[f] = { in: i, out: o };
  }
  return {
    multiplier: m !== null ? Math.min(MAX_MULTIPLIER, Math.max(MIN_MULTIPLIER, m)) : 1,
    prices,
    changedAt: typeof raw.changedAt === 'string' ? raw.changedAt : null,
    changedBy: typeof raw.changedBy === 'string' ? raw.changedBy : null,
  };
}

let cached: CostCalibration = DEFAULT;
let loadedAt = 0;

/** Puts a calibration into effect now (used after a save, and by tests). */
export function applyCalibration(c: CostCalibration): void { cached = cleanCalibration(c); loadedAt = Date.now(); }

/** The calibration in effect (synchronous: cost is computed all over the code). Refreshed by loadCalibration. */
export const calibration = (): CostCalibration => cached;

export async function loadCalibration(force = false): Promise<CostCalibration> {
  if (!force && Date.now() - loadedAt < CACHE_MS) return cached;
  loadedAt = Date.now();
  const row = await (prisma as any).appSetting.findUnique({ where: { key: KEY } }).catch(() => null);
  cached = cleanCalibration(row?.value);
  return cached;
}

export async function saveCalibration(patch: { multiplier?: number; prices?: Partial<Record<Family, Price | null>> }, adminId: string): Promise<CostCalibration> {
  const cur = await loadCalibration(true);
  const prices: CostCalibration['prices'] = { ...cur.prices };
  for (const [f, p] of Object.entries(patch.prices ?? {})) {
    if (!(FAMILIES as readonly string[]).includes(f)) continue;
    if (p === null) delete prices[f as Family]; else if (p) prices[f as Family] = p;
  }
  const next = cleanCalibration({ multiplier: patch.multiplier ?? cur.multiplier, prices, changedAt: new Date().toISOString(), changedBy: adminId });
  await (prisma as any).appSetting.upsert({ where: { key: KEY }, update: { value: next as any }, create: { key: KEY, value: next as any } });
  applyCalibration(next);
  return next;
}

export interface Suggestion {
  /** The multiplier that would make the recorded cost equal the invoice (clamped to the allowed range). */
  suggested: number;
  /** invoice ÷ recorded: above 1 means the provider charged more than the platform recorded. */
  ratio: number | null;
  /** What to tell the admin, in plain words. */
  message: string;
}

/**
 * Compares the provider's invoice with what the platform recorded for the same period. `currentMultiplier` is the one the recorded
 * costs were made with, so the suggestion replaces it instead of compounding on it. Overhead the invoice includes (searches, retries, failed
 * calls) ends up in the multiplier, which is the point: it is the real cost per recorded credit.
 */
export function suggestMultiplier(o: { invoiceUsd: number; recordedUsd: number; currentMultiplier: number }): Suggestion {
  if (!(o.invoiceUsd > 0)) return { suggested: o.currentMultiplier, ratio: null, message: 'Enter the amount on the provider invoice.' };
  if (!(o.recordedUsd > 0)) return { suggested: o.currentMultiplier, ratio: null, message: 'No usage was recorded for that period, so there is nothing to compare.' };
  const ratio = o.invoiceUsd / o.recordedUsd;
  const raw = o.currentMultiplier * ratio;
  const suggested = Math.min(MAX_MULTIPLIER, Math.max(MIN_MULTIPLIER, Math.round(raw * 1000) / 1000));
  const off = Math.abs(ratio - 1);
  const message = off < 0.05 ? `Recorded cost is within 5% of the invoice (${ratio.toFixed(2)}×). No change needed.`
    : ratio > 1 ? `The provider charged ${ratio.toFixed(2)}× what was recorded. Credits are under-priced by that much. Setting the multiplier to ${suggested} makes new usage match.`
      : `The provider charged ${ratio.toFixed(2)}× what was recorded: credits are over-priced, so users are being limited more than needed. Setting the multiplier to ${suggested} makes new usage match.`;
  return { suggested, ratio: Math.round(ratio * 1000) / 1000, message: raw !== suggested ? `${message} (Limited to the allowed range ${MIN_MULTIPLIER}–${MAX_MULTIPLIER}.)` : message };
}
