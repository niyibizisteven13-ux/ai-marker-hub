import crypto from 'node:crypto';
import { prisma } from '../db.js';
import { APPS, PLATFORMS, summary, type App, type Platform } from './appDownloads.js';

/**
 * Ratings and the short survey on the "Get the app" page. Anyone can send one (no account needed), so it is protected: a honeypot field, a limit per
 * visitor, one rating per visitor per app per day, short fields, and no IP address is ever stored. Stored in AppSetting:
 *   app-rating:<app>   -> { count, sum, hist: [n1..n5] }   never trimmed: the public average
 *   app-feedback       -> { items: [...] }                 the latest 500 answers, for the administrator
 * The public sees only the average, the number of ratings and the number of downloads. Comments and contact details are for the administrator.
 */
const db = prisma as any;
export const EASE = ['very_easy', 'easy', 'hard', 'failed'] as const;
export const USES = ['marking', 'quizzes', 'exams', 'studying', 'other'] as const;
export type Ease = (typeof EASE)[number]; export type Use = (typeof USES)[number];
const KEEP = 500;

export interface FeedbackInput { app: App; rating: number; platform?: Platform; ease?: Ease; use?: Use; improve?: string; contact?: string; contactOk?: boolean }
export interface FeedbackItem extends Required<Pick<FeedbackInput, 'app' | 'rating'>> { id: string; at: string; platform?: Platform; ease?: Ease; use?: Use; improve?: string; contact?: string; contactOk?: boolean }
export class FeedbackError extends Error { constructor(message: string, public status = 400) { super(message); } }

const clean = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | undefined => (list as readonly string[]).includes(String(v)) ? (String(v) as T) : undefined;

/** Checks and tidies what a visitor sent. Pure. */
export function validateFeedback(body: any): FeedbackInput {
  const app = oneOf(APPS, body?.app); if (!app) throw new FeedbackError('Choose which app you are rating.');
  const rating = Number(body?.rating); if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new FeedbackError('Choose 1 to 5 stars.');
  const improve = clean(body?.improve, 1000), contact = clean(body?.contact, 120);
  const out: FeedbackInput = { app, rating };
  const platform = oneOf(PLATFORMS, body?.platform), ease = oneOf(EASE, body?.ease), use = oneOf(USES, body?.use);
  if (platform) out.platform = platform; if (ease) out.ease = ease; if (use) out.use = use;
  if (improve) out.improve = improve;
  if (contact) { out.contact = contact; out.contactOk = body?.contactOk === true; }
  return out;
}

/* ------------------------------------------------------------ storage */
async function getKv<T>(key: string): Promise<T | null> { const r = await db.appSetting.findUnique({ where: { key } }).catch(() => null); return r?.value && typeof r.value === 'object' ? (r.value as T) : null; }
async function putKv(key: string, value: unknown, now: Date) {
  const ex = await db.appSetting.findUnique({ where: { key } }).catch(() => null);
  if (ex) await db.appSetting.update({ where: { key }, data: { value, updatedBy: 'feedback', updatedAt: now } });
  else await db.appSetting.create({ data: { key, value, updatedBy: 'feedback', updatedAt: now } });
}
interface Rating { count: number; sum: number; hist: number[] }
const emptyRating = (): Rating => ({ count: 0, sum: 0, hist: [0, 0, 0, 0, 0] });
const getRating = async (app: App): Promise<Rating> => { const r = await getKv<Rating>(`app-rating:${app}`); return r && Array.isArray(r.hist) && r.hist.length === 5 ? { count: Number(r.count) || 0, sum: Number(r.sum) || 0, hist: r.hist.map(Number) } : emptyRating(); };

