import { randomBytes, createHash, scrypt, timingSafeEqual } from 'node:crypto';
import { isStampImage } from './stampImages.js';
import type { Sealed } from './secrets.js';
import { DAYS, clean, cleanPhone, oneOf, type Day } from './model.js';

/**
 * Programs: a business sells a plan once (a month of lunches at a restaurant, a monthly gym pass, four haircuts, a laundry card), customers join
 * from a shared link and pay, and from then on each person shows a pass (a QR code on their phone) at the counter. The owner scans it and
 * the system says whether this person may use it now, and records the use.
 *
 * Pure rules live here (no storage, no clock of their own) so they are tested without a server. Dates are Kigali dates ("YYYY-MM-DD").
 * See service.ts for the storage and the public/owner boundary: a pass token is a secret only its holder has; the owner reaches a member by
 * the short code or the scan.
 */

export const MAX_PROGRAMS = 20;
export const MAX_MEMBERS = 3000;
export const MAX_PROGRAM_DAYS = 366;
/**
 * The owner's own words for this feature, because every business calls it something different: "Meal card" for students at a restaurant, "Membership"
 * at a gym, "Wash card" at a laundry. Each is optional (the plain defaults are used for any left out). They are only words: no markup, no braces.
 */
export interface ProgramText {
  /** What the owner calls the program, one and many ("Meal card", "Meal cards"). */
  program?: string; programs?: string;
  /** What they call the people who join ("student", "members", "client"). */
  member?: string; members?: string;
  /** What they call the pass the person shows ("card", "ticket", "voucher"). */
  pass?: string;
  /** What one use is called ("meal", "visit", "wash") and many. */
  use?: string; uses?: string;
  /** The word on the check-in result and button ("Serve", "Check in", "Redeem"). */
  action?: string;
  /** The question asked when joining ("Student ID", "Membership number"); askId false stops asking. */
  idLabel?: string; askId?: boolean;
  /** Whether the person at the counter may allow a use outside the set times. Default yes. */
  allowOverride?: boolean;
}
export const TEXT_KEYS = ['program', 'programs', 'member', 'members', 'pass', 'use', 'uses', 'action'] as const;
const word = (v: unknown, max: number) => clean(v, max).replace(/[{}<>]/g, '').trim();
/** Cleans what the owner typed (or the assistant sent) and merges it over what was saved; an empty word removes that choice. */
export function cleanProgramText(input: any, prev: ProgramText = {}): ProgramText {
  const out: ProgramText = { ...prev };
  for (const k of TEXT_KEYS) if (input?.[k] !== undefined) { const w = word(input[k], 24); if (w) out[k] = w; else delete out[k]; }
  if (input?.idLabel !== undefined) { const w = word(input.idLabel, 30); if (w) out.idLabel = w; else delete out.idLabel; }
  if (typeof input?.askId === 'boolean') { if (input.askId) delete out.askId; else out.askId = false; }
  if (typeof input?.allowOverride === 'boolean') { if (input.allowOverride) delete out.allowOverride; else out.allowOverride = false; }
  return out;
}

export type MemberStatus = 'pending' | 'active' | 'paused' | 'cancelled';

