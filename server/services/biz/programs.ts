import { randomBytes, createHash } from 'node:crypto';
import { DAYS, clean, cleanPhone, oneOf, type Day } from './model.js';

/**
 * Programs: a business sells a plan once (for example 40,000 RWF for a month of lunches at a restaurant by the university), customers join
 * from a shared link and pay, and from then on each person shows a pass (a QR code on their phone) at the counter. The owner scans it and
 * the system says whether this person may be served now, and records the meal.
 *
 * Pure rules live here (no storage, no clock of their own) so they are tested without a server. Dates are Kigali dates ("YYYY-MM-DD").
 * See service.ts for the storage and the public/owner boundary: a pass token is a secret only its holder has; the owner reaches a member by
 * the short code or the scan.
 */

export const MAX_PROGRAMS = 20;
export const MAX_MEMBERS = 3000;
export const MAX_PROGRAM_DAYS = 366;
export type MemberStatus = 'pending' | 'active' | 'paused' | 'cancelled';

export interface MealWindow { meal: string; from: string; to: string }
export interface Program {
  id: string; title: string; description?: string;
  /** What a customer pays once, in RWF. */
  priceRwf: number;
  /** How many calendar days the plan lasts from its start day (30 = a month). */
  days: number;
  /** The meals served each day, in order (for example ["Lunch"] or ["Breakfast", "Lunch"]). One of each per person per day. */
  meals: string[];
  /** Days of the week the restaurant serves. A closed day neither serves nor counts as a missed meal. */
  openDays: Day[];
  /** Optional serving times. Without them a meal can be served at any time. */
  windows?: MealWindow[];
  /** A short rule shown to the customer ("Show your pass at the counter; one lunch a day"). */
  terms?: string;
  maxMembers?: number;
  active: boolean;
  createdAt: string;
}
export interface Member {
  id: string; programId: string; name: string; phone: string; studentId?: string;
  /** What the owner types or reads out when the camera is not handy: XXXX-XXXX. */
  code: string;
  /** Only a hash of the pass token is kept: the token itself is in the customer's link and QR code. */
  passHash: string;
  status: MemberStatus;
  startDate: string; endDate: string;
  paidRwf: number; paid: boolean;
  payMethod?: 'momo_prompt' | 'momo_manual' | 'cash';
  /** The online payment (a ledger entry id) while a prompt is waiting. */
  payRef?: string;
  /** The customer says they paid by hand; the owner confirms. */
  claimed?: { at: string; ref?: string };
  confirmedAt?: string;
  /** Days the owner added (for example after a closure). */
  extraDays?: number;
  note?: string;
  createdAt: string;
}
export interface Meal { id: string; memberId: string; date: string; meal: string; at: string; by: 'scan' | 'code'; undone?: boolean }