/* ------------------------------------------------------------ one answer per visitor per app per day */
const seen = new Map<string, number>(); const attempts = new Map<string, number[]>();
const DAY = 86_400_000;
export const visitorKey = (ip: string, ua: string) => crypto.createHash('sha256').update(`${ip}|${ua}`).digest('hex').slice(0, 24);   // only a hash, and only in memory
export function tooMany(visitor: string, now = Date.now()): boolean {
  const recent = (attempts.get(visitor) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= 6) { attempts.set(visitor, recent); return true; }
  attempts.set(visitor, [...recent, now]); if (attempts.size > 5000) attempts.clear(); return false;
}
export function alreadyRated(visitor: string, app: App, now = Date.now()): boolean {
  const k = `${visitor}|${app}`; if (seen.size > 5000) for (const [kk, t] of seen) if (now - t > DAY) seen.delete(kk);
  if (now - (seen.get(k) ?? 0) < DAY) return true; return false;
}
const markRated = (visitor: string, app: App, now: number) => seen.set(`${visitor}|${app}`, now);
export const resetLimitsForTests = () => { seen.clear(); attempts.clear(); };

/** Saves one answer. `honeypot` is a hidden field real people never fill: a robot that did gets a normal "thanks" and nothing is saved. */
export async function submitFeedback(body: any, visitor: string, now = Date.now()): Promise<{ saved: boolean }> {
  if (clean(body?.website, 50)) return { saved: false };
  if (tooMany(visitor, now)) throw new FeedbackError('Too many attempts. Please try again later.', 429);
  const input = validateFeedback(body);
  if (alreadyRated(visitor, input.app, now)) throw new FeedbackError('Thank you, you already sent feedback today.', 429);
  const at = new Date(now);
  const r = await getRating(input.app); r.count += 1; r.sum += input.rating; r.hist[input.rating - 1] += 1;
  await putKv(`app-rating:${input.app}`, r, at);
  const list = (await getKv<{ items: FeedbackItem[] }>('app-feedback'))?.items ?? [];
  list.unshift({ id: crypto.randomUUID(), at: at.toISOString(), ...input });
  await putKv('app-feedback', { items: list.slice(0, KEEP) }, at);
  markRated(visitor, input.app, now);
  return { saved: true };
}

/* ------------------------------------------------------------ what people see */
export interface PublicStats { apps: Record<App, { downloads: number; installs: number; rating: { average: number | null; count: number } }> }
const round1 = (n: number) => Math.round(n * 10) / 10;
/** Public numbers: downloads, installs, and the average rating. Nothing else. */
export async function publicStats(now = Date.now()): Promise<PublicStats> {
  const s = await summary(now);
  const out = {} as PublicStats['apps'];
  for (const app of APPS) {
    const rows = s.rows.filter((r) => r.app === app); const r = await getRating(app);
    out[app] = { downloads: rows.reduce((a, x) => a + x.click, 0), installs: rows.reduce((a, x) => a + x.installed, 0), rating: { average: r.count ? round1(r.sum / r.count) : null, count: r.count } };
  }
  return { apps: out };
}

export interface AdminFeedback { ratings: Record<App, { count: number; average: number | null; hist: number[] }>; items: FeedbackItem[] }
export async function adminFeedback(): Promise<AdminFeedback> {
  const ratings = {} as AdminFeedback['ratings'];
  for (const app of APPS) { const r = await getRating(app); ratings[app] = { count: r.count, average: r.count ? round1(r.sum / r.count) : null, hist: r.hist }; }
  return { ratings, items: (await getKv<{ items: FeedbackItem[] }>('app-feedback'))?.items ?? [] };
}

const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"`;     // no spreadsheet formulas from visitors
export function feedbackCsv(items: FeedbackItem[]): string {
  const head = ['Date', 'App', 'Device', 'Stars', 'Install', 'Used for', 'What to improve', 'Contact', 'May contact'];
  return '﻿' + [head.map(cell).join(','), ...items.map((i) => [i.at.slice(0, 16).replace('T', ' '), i.app, i.platform ?? '', i.rating, i.ease ?? '', i.use ?? '', i.improve ?? '', i.contact ?? '', i.contact ? (i.contactOk ? 'yes' : 'no') : ''].map(cell).join(','))].join('\r\n');
}