export interface ItemWindow { item: string; from: string; to: string }
export interface CardLayout { hiddenItems: string[]; hiddenDates: string[] }
export interface Program {
  id: string; title: string; description?: string;
  /** What a customer pays once, in RWF. */
  priceRwf: number;
  /** How many calendar days the plan lasts from its start day (30 = a month). */
  days: number;
  /** What a member gets each day, in order (for example ["Lunch"], ["Entry"], ["Haircut"] or ["Breakfast", "Lunch"]). One of each per person per day. */
  items: string[];
  /** Days of the week it is available. A day it is closed neither allows a use nor counts as a missed one. */
  openDays: Day[];
  /** Optional serving times. Without them a item can be served at any time. */
  windows?: ItemWindow[];
  /** Display preferences for cards issued from this plan. */
  cardLayout?: CardLayout;
  mealColors?: Record<string, string> | null;
  stampImage?: string;
  shuffleCardColor?: boolean;
  cardColor?: string;
  arrivalColor?: string;
  linkCheckIn?: boolean;
  /** A short rule shown to the customer ("Show your pass each time; one use a day"). */
  terms?: string;
  maxMembers?: number;
  /** An optional cap on the total number of uses over the whole plan (ten visits, four haircuts). Without it the only limit is one of each item per day. */
  totalUses?: number;
  /** A 4-digit code the owner gives out (in person, on a poster, by WhatsApp). When set, nobody can join without it. Private: never shown on the public page. */
  joinCode?: string;
  /** Who ticks the card: the business (scan or code, the default) or the customer themself by tapping today's item on their own card. */
  checkIn?: 'staff' | 'self';
  /** Set when the owner ended the whole program: nobody can use it any more and it takes no new members (opening sign-ups again starts it afresh). */
  endedAt?: string;
  active: boolean;
  createdAt: string;
}
export interface Member {
  id: string; programId: string; name: string; phone: string; idNumber?: string;
  /** What the owner types or reads out when the camera is not handy: XXXX-XXXX. */
  code: string;
  /** Only a hash of the pass token is kept: the token itself is in the customer's link and QR code. */
  passHash: string;
  /** The pass secret (what the QR code holds), encrypted, so the customer can be shown their QR code again after signing in. */
  passSealed?: Sealed;
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
  /** How many times the pass has been used so far (undone uses do not count). */
  used?: number;
  note?: string;
  createdAt: string;
}
export interface Use { id: string; memberId: string; date: string; item: string; at: string; by: 'scan' | 'code' | 'self'; undone?: boolean; guestRequest?: string; stampImage?: string }