/* ---------------------------------------------------------------- dates (Kigali, UTC+2) */
const KIGALI_MS = 2 * 3600_000;
export const kigaliDate = (t: number) => new Date(t + KIGALI_MS).toISOString().slice(0, 10);
export const kigaliMinutes = (t: number) => { const k = new Date(t + KIGALI_MS); return k.getUTCHours() * 60 + k.getUTCMinutes(); };
export const dayOfWeek = (date: string): Day => DAYS[(new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7];
export const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`));
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const mins = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

/** The last day a plan can be used: start + days − 1 (a 30-day plan starting on the 1st ends on the 30th), plus any days the owner added. */
export const endDateFor = (start: string, days: number, extra = 0) => addDays(start, Math.max(1, days) - 1 + Math.max(0, extra));

/* ---------------------------------------------------------------- cleaning */
export function cleanProgram(input: any, id: string, now: string, prev?: Program): Program | { error: string } {
  const title = clean(input?.title ?? prev?.title, 60); if (!title) return { error: 'A program needs a name, for example "Lunch plan".' };
  const price = Math.round(Number(String(input?.priceRwf ?? prev?.priceRwf ?? '').replace(/[,\s]/g, '')));
  if (!Number.isFinite(price) || price < 100 || price > 5_000_000) return { error: 'The price must be between 100 and 5,000,000 RWF.' };
  const days = Math.round(Number(input?.days ?? prev?.days ?? 30));
  if (!Number.isFinite(days) || days < 1 || days > MAX_PROGRAM_DAYS) return { error: `The plan must last between 1 and ${MAX_PROGRAM_DAYS} days.` };
  const rawMeals: unknown[] = Array.isArray(input?.meals) ? input.meals : prev?.meals ?? ['Lunch'];
  const meals = [...new Set(rawMeals.map((m) => clean(m, 24)).filter(Boolean))].slice(0, 4); if (!meals.length) return { error: 'Add at least one meal, for example "Lunch".' };
  const rawDays: unknown[] = Array.isArray(input?.openDays) ? input.openDays : prev?.openDays ?? ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const openDays = DAYS.filter((d) => rawDays.includes(d)); if (!openDays.length) return { error: 'Choose at least one day the restaurant serves.' };
  let windows: MealWindow[] | undefined;
  if (input?.windows !== undefined || prev?.windows) {
    const w: unknown[] = Array.isArray(input?.windows) ? input.windows : input?.windows === undefined ? prev?.windows ?? [] : [];
    windows = w.map((x: any) => ({ meal: clean(x?.meal, 24), from: String(x?.from ?? ''), to: String(x?.to ?? '') })).filter((x) => meals.includes(x.meal) && HHMM.test(x.from) && HHMM.test(x.to) && mins(x.to) > mins(x.from));
    if (!windows.length) windows = undefined;
  }
  const p: Program = { id, title, priceRwf: price, days, meals, openDays, active: input?.active === undefined ? prev?.active ?? true : input.active !== false, createdAt: prev?.createdAt ?? now };
  const description = clean(input?.description ?? prev?.description, 300); if (description) p.description = description;
  const terms = clean(input?.terms ?? prev?.terms, 300); if (terms) p.terms = terms;
  if (windows) p.windows = windows;
  const max = input?.maxMembers === undefined ? prev?.maxMembers : input.maxMembers === null || input.maxMembers === '' ? undefined : Math.round(Number(input.maxMembers));
  if (max !== undefined && Number.isFinite(max) && max >= 1 && max <= MAX_MEMBERS) p.maxMembers = max;
  return p;
}

/** A person joining: name and phone are required (the phone is how the restaurant reaches them and how an online payment is requested). */
export function cleanJoin(input: any): { name: string; phone: string; studentId?: string } | { error: string } {
  const name = clean(input?.name, 60); if (name.length < 2) return { error: 'Please write your name.' };
  const phone = cleanPhone(input?.phone); if (!phone) return { error: 'Please write a phone number the restaurant can reach, like 0788 123 456.' };
  const studentId = clean(input?.studentId, 30);
  return { name, phone, ...(studentId ? { studentId } : {}) };
}

/* ---------------------------------------------------------------- secrets */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';        // no 0/O, 1/I/L: a code read aloud or typed on a phone is not misread
export const newCode = () => { const b = randomBytes(8); let s = ''; for (let i = 0; i < 8; i++) s += CODE_ALPHABET[b[i] % CODE_ALPHABET.length]; return `${s.slice(0, 4)}-${s.slice(4)}`; };
export const normalizeCode = (v: unknown) => { const s = String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/0/g, 'O').replace(/[1I]/g, 'L'); void s; const t = String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, ''); return t.length === 8 ? `${t.slice(0, 4)}-${t.slice(4)}` : null; };
export const newToken = () => randomBytes(24).toString('base64url');
export const hashToken = (token: string) => createHash('sha256').update(`biz-pass|${token}`).digest('hex');
/** The text inside the QR code: the pass link's own token, nothing else, so a scanner (or a person) cannot be tricked by other content. */
export const passPayload = (token: string) => `BWPASS:${token}`;
export const tokenFromPayload = (v: unknown): string | null => { const m = /^(?:BWPASS:|.*[?&]pass=)([A-Za-z0-9_-]{20,64})/.exec(String(v ?? '').trim()); return m ? m[1] : null; };

/* ---------------------------------------------------------------- status and serving */
export type PlanState = 'pending' | 'not_started' | 'active' | 'expired' | 'paused' | 'cancelled';
export function planState(m: Pick<Member, 'status' | 'paid' | 'startDate' | 'endDate'>, today: string): PlanState {
  if (m.status === 'cancelled') return 'cancelled';
  if (!m.paid || m.status === 'pending') return 'pending';
  if (m.status === 'paused') return 'paused';
  if (today > m.endDate) return 'expired';
  if (today < m.startDate) return 'not_started';
  return 'active';
}
/** Serving days left on a plan from today (today included), and the meals that makes. */
export function remaining(m: Pick<Member, 'startDate' | 'endDate'>, p: Pick<Program, 'openDays' | 'meals'>, today: string) {
  let servingDays = 0; const from = today > m.startDate ? today : m.startDate;
  for (let d = from; d <= m.endDate && servingDays < 800; d = addDays(d, 1)) if (p.openDays.includes(dayOfWeek(d))) servingDays++;
  return { servingDays, meals: servingDays * p.meals.length, calendarDays: today > m.endDate ? 0 : Math.max(0, Math.round((Date.parse(`${m.endDate}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000) + 1) };
}

export type DenyCode = 'pending' | 'not_started' | 'expired' | 'paused' | 'cancelled' | 'closed_day' | 'already' | 'outside_window' | 'no_meal';
export type ServeResult = { ok: true; meal: string } | { ok: false; code: DenyCode; message: string; meal?: string; at?: string };
const DENY_TEXT: Record<'pending' | 'expired' | 'paused' | 'cancelled', string> = {
  pending: 'Not paid yet.', expired: 'This plan has ended.', paused: 'This plan is paused.', cancelled: 'This plan was cancelled.',
};

/**
 * May this person be served now? `eaten` are today's meals already served (not undone). `meal` is the one the owner chose, if any; otherwise the
 * next meal of the day, inside its serving time when times are set. `force` lets the owner serve outside the serving time (never past a plan's end,
 * unpaid, paused, a closed day or a meal already served).
 */
export function canServe(o: { member: Member; program: Program; eaten: Array<{ meal: string; at: string }>; now: number; meal?: string; force?: boolean }): ServeResult {
  const { member, program, now } = o; const today = kigaliDate(now); const st = planState(member, today);
  if (st === 'pending' || st === 'expired' || st === 'paused' || st === 'cancelled') return { ok: false, code: st, message: DENY_TEXT[st] };
  if (st === 'not_started') return { ok: false, code: 'not_started', message: `This plan starts on ${member.startDate}.` };
  if (!program.openDays.includes(dayOfWeek(today))) return { ok: false, code: 'closed_day', message: 'No meals are served today.' };
  const done = new Set(o.eaten.map((e) => e.meal));
  const open = program.meals.filter((m) => !done.has(m));
  if (!open.length) { const last = o.eaten[o.eaten.length - 1]; return { ok: false, code: 'already', message: program.meals.length === 1 ? `Already served today at ${hhmm(last?.at)}.` : 'All of today\'s meals are already served.', ...(last ? { meal: last.meal, at: last.at } : {}) }; }
  if (o.meal !== undefined) {
    if (!program.meals.includes(o.meal)) return { ok: false, code: 'no_meal', message: 'That meal is not part of this plan.' };
    if (done.has(o.meal)) { const e = o.eaten.find((x) => x.meal === o.meal)!; return { ok: false, code: 'already', message: `${o.meal} was already served today at ${hhmm(e.at)}.`, meal: o.meal, at: e.at }; }
  }
  const minute = kigaliMinutes(now);
  const inWindow = (m: string) => { const w = program.windows?.find((x) => x.meal === m); return !w || (minute >= mins(w.from) && minute < mins(w.to)); };
  const pick = o.meal ?? open.find(inWindow) ?? (o.force ? open[0] : undefined);
  if (!pick) { const w = program.windows?.find((x) => x.meal === open[0]); return { ok: false, code: 'outside_window', message: `${open[0]} is served ${w ? `${w.from}–${w.to}` : 'at set times'}.`, meal: open[0] }; }
  if (!inWindow(pick) && !o.force) { const w = program.windows!.find((x) => x.meal === pick)!; return { ok: false, code: 'outside_window', message: `${pick} is served ${w.from}–${w.to}.`, meal: pick }; }
  return { ok: true, meal: pick };
}
const hhmm = (iso?: string) => { if (!iso) return ''; const k = new Date(Date.parse(iso) + KIGALI_MS); return `${String(k.getUTCHours()).padStart(2, '0')}:${String(k.getUTCMinutes()).padStart(2, '0')}`; };

/** A start date the customer chose: today to a week ahead, nothing in the past. */
export function cleanStart(v: unknown, today: string): string { return isDate(v) && v >= today && v <= addDays(today, 7) ? v : today; }
export const oneOfMethod = (v: unknown) => oneOf(['momo_prompt', 'momo_manual', 'cash'] as const, v, 'momo_manual');