/* ---------------------------------------------------------------- dates (Kigali, UTC+2) */
const KIGALI_MS = 2 * 3600_000;
export const kigaliDate = (t: number) => new Date(t + KIGALI_MS).toISOString().slice(0, 10);
export const kigaliMinutes = (t: number) => { const k = new Date(t + KIGALI_MS); return k.getUTCHours() * 60 + k.getUTCMinutes(); };
export const dayOfWeek = (date: string): Day => DAYS[(new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7];
export const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`));
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const mins = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

const MEAL_HOURS: Partial<Record<string, Pick<ItemWindow, 'from' | 'to'>>> = {
  breakfast: { from: '06:00', to: '10:00' },
  lunch: { from: '11:00', to: '15:00' },
  dinner: { from: '17:00', to: '22:00' },
  supper: { from: '17:00', to: '22:00' },
};

export function withRestaurantMealHours(program: Program): Program {
  const windows = [...(program.windows ?? [])];
  for (const item of program.items) {
    const name = item.trim().toLowerCase();
    const hours = Object.hasOwn(MEAL_HOURS, name) ? MEAL_HOURS[name] : undefined;
    if (hours && !windows.some((window) => window.item === item)) windows.push({ item, ...hours });
  }
  return windows.length ? { ...program, windows } : program;
}

/** During overlapping custom hours, use the meal whose serving window started most recently. */
export function restaurantMealAt(program: Program, now: number): string | undefined {
  const minute = kigaliMinutes(now);
  const openMeals = (program.windows ?? []).filter(({ item, from, to }) =>
    Object.hasOwn(MEAL_HOURS, item.trim().toLowerCase()) && minute >= mins(from) && minute < mins(to),
  );
  openMeals.sort((a, b) => b.from.localeCompare(a.from));
  return openMeals[0]?.item;
}

/** The last day a plan can be used: start + days − 1 (a 30-day plan starting on the 1st ends on the 30th), plus any days the owner added. */
export const endDateFor = (start: string, days: number, extra = 0) => addDays(start, Math.max(1, days) - 1 + Math.max(0, extra));

/* ---------------------------------------------------------------- cleaning */
export function cleanProgram(input: any, id: string, now: string, prev?: Program): Program | { error: string } {
  const title = clean(input?.title ?? prev?.title, 60); if (!title) return { error: 'A program needs a name, for example "Monthly pass".' };
  const price = Math.round(Number(String(input?.priceRwf ?? prev?.priceRwf ?? '').replace(/[,\s]/g, '')));
  if (!Number.isFinite(price) || price < 100 || price > 5_000_000) return { error: 'The price must be between 100 and 5,000,000 RWF.' };
  const days = Math.round(Number(input?.days ?? prev?.days ?? 30));
  if (!Number.isFinite(days) || days < 1 || days > MAX_PROGRAM_DAYS) return { error: `The plan must last between 1 and ${MAX_PROGRAM_DAYS} days.` };
  const rawItems: unknown[] = Array.isArray(input?.items) ? input.items : prev?.items ?? ['Visit'];
  const items = [...new Set(rawItems.map((m) => clean(m, 24)).filter(Boolean))].slice(0, 4); if (!items.length) return { error: 'Add at least one item, for example "Lunch" or "Entry".' };
  const rawDays: unknown[] = Array.isArray(input?.openDays) ? input.openDays : prev?.openDays ?? ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const openDays = DAYS.filter((d) => rawDays.includes(d)); if (!openDays.length) return { error: 'Choose at least one day it is available.' };
  let windows: ItemWindow[] | undefined;
  if (input?.windows !== undefined || prev?.windows) {
    const w: unknown[] = Array.isArray(input?.windows) ? input.windows : input?.windows === undefined ? prev?.windows ?? [] : [];
    windows = w.map((x: any) => ({ item: clean(x?.item, 24), from: String(x?.from ?? ''), to: String(x?.to ?? '') })).filter((x) => items.includes(x.item) && HHMM.test(x.from) && HHMM.test(x.to) && mins(x.to) > mins(x.from));
    if (!windows.length) windows = undefined;
  }
  const p: Program = { id, title, priceRwf: price, days, items, openDays, active: input?.active === undefined ? prev?.active ?? true : input.active !== false, createdAt: prev?.createdAt ?? now };
  const description = clean(input?.description ?? prev?.description, 300); if (description) p.description = description;
  const terms = clean(input?.terms ?? prev?.terms, 300); if (terms) p.terms = terms;
  if (windows) p.windows = windows;
  const max = input?.maxMembers === undefined ? prev?.maxMembers : input.maxMembers === null || input.maxMembers === '' ? undefined : Math.round(Number(input.maxMembers));
  if (max !== undefined && Number.isFinite(max) && max >= 1 && max <= MAX_MEMBERS) p.maxMembers = max;
  const cap = input?.totalUses === undefined ? prev?.totalUses : input.totalUses === null || input.totalUses === '' ? undefined : Math.round(Number(input.totalUses));
  if (cap !== undefined && Number.isFinite(cap) && cap >= 1 && cap <= 1000) p.totalUses = cap;
  const code = input?.joinCode === undefined ? prev?.joinCode : String(input.joinCode ?? '').replace(/\D/g, '');
  if (input?.joinCode !== undefined && String(input.joinCode ?? '').trim() !== '' && !/^\d{4}$/.test(code ?? '')) return { error: 'The join code must be 4 digits.' };
  if (code && /^\d{4}$/.test(code)) p.joinCode = code;
  if (prev?.endedAt && input?.active !== true) { p.endedAt = prev.endedAt; p.active = false; }   // an ended program stays ended until the owner opens sign-ups again
  const ci = input?.checkIn === undefined ? prev?.checkIn : input.checkIn; if (ci === 'self') p.checkIn = 'self';
  if (ci === 'self' && (input?.linkCheckIn ?? prev?.linkCheckIn) === true) p.linkCheckIn = true;
  const colors = input?.mealColors === undefined ? prev?.mealColors : input.mealColors;
  if (colors != null) {
    if (typeof colors !== 'object' || Array.isArray(colors)) return { error: 'Choose colors from the weekly meal schedule.' };
    p.mealColors = {};
    for (const [key, color] of Object.entries(colors)) {
      if (!/^(mon|tue|wed|thu|fri|sat|sun)-(breakfast|lunch|dinner|supper)$/.test(key) ||
          typeof color !== 'string' || !/^#[a-f0-9]{6}$/i.test(color)) return { error: 'Choose a valid weekday, meal and color.' };
      p.mealColors[key] = color;
    }
  }
  const stamp = input?.stampImage === undefined ? prev?.stampImage : input.stampImage;
  if (stamp) {
    if (!isStampImage(stamp)) return { error: 'Choose an uploaded stamp image.' };
    p.stampImage = stamp;
  }
  if ((input?.shuffleCardColor ?? prev?.shuffleCardColor) === true) p.shuffleCardColor = true;
  for (const key of ['cardColor', 'arrivalColor'] as const) {
    const value = input?.[key] ?? prev?.[key];
    if (value && !/^#[a-f0-9]{6}$/i.test(value)) return { error: 'Choose a valid card color.' };
    if (value) p[key] = value;
  }
  const layout = cleanCardLayout(input?.cardLayoutChange, prev?.cardLayout, items);
  if ('error' in layout) return layout;
  if (layout.hiddenItems.length || layout.hiddenDates.length) p.cardLayout = layout;
  return p;
}

function cleanCardLayout(input: unknown, previous: CardLayout | undefined, items: string[]): CardLayout | { error: string } {
  if (input !== undefined && (!input || typeof input !== 'object' || Array.isArray(input))) return { error: 'Choose which card columns or dates to show or hide.' };
  const change = (input ?? {}) as Record<string, unknown>;
  const hiddenItems = new Set(previous?.hiddenItems.filter((item) => items.includes(item)));
  const hiddenDates = new Set(previous?.hiddenDates);

  for (const key of ['hideItems', 'showItems', 'hideDates', 'showDates'] as const) {
    const values = change[key];
    if (values === undefined) continue;
    if (!Array.isArray(values) || values.length > MAX_PROGRAM_DAYS) return { error: 'Send the card columns or dates as a list.' };
    for (const value of values) {
      if (key === 'hideItems' || key === 'showItems') {
        const label = clean(value, 24);
        const item = items.find((name) => name === label) ?? items.find((name) => name.toLowerCase() === label.toLowerCase());
        if (item === undefined) return { error: 'Select a column from the items in this program.' };
        if (key === 'hideItems') hiddenItems.add(item);
        else hiddenItems.delete(item);
      } else {
        if (!isDate(value) || addDays(value, 0) !== value) return { error: 'Choose a valid date for the card row (YYYY-MM-DD).' };
        if (key === 'hideDates') hiddenDates.add(value);
        else hiddenDates.delete(value);
      }
    }
  }
  if (hiddenItems.size >= items.length) {
    if (Array.isArray(change.hideItems) && change.hideItems.length) return { error: 'Keep at least one item column visible on the card.' };
    hiddenItems.delete(items[0]);
  }
  if (hiddenDates.size > MAX_PROGRAM_DAYS) return { error: `Hide at most ${MAX_PROGRAM_DAYS} dates on a card.` };
  return { hiddenItems: items.filter((item) => hiddenItems.has(item)), hiddenDates: [...hiddenDates].sort() };
}

/* ---------------------------------------------------------------- short user names */
/** A user name is short (3 to 12 letters or digits), lowercase, easy to type on a phone. */
export const cleanUsername = (v: unknown): string => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12);
export const validUsername = (v: unknown): boolean => /^[a-z0-9]{3,12}$/.test(String(v ?? ''));
/** Up to three short proposals from a name, none already taken: "Aline Uwase" gives aline, uwase, aline42. */
export function suggestUsernames(name: unknown, taken: Set<string>, rand: () => number = Math.random): string[] {
  const parts = String(name ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const bases = [...new Set(parts.map((p) => p.slice(0, 8)).filter((p) => p.length >= 3))]; if (!bases.length) bases.push('user');
  const out: string[] = []; const add = (u: string) => { if (validUsername(u) && !taken.has(u) && !out.includes(u)) out.push(u); };
  for (const b of bases) add(b);
  for (let i = 0; out.length < 3 && i < 60; i++) add(`${bases[i % bases.length].slice(0, 8)}${10 + Math.floor(rand() * 90)}`);
  for (let n = 10; out.length < 3 && n < 100; n++) add(`${bases[0].slice(0, 8)}${n}`);   // never fewer than three, even with an unlucky draw
  return out.slice(0, 3);
}

/** A person joining: name and phone are required (the phone is how the business reaches them and how an online payment is requested). */
export function cleanJoin(input: any): { name: string; phone: string; idNumber?: string } | { error: string } {
  const name = clean(input?.name, 60); if (name.length < 2) return { error: 'Please write your name.' };
  const phone = cleanPhone(input?.phone); if (!phone) return { error: 'Please write a phone number the business can reach, like 0788 123 456.' };
  const idNumber = clean(input?.idNumber, 30);
  return { name, phone, ...(idNumber ? { idNumber } : {}) };
}

/* ---------------------------------------------------------------- secrets */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';        // no 0/O, 1/I/L: a code read aloud or typed on a phone is not misread
export const newCode = () => { const b = randomBytes(8); let s = ''; for (let i = 0; i < 8; i++) s += CODE_ALPHABET[b[i] % CODE_ALPHABET.length]; return `${s.slice(0, 4)}-${s.slice(4)}`; };
export const normalizeCode = (v: unknown) => { const s = String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/0/g, 'O').replace(/[1I]/g, 'L'); void s; const t = String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, ''); return t.length === 8 ? `${t.slice(0, 4)}-${t.slice(4)}` : null; };
/** A new 4-digit join code. */
export const newJoinCode = () => String(randomBytes(4).readUInt32BE() % 10000).padStart(4, '0');
export const sameCode = (a: unknown, b: unknown) => { const x = Buffer.from(String(a ?? '').replace(/\D/g, '').padEnd(8, '#')), y = Buffer.from(String(b ?? '').replace(/\D/g, '').padEnd(8, '#')); return x.length === y.length && timingSafeEqual(x, y); };
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
/** Uses a member has left: what the days still allow, less today's uses, never more than the program's total cap allows. */
export const usesLeft = (m: Pick<Member, 'used'>, p: Pick<Program, 'totalUses'>, daysAllow: number, usedToday: number) => Math.max(0, Math.min(daysAllow - usedToday, p.totalUses ? p.totalUses - (m.used ?? 0) : Infinity));

/** Serving days left on a plan from today (today included), and the items that makes. */
export function remaining(m: Pick<Member, 'startDate' | 'endDate'>, p: Pick<Program, 'openDays' | 'items'>, today: string) {
  let servingDays = 0; const from = today > m.startDate ? today : m.startDate;
  for (let d = from; d <= m.endDate && servingDays < 800; d = addDays(d, 1)) if (p.openDays.includes(dayOfWeek(d))) servingDays++;
  return { servingDays, uses: servingDays * p.items.length, calendarDays: today > m.endDate ? 0 : Math.max(0, Math.round((Date.parse(`${m.endDate}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000) + 1) };
}

export type DenyCode = 'pending' | 'not_started' | 'expired' | 'paused' | 'cancelled' | 'closed_day' | 'already' | 'outside_window' | 'no_item' | 'no_uses_left' | 'program_ended';
export type ServeResult = { ok: true; item: string } | { ok: false; code: DenyCode; message: string; item?: string; at?: string };
const DENY_TEXT: Record<'pending' | 'expired' | 'paused' | 'cancelled', string> = {
  pending: 'Not paid yet.', expired: 'This plan has ended.', paused: 'This plan is paused.', cancelled: 'This plan was cancelled.',
};

/**
 * May this person be served now? `used` are today's items already served (not undone). `item` is the one the owner chose, if any; otherwise the
 * next item of the day, inside its serving time when times are set. `force` lets the owner serve outside the serving time (never past a plan's end,
 * unpaid, paused, a closed day or a item already served).
 */
export function canServe(o: { member: Member; program: Program; used: Array<{ item: string; at: string }>; now: number; item?: string; force?: boolean }): ServeResult {
  const { member, program, now } = o; const today = kigaliDate(now); const st = planState(member, today);
  if (program.endedAt) return { ok: false, code: 'program_ended', message: 'This program has ended.' };
  if (st === 'pending' || st === 'expired' || st === 'paused' || st === 'cancelled') return { ok: false, code: st, message: DENY_TEXT[st] };
  if (st === 'not_started') return { ok: false, code: 'not_started', message: `This plan starts on ${member.startDate}.` };
  if (program.totalUses && (member.used ?? 0) >= program.totalUses) return { ok: false, code: 'no_uses_left', message: `All ${program.totalUses} uses of this program are already taken.` };
  if (!program.openDays.includes(dayOfWeek(today))) return { ok: false, code: 'closed_day', message: 'Not available today.' };
  const done = new Set(o.used.map((e) => e.item));
  const open = program.items.filter((item) => !done.has(item));
  if (o.item !== undefined && !program.items.includes(o.item)) return { ok: false, code: 'no_item', message: 'That item is not part of this program.' };

  function alreadyUsed(message: string, use?: { item: string; at: string }): ServeResult {
    const details = use ? { item: use.item, at: use.at } : {};
    // The schedule repeats weekly. The next open day still has to fall within the paid period.
    for (let offset = 1; offset <= 7; offset++) {
      const date = addDays(today, offset);
      if (date > member.endDate) break;
      if (!program.openDays.includes(dayOfWeek(date))) continue;
      const next = new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
      return { ok: false, code: 'already', message: `${message} Next check-in: ${next}.`, ...details };
    }
    return { ok: false, code: 'already', message: `${message} There are no more serving days left on this card.`, ...details };
  }

  const requestedUse = o.used.find((use) => use.item === o.item);
  if (requestedUse) return alreadyUsed(`${requestedUse.item} was already used today at ${hhmm(requestedUse.at)}.`, requestedUse);
  if (!open.length) {
    const last = o.used[o.used.length - 1];
    return alreadyUsed(program.items.length === 1 ? `Already used today at ${hhmm(last?.at)}.` : "All of today's uses are already taken.", last);
  }

  const minute = kigaliMinutes(now);
  const inWindow = (m: string) => { const w = program.windows?.find((x) => x.item === m); return !w || (minute >= mins(w.from) && minute < mins(w.to)); };
  const pick = o.item ?? open.find(inWindow) ?? (o.force ? open[0] : undefined);
  if (!pick) {
    const currentUse = o.used.find((use) => program.items.includes(use.item) && inWindow(use.item));
    if (currentUse) return alreadyUsed(`${currentUse.item} was already used today at ${hhmm(currentUse.at)}.`, currentUse);
    const w = program.windows?.find((x) => x.item === open[0]);
    return { ok: false, code: 'outside_window', message: `${open[0]} is available ${w ? `${w.from}–${w.to}` : 'at set times'}.`, item: open[0] };
  }
  if (!inWindow(pick) && !o.force) { const w = program.windows!.find((x) => x.item === pick)!; return { ok: false, code: 'outside_window', message: `${pick} is available ${w.from}–${w.to}.`, item: pick }; }
  return { ok: true, item: pick };
}
const hhmm = (iso?: string) => { if (!iso) return ''; const k = new Date(Date.parse(iso) + KIGALI_MS); return `${String(k.getUTCHours()).padStart(2, '0')}:${String(k.getUTCMinutes()).padStart(2, '0')}`; };

/** A start date the customer chose: today to a week ahead, nothing in the past. */
export function cleanStart(v: unknown, today: string): string { return isDate(v) && v >= today && v <= addDays(today, 7) ? v : today; }
export const oneOfMethod = (v: unknown) => oneOf(['momo_prompt', 'momo_manual', 'cash'] as const, v, 'momo_manual');

/* ---------------------------------------------------------------- the customer's own passcode and sign-in */
/** A passcode is 4 to 6 digits the customer chooses; it is checked on every sign-in, with a lockout after wrong tries (see programsService). */
export const validPasscode = (v: unknown): v is string => /^\d{4,6}$/.test(String(v ?? '').trim());
export const hashSession = (token: string) => createHash('sha256').update(`biz-sess|${token}`).digest('hex');
export const hashPasscode = (pin: string, salt: string): Promise<string> => new Promise((resolve, reject) => scrypt(String(pin).trim(), salt, 32, (e, k) => (e ? reject(e) : resolve(k.toString('hex')))));
export const newSalt = () => randomBytes(16).toString('hex');
export const SESSION_HOURS = 12, REMEMBER_DAYS = 30, MAX_PIN_FAILS = 5, LOCK_MINUTES = 10;

/** One row of the card: a calendar day of the plan with whether it is available and what was used that day. */
export interface CardDay { date: string; dow: Day; open: boolean; used: string[] }
export function cardCalendar(m: Pick<Member, 'startDate' | 'endDate'>, p: Pick<Program, 'openDays'>, uses: Array<{ date: string; item: string }>, cap = 124): CardDay[] {
  const by = new Map<string, string[]>(); for (const u of uses) by.set(u.date, [...(by.get(u.date) ?? []), u.item]);
  const out: CardDay[] = [];
  for (let d = m.startDate; d <= m.endDate && out.length < cap; d = addDays(d, 1)) out.push({ date: d, dow: dayOfWeek(d), open: p.openDays.includes(dayOfWeek(d)), used: by.get(d) ?? [] });
  return out;
}

