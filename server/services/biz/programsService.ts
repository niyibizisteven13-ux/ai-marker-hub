import { restaurantCard } from './mealCard.js';
import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { clean, cleanPhone } from './model.js';
import { open as openSecret, seal } from './secrets.js';
import type { Business, PublicBusiness } from './model.js';
import type { LedgerEntry } from './ledger.js';
import type { ProgramDay } from './report.js';
import {
  LOCK_MINUTES, MAX_MEMBERS, MAX_PIN_FAILS, MAX_PROGRAMS, REMEMBER_DAYS, SESSION_HOURS, addDays, canServe, cardCalendar, cleanJoin, cleanProgram, cleanProgramText, hashPasscode, hashSession, newJoinCode, cleanUsername, validUsername, suggestUsernames, newSalt, sameCode, validPasscode, cleanStart, dayOfWeek, endDateFor, hashToken, kigaliDate, newCode, newToken, normalizeCode,
  oneOfMethod, planState, remaining, restaurantMealAt, tokenFromPayload, usesLeft, withRestaurantMealHours, type DenyCode, type Use, type Member, type PlanState, type Program,
} from './programs.js';

/**
 * Storage and the public/owner boundary for programs (see programs.ts for the rules).
 *   biz-programs:<biz> the plans · biz-members:<biz> the people on them · biz-pass:<hash> -> who holds that pass token
 *   biz-uses:<biz>:<member> one person's items · biz-served:<biz>:<date> everything served that day · biz-served-days:<biz> which days exist
 * Everything that changes a member or serves a item runs under a per-business lock, so two scans at the counter at the same moment cannot
 * both serve the same item.
 */
interface Kv { get<T>(key: string): Promise<T | null>; put(key: string, value: unknown): Promise<void>; del(key: string): Promise<void> }
export class ProgramError extends Error { constructor(message: string, public status = 400, public code = 'PROGRAM') { super(message); } }

export interface Helpers {
  kv: Kv; now: () => number; iso: () => string;
  secretKey: () => Buffer;
  mine: (ownerId: string, id: string) => Promise<Business>;
  save: (b: Business) => Promise<void>;
  publicLive: (slug: string) => Promise<Business | null>;
  alert: (b: Business, n: { title: string; text: string }) => void;
  tooMany: (key: string, max: number, now: number, windowMs?: number) => boolean;
  payReady: (b: Business) => Promise<boolean>;
  startPayment: (b: Business, o: { phone: string; amount: number; item: string; customer?: string; src: LedgerEntry['src']; note?: string }) => Promise<LedgerEntry>;
  settle: (b: Business, entryId: string) => Promise<LedgerEntry | null>;
}

const locks = new Map<string, Promise<unknown>>();
async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(fn);
  const tail = run.catch(() => undefined); locks.set(key, tail);
  try { return await run; } finally { if (locks.get(key) === tail) locks.delete(key); }
}

export interface MemberView {
  id: string; programId: string; programTitle: string; name: string; phone: string; idNumber?: string; code: string; state: PlanState;
  startDate: string; endDate: string; paid: boolean; paidRwf: number; payMethod?: Member['payMethod']; claimed?: Member['claimed']; note?: string;
  servingDaysLeft: number; usesLeft: number; totalUses?: number; usedTotal?: number; usedToday: string[]; createdAt: string;
}
export interface PublicProgram { checkIn: 'staff' | 'self'; needsCode: boolean; id: string; title: string; description?: string; priceRwf: number; days: number; items: string[]; openDays: Program['openDays']; windows?: Program['windows']; terms?: string; full: boolean }

const SELF_UNDO_MS = 60_000;
/** The business's check-in code changes every minute, so a photo of it is useless a little later. The previous one is still accepted, for a slow scan. */
const CODE_WINDOW_MS = 60_000;
export function createPrograms(h: Helpers) {
  const { kv } = h;
  const k = { programs: (b: string) => `biz-programs:${b}`, members: (b: string) => `biz-members:${b}`, pass: (hash: string) => `biz-pass:${hash}`, uses: (b: string, m: string) => `biz-uses:${b}:${m}`, served: (b: string, d: string) => `biz-served:${b}:${d}`, days: (b: string) => `biz-served-days:${b}`, people: (b: string) => `biz-people:${b}`, sess: (hash: string) => `biz-sess:${hash}`, sessions: (b: string) => `biz-sessions:${b}` };
  const programsOf = async (bizId: string) => (await kv.get<{ items: Program[] }>(k.programs(bizId)))?.items ?? [];
  const servingHours = (b: Business, p: Program) => b.category === 'restaurant' ? withRestaurantMealHours(p) : p;
  const membersOf = async (bizId: string) => (await kv.get<{ items: Member[] }>(k.members(bizId)))?.items ?? [];
  const putMembers = (bizId: string, items: Member[]) => kv.put(k.members(bizId), { items });
  const servedOn = async (bizId: string, date: string) => (await kv.get<{ items: Use[] }>(k.served(bizId, date)))?.items ?? [];
  /* ---- the customer's own account at this business: a phone number and a passcode they chose, never stored in the clear */
  interface Person { phone: string; username?: string; hash: string; salt: string; fails: number; lockedUntil?: number; createdAt: string }
  const peopleOf = async (bizId: string) => (await kv.get<{ items: Person[] }>(k.people(bizId)))?.items ?? [];
  const putPeople = (bizId: string, items: Person[]) => kv.put(k.people(bizId), { items });
  const BAD_LOGIN = () => new ProgramError('The user name or passcode is not right.', 401, 'BAD_LOGIN');
  /** Checks a passcode, counting wrong tries: five wrong ones lock that phone number for ten minutes. Saves the counters. */
  async function checkPasscode(bizId: string, people: Person[], person: Person, pin: unknown): Promise<void> {
    const t = h.now();
    if (person.lockedUntil && person.lockedUntil > t) throw new ProgramError(`Too many wrong passcodes. Try again in ${Math.max(1, Math.ceil((person.lockedUntil - t) / 60_000))} minutes, or ask the business to reset it.`, 429, 'LOCKED');
    const ok = validPasscode(pin) && (await hashPasscode(String(pin), person.salt)) === person.hash;
    if (ok) { if (person.fails || person.lockedUntil) { person.fails = 0; delete person.lockedUntil; await putPeople(bizId, people); } return; }
    person.fails = (person.fails ?? 0) + 1;
    if (person.fails >= MAX_PIN_FAILS) { person.fails = 0; person.lockedUntil = t + LOCK_MINUTES * 60_000; }
    await putPeople(bizId, people); throw BAD_LOGIN();
  }
  /** A sign-in that lasts 12 hours (30 days when the customer asks to be remembered on this phone). Only a hash of it is stored. */
  async function newSession(bizId: string, phone: string, remember: boolean) {
    const token = newToken(); const exp = h.now() + (remember ? REMEMBER_DAYS * 86_400_000 : SESSION_HOURS * 3_600_000); const hash = hashSession(token);
    await kv.put(k.sess(hash), { bizId, phone, exp });
    const idx = (await kv.get<{ hashes: string[] }>(k.sessions(bizId)))?.hashes ?? []; await kv.put(k.sessions(bizId), { hashes: [...idx, hash].slice(-5000) });
    return { token, expiresAt: new Date(exp).toISOString() };
  }
  async function sessionOf(bizId: string, token: unknown): Promise<{ phone: string }> {
    const t = String(token ?? ''); if (!/^[A-Za-z0-9_-]{20,64}$/.test(t)) throw new ProgramError('Please sign in again.', 401, 'SESSION');
    const s = await kv.get<{ bizId: string; phone: string; exp: number }>(k.sess(hashSession(t)));
    if (!s || s.bizId !== bizId || s.exp < h.now()) throw new ProgramError('Please sign in again.', 401, 'SESSION');
    return { phone: s.phone };
  }
  /** Writes one tick: today's list, the member's own list, the day index and the running count. Call inside the member lock, after canServe agreed. */
  async function record(bizId: string, m: Member, date: string, t: number, item: string, served: Use[], by: Use['by']): Promise<Use> {
    const use: Use = { id: randomUUID(), memberId: m.id, date, item, at: new Date(t).toISOString(), by };
    await kv.put(k.served(bizId, date), { items: [...served, use] });
    const idx = (await kv.get<{ dates: string[] }>(k.days(bizId)))?.dates ?? []; if (!idx.includes(date)) await kv.put(k.days(bizId), { dates: [...idx, date].slice(-400) });
    const own = (await kv.get<{ items: Use[] }>(k.uses(bizId, m.id)))?.items ?? []; await kv.put(k.uses(bizId, m.id), { items: [...own, use].slice(-1500) });
    const all = await membersOf(bizId); const mm = all.find((x) => x.id === m.id); if (mm) { mm.used = (mm.used ?? 0) + 1; m.used = mm.used; await putMembers(bizId, all); }
    return use;
  }
  /** The 6-digit check-in code a business shows for one program in a given minute: an HMAC of the program and the minute, with a key only the server has. */
  const venueCode = (bizId: string, programId: string, win: number) => String(createHmac('sha256', h.secretKey()).update(`checkin|${bizId}|${programId}|${win}`).digest().readUInt32BE(0) % 1_000_000).padStart(6, '0');
  const venueCodeOk = (bizId: string, programId: string, given: unknown, t: number) => {
    const g = String(given ?? '').replace(/\D/g, ''); if (g.length !== 6) return false; const win = Math.floor(t / CODE_WINDOW_MS); let ok = false;
    for (const w of [win, win - 1]) { const a = Buffer.from(venueCode(bizId, programId, w)); const b = Buffer.from(g); if (a.length === b.length && timingSafeEqual(a, b)) ok = true; }
    return ok;
  };
  /** What the customer may tap on their own card right now (only for programs the owner set to self check-in): each item, whether it can be ticked, and why not. */
  function tickOptions(m: Member, p: Program, own: Use[], t: number) {
    const date = kigaliDate(t); const todays = own.filter((x) => x.date === date && !x.undone); const lastSelf = todays.filter((x) => x.by === 'self').sort((a, c) => c.at.localeCompare(a.at))[0];
    return {
      items: p.items.map((item) => { const r = canServe({ member: m, program: p, used: todays, now: t, item }); if (r.ok === true) return { item, allowed: true as const }; const d = r as Exclude<typeof r, { ok: true }>; return { item, allowed: false as const, reason: d.code, message: d.message }; }),
      undo: lastSelf && t - Date.parse(lastSelf.at) <= SELF_UNDO_MS ? { useId: lastSelf.id, item: lastSelf.item } : null,
    };
  }
  const usedOf = (list: Use[], memberId: string) => list.filter((m) => m.memberId === memberId && !m.undone).sort((a, b) => a.at.localeCompare(b.at));

  function view(m: Member, p: Program | undefined, today: string, used: Use[] = []): MemberView {
    const r = p ? remaining(m, p, today) : { servingDays: 0, uses: 0 };
    return {
      id: m.id, programId: m.programId, programTitle: p?.title ?? '(removed plan)', name: m.name, phone: m.phone, ...(m.idNumber ? { idNumber: m.idNumber } : {}), code: m.code, state: planState(m, today),
      startDate: m.startDate, endDate: m.endDate, paid: m.paid, paidRwf: m.paidRwf, ...(m.payMethod ? { payMethod: m.payMethod } : {}), ...(m.claimed ? { claimed: m.claimed } : {}), ...(m.note ? { note: m.note } : {}),
      servingDaysLeft: Math.max(0, r.servingDays - (p && used.length >= p.items.length ? 1 : 0)), usesLeft: p ? usesLeft(m, p, r.uses, used.length) : 0, ...(p?.totalUses ? { totalUses: p.totalUses, usedTotal: m.used ?? 0 } : {}), usedToday: used.map((e) => e.item), createdAt: m.createdAt,
    };
  }

  /** A confirmed payment: the plan starts counting and the money is written in the notebook (unless the online payment already did). */
  async function activate(b: Business, p: Program, m: Member, method: NonNullable<Member['payMethod']>, entryId?: string) {
    m.paid = true; m.paidRwf = p.priceRwf; m.status = 'active'; m.payMethod = method; m.confirmedAt = h.iso(); delete m.claimed; delete m.payRef;
    if (!entryId) {
      const e: LedgerEntry = { id: randomUUID(), type: 'sale', amount: p.priceRwf, at: h.iso(), status: 'completed', src: 'studio', item: `Program: ${p.title}`.slice(0, 80), customer: m.name, method: method === 'cash' ? 'cash' : 'momo', note: `Plan member ${m.code}` };
      const doc = (await kv.get<{ items: LedgerEntry[] }>(`biz-ledger:${b.id}`)) ?? { items: [] }; doc.items.unshift(e); await kv.put(`biz-ledger:${b.id}`, { items: doc.items.slice(0, 5000) });
    }
  }

  async function findMember(bizId: string, o: { token?: unknown; code?: unknown; memberId?: unknown }): Promise<Member | null> {
    const list = await membersOf(bizId);
    const token = tokenFromPayload(o.token) ?? (typeof o.token === 'string' && /^[A-Za-z0-9_-]{20,64}$/.test(o.token) ? o.token : null);
    if (token) { const ref = await kv.get<{ bizId: string; memberId: string }>(k.pass(hashToken(token))); return ref && ref.bizId === bizId ? list.find((m) => m.id === ref.memberId) ?? null : null; }
    const code = normalizeCode(o.code); if (code) return list.find((m) => m.code === code) ?? null;
    if (o.memberId) return list.find((m) => m.id === String(o.memberId)) ?? null;
    return null;
  }

  return {
    /* ---------------------------------------------------------------- owner */
    async programs(ownerId: string, id: string) {
      const b = await h.mine(ownerId, id); const today = kigaliDate(h.now()); const members = await membersOf(b.id);
      return (await programsOf(b.id)).map((p) => {
        const mine = members.filter((m) => m.programId === p.id);
        return { ...servingHours(b, p), counts: { active: mine.filter((m) => planState(m, today) === 'active').length, pending: mine.filter((m) => planState(m, today) === 'pending').length, total: mine.filter((m) => m.status !== 'cancelled').length } };
      });
    },
    /** The owner's own words for this feature, and the questions and permissions around it. */
    async programText(ownerId: string, id: string) { return { ...((await h.mine(ownerId, id)).programText ?? {}) }; },
    async setProgramText(ownerId: string, id: string, input: any) {
      const b = await h.mine(ownerId, id); const next = cleanProgramText(input, b.programText);
      if (Object.keys(next).length) b.programText = next; else delete b.programText;
      await h.save(b); return { ...(b.programText ?? {}) };
    },
    async saveProgram(ownerId: string, id: string, input: any): Promise<Program> {
      const b = await h.mine(ownerId, id);
      return withLock(`prog|${b.id}`, async () => {
        const list = await programsOf(b.id); const prev = input?.id ? list.find((p) => p.id === String(input.id)) : undefined;
        if (input?.id && !prev) throw new ProgramError('That plan was not found.', 404, 'NOT_FOUND');
        if (!prev && list.length >= MAX_PROGRAMS) throw new ProgramError(`You can have up to ${MAX_PROGRAMS} plans.`, 409, 'LIMIT');
        const defaults = !prev && b.category === 'restaurant' && input?.items === undefined ? restaurantCard : {};
        const p = cleanProgram({ ...defaults, ...input }, prev?.id ?? randomUUID(), h.iso(), prev); if ('error' in p) throw new ProgramError(p.error);
        await kv.put(k.programs(b.id), { items: prev ? list.map((x) => (x.id === p.id ? p : x)) : [...list, p] });
        return servingHours(b, p);
      });
    },
    async deleteProgram(ownerId: string, id: string, programId: string): Promise<void> {
      const b = await h.mine(ownerId, id);
      await withLock(`prog|${b.id}`, async () => {
        if ((await membersOf(b.id)).some((m) => m.programId === programId && m.status !== 'cancelled')) throw new ProgramError('This plan has members. Pause it instead (it stops taking new members) or cancel the members first.', 409, 'HAS_MEMBERS');
        await kv.put(k.programs(b.id), { items: (await programsOf(b.id)).filter((p) => p.id !== programId) });
      });
    },
    /**
     * Ends the whole program today. Sign-ups close, nobody can be ticked any more, unpaid cards are cancelled and paid cards end as of yesterday (so they show as ended,
     * with their history kept). Returns who paid and still had days or uses left, so the owner can refund or tell them: Bwenge never holds the money, so refunds are the owner's.
     */
    async endProgram(ownerId: string, id: string, programId: string) {
      const b = await h.mine(ownerId, id);
      return withLock(`mem|${b.id}`, async () => {
        const progs = await programsOf(b.id); const p = progs.find((x) => x.id === programId); if (!p) throw new ProgramError('That program was not found.', 404, 'NOT_FOUND');
        const today = kigaliDate(h.now()); const members = await membersOf(b.id); let cancelledUnpaid = 0; const refund: Array<{ memberId: string; name: string; phone: string; paidRwf: number; daysLeft: number; usesLeft: number }> = [];
        for (const m of members.filter((x) => x.programId === p.id && x.status !== 'cancelled')) {
          const st = planState(m, today);
          if (!m.paid) { m.status = 'cancelled'; m.note = [m.note, 'Program ended'].filter(Boolean).join(' · '); cancelledUnpaid++; continue; }
          if (st === 'expired') continue;
          const r = remaining(m, p, today); const left = { memberId: m.id, name: m.name, phone: m.phone, paidRwf: m.paidRwf, daysLeft: r.calendarDays, usesLeft: usesLeft(m, p, r.uses, 0) };
          m.endDate = addDays(today, -1); if (m.startDate > m.endDate) m.startDate = m.endDate; m.note = [m.note, 'Program ended'].filter(Boolean).join(' · ');
          if (left.daysLeft > 0 || left.usesLeft > 0) refund.push(left);
        }
        p.endedAt = h.iso(); p.active = false;
        await putMembers(b.id, members); await kv.put(k.programs(b.id), { items: progs });
        return { ended: p.title, endedAt: p.endedAt, cancelledUnpaid, paidMembersEnded: members.filter((x) => x.programId === p.id && x.paid && x.note?.includes('Program ended')).length, withUnusedDays: refund };
      });
    },
    async members(ownerId: string, id: string, o: { programId?: string; state?: string; q?: string } = {}): Promise<MemberView[]> {
      const b = await h.mine(ownerId, id); const today = kigaliDate(h.now()); const progs = await programsOf(b.id); const served = await servedOn(b.id, today);
      const q = String(o.q ?? '').trim().toLowerCase();
      return (await membersOf(b.id)).filter((m) => (!o.programId || m.programId === o.programId) && (!q || m.name.toLowerCase().includes(q) || m.phone.includes(q.replace(/\D/g, '') || '\u0000') || m.code.toLowerCase().includes(q) || (m.idNumber ?? '').toLowerCase().includes(q)))
        .map((m) => view(m, progs.find((p) => p.id === m.programId), today, usedOf(served, m.id))).filter((v) => !o.state || v.state === o.state).sort((a, c) => c.createdAt.localeCompare(a.createdAt));
    },
    /** The owner has the money (cash at the counter, or MoMo they can see on their phone): the plan starts. */
    async confirmPayment(ownerId: string, id: string, memberId: string, input: { method?: unknown } = {}): Promise<MemberView> {
      const b = await h.mine(ownerId, id);
      return withLock(`mem|${b.id}`, async () => {
        const list = await membersOf(b.id); const m = list.find((x) => x.id === memberId); if (!m) throw new ProgramError('That member was not found.', 404, 'NOT_FOUND');
        const p = (await programsOf(b.id)).find((x) => x.id === m.programId); if (!p) throw new ProgramError('That plan no longer exists.', 409);
        if (m.paid) throw new ProgramError('This plan is already paid.', 409, 'PAID');
        if (m.status === 'cancelled') throw new ProgramError('This plan was cancelled.', 409);
        await activate(b, p, m, input.method === 'cash' ? 'cash' : 'momo_manual'); await putMembers(b.id, list);
        return view(m, p, kigaliDate(h.now()));
      });
    },
    async setMember(ownerId: string, id: string, memberId: string, input: { action?: unknown; days?: unknown; note?: unknown }): Promise<MemberView> {
      const b = await h.mine(ownerId, id);
      return withLock(`mem|${b.id}`, async () => {
        const list = await membersOf(b.id); const m = list.find((x) => x.id === memberId); if (!m) throw new ProgramError('That member was not found.', 404, 'NOT_FOUND');
        const p = (await programsOf(b.id)).find((x) => x.id === m.programId); const action = String(input.action ?? '');
        if (action === 'pause') m.status = 'paused'; else if (action === 'resume') { if (!m.paid) throw new ProgramError('Confirm the payment first.', 409); m.status = 'active'; } else if (action === 'cancel') m.status = 'cancelled';
        else if (action === 'extend') { const n = Math.round(Number(input.days)); if (!Number.isFinite(n) || n < 1 || n > 60) throw new ProgramError('Add between 1 and 60 days.'); m.extraDays = (m.extraDays ?? 0) + n; m.endDate = endDateFor(m.startDate, p?.days ?? 30, m.extraDays); }
        else if (action === 'note') m.note = clean(input.note, 200) || undefined;
        else throw new ProgramError('Unknown action.');
        await putMembers(b.id, list); return view(m, p, kigaliDate(h.now()));
      });
    },
    /** Scan (token) or type (code) a pass: the system says whether this person may be served now, and records the item. */
    /** The code the business shows right now for a program that customers tick by scanning (it changes every minute). */
    async checkinCode(ownerId: string, id: string, programId: string): Promise<{ code: string; expiresInSec: number; program: string }> {
      const b = await h.mine(ownerId, id); const p = (await programsOf(b.id)).find((x) => x.id === programId); if (!p) throw new ProgramError('That program was not found.', 404, 'NOT_FOUND');
      if (p.checkIn !== 'self') throw new ProgramError('This program is ticked by your staff. Turn on "The customer scans" in the program to use a check-in code.', 409, 'STAFF_ONLY');
      const t = h.now(); const win = Math.floor(t / CODE_WINDOW_MS); return { code: venueCode(b.id, p.id, win), expiresInSec: Math.max(1, Math.ceil(((win + 1) * CODE_WINDOW_MS - t) / 1000)), program: p.title };
    },
    async redeem(ownerId: string, id: string, input: { token?: unknown; code?: unknown; memberId?: unknown; item?: unknown; force?: unknown }) {
      const b = await h.mine(ownerId, id);
      return withLock(`mem|${b.id}`, async () => {
        const m = await findMember(b.id, input); if (!m) return { ok: false as const, code: 'unknown' as const, message: 'This pass was not found. Check the code, or ask the customer to open their pass link.' };
        const p = (await programsOf(b.id)).find((x) => x.id === m.programId); if (!p) return { ok: false as const, code: 'unknown' as const, message: 'This plan no longer exists.' };
        const t = h.now(); const date = kigaliDate(t); const served = await servedOn(b.id, date); const used = usedOf(served, m.id);
        const program = servingHours(b, p);
        const force = input.force === true && b.programText?.allowOverride !== false;
        const item = input.item ? String(input.item) : b.category === 'restaurant' && !force ? restaurantMealAt(program, t) : undefined;
        const r = canServe({ member: m, program, used, now: t, item, force });
        if (!r.ok) return { ...r, member: view(m, p, date, used) };
        const use = await record(b.id, m, date, t, r.item, served, tokenFromPayload(input.token) || typeof input.token === 'string' ? 'scan' : 'code');
        return { ok: true as const, item: r.item, useId: use.id, member: view(m, p, date, [...used, use]) };
      });
    },
    /** A mistaken scan can be undone for a few minutes. */
    async undoUse(ownerId: string, id: string, useId: string): Promise<{ ok: true }> {
      const b = await h.mine(ownerId, id);
      return withLock(`mem|${b.id}`, async () => {
        const today = kigaliDate(h.now()); const days = [today, addDays(today, -1)];
        for (const d of days) {
          const served = await servedOn(b.id, d); const m = served.find((x) => x.id === useId); if (!m) continue;
          if (h.now() - Date.parse(m.at) > 20 * 60_000) throw new ProgramError('A use can only be undone within 20 minutes.', 409, 'TOO_LATE');
          m.undone = true; await kv.put(k.served(b.id, d), { items: served });
          const own = (await kv.get<{ items: Use[] }>(k.uses(b.id, m.memberId)))?.items ?? []; const x = own.find((y) => y.id === useId); if (x) { x.undone = true; await kv.put(k.uses(b.id, m.memberId), { items: own }); }
          const all = await membersOf(b.id); const mm = all.find((y) => y.id === m.memberId); if (mm) { mm.used = Math.max(0, (mm.used ?? 0) - 1); await putMembers(b.id, all); }
          return { ok: true as const };
        }
        throw new ProgramError('That use was not found.', 404, 'NOT_FOUND');
      });
    },
    /** Today at a glance: who has been served, who has a plan today and has not come yet. */
    async today(ownerId: string, id: string) {
      const b = await h.mine(ownerId, id); const t = h.now(); const date = kigaliDate(t); const progs = await programsOf(b.id); const members = await membersOf(b.id); const served = (await servedOn(b.id, date)).filter((x) => !x.undone);
      const byId = new Map(members.map((m) => [m.id, m]));
      const open = (p?: Program) => !!p && p.openDays.includes(dayOfWeek(date));
      const expected = members.filter((m) => planState(m, date) === 'active' && open(progs.find((p) => p.id === m.programId)));
      const notYet = expected.filter((m) => { const p = progs.find((x) => x.id === m.programId)!; return served.filter((s) => s.memberId === m.id).length < p.items.length; });
      return {
        date, open: progs.some((p) => open(p)),
        servedCount: served.length, expected: expected.length,
        served: served.slice().reverse().slice(0, 200).map((s) => ({ useId: s.id, memberId: s.memberId, name: byId.get(s.memberId)?.name ?? '', code: byId.get(s.memberId)?.code ?? '', item: s.item, at: s.at, by: s.by, canUndo: t - Date.parse(s.at) <= 20 * 60_000 })),
        notYet: notYet.slice(0, 300).map((m) => ({ memberId: m.id, name: m.name, phone: m.phone, code: m.code })),
      };
    },
    /** What the plans are worth and who needs a nudge. */
    async programSummary(ownerId: string, id: string) {
      const b = await h.mine(ownerId, id); const today = kigaliDate(h.now()); const progs = await programsOf(b.id); const members = await membersOf(b.id);
      const state = (m: Member) => planState(m, today); const month = today.slice(0, 7);
      const expiring = members.filter((m) => state(m) === 'active' && m.endDate <= addDays(today, 3)).map((m) => ({ memberId: m.id, name: m.name, phone: m.phone, endDate: m.endDate, program: progs.find((p) => p.id === m.programId)?.title ?? '' }));
      return {
        plans: progs.length, members: members.filter((m) => m.status !== 'cancelled').length, active: members.filter((m) => state(m) === 'active').length, pending: members.filter((m) => state(m) === 'pending').length,
        expired: members.filter((m) => state(m) === 'expired').length, soldThisMonth: members.filter((m) => m.paid && (m.confirmedAt ?? m.createdAt).slice(0, 7) === month).reduce((a, m) => a + m.paidRwf, 0),
        waitingConfirmation: members.filter((m) => !m.paid && m.claimed && m.status !== 'cancelled').length, expiring,
      };
    },
    /** One day of the programs, for the closing report: who was served (by item), who did not come (today only), new members, money collected, what waits for the owner. */
    async dayStats(b: Business, date: string): Promise<ProgramDay | null> {
      const progs = await programsOf(b.id); if (!progs.length) return null;
      const members = await membersOf(b.id); const today = kigaliDate(h.now()); const served = (await servedOn(b.id, date)).filter((x) => !x.undone);
      const byItem = new Map<string, number>(); for (const u of served) byItem.set(u.item, (byItem.get(u.item) ?? 0) + 1);
      const order = new Map(progs.flatMap((p) => p.items).map((it, i) => [it, i] as const));
      const dateOf = (iso: string) => kigaliDate(Date.parse(iso)); const open = (p?: Program) => !!p && p.openDays.includes(dayOfWeek(date));
      let notYet: ProgramDay['notYet'] = null; let expected: number | null = null;
      if (date === today) {
        const exp = members.filter((m) => planState(m, date) === 'active' && open(progs.find((p) => p.id === m.programId))); expected = exp.length;
        notYet = exp.filter((m) => served.filter((s) => s.memberId === m.id).length === 0).map((m) => ({ name: m.name }));
      }
      return {
        byItem: [...byItem.entries()].map(([item, count]) => ({ item, count })).sort((x, y) => (order.get(x.item) ?? 9) - (order.get(y.item) ?? 9)), served: served.length, people: new Set(served.map((u) => u.memberId)).size, bySelf: served.filter((u) => u.by === 'self').length,
        notYet, expected,
        newMembers: members.filter((m) => m.status !== 'cancelled' && dateOf(m.createdAt) === date).length,
        collectedRwf: members.filter((m) => m.paid && dateOf(m.confirmedAt ?? m.createdAt) === date).reduce((a, m) => a + m.paidRwf, 0),
        waiting: members.filter((m) => !m.paid && m.claimed && m.status !== 'cancelled').slice(0, 20).map((m) => ({ name: m.name, programTitle: progs.find((p) => p.id === m.programId)?.title ?? '' })),
        expiring: members.filter((m) => planState(m, date) === 'active' && m.endDate <= addDays(date, 3)).slice(0, 20).map((m) => ({ name: m.name, endDate: m.endDate })),
        plans: progs.length, activeMembers: members.filter((m) => planState(m, today) === 'active').length,
      };
    },
    async dropAll(b: Business): Promise<void> {
      const members = await membersOf(b.id);
      for (const m of members) { await kv.del(k.pass(m.passHash)); await kv.del(k.uses(b.id, m.id)); }
      for (const d of (await kv.get<{ dates: string[] }>(k.days(b.id)))?.dates ?? []) await kv.del(k.served(b.id, d));
      for (const hh of (await kv.get<{ hashes: string[] }>(k.sessions(b.id)))?.hashes ?? []) await kv.del(k.sess(hh));
      await kv.del(k.sessions(b.id)); await kv.del(k.people(b.id)); await kv.del(k.days(b.id)); await kv.del(k.members(b.id)); await kv.del(k.programs(b.id));
    },

    /* ---------------------------------------------------------------- public */
    async publicPrograms(b: Business): Promise<PublicProgram[]> {
      const members = await membersOf(b.id);
      return (await programsOf(b.id)).filter((p) => p.active).map((p) => servingHours(b, p)).map((p) => ({
        checkIn: p.checkIn === 'self' ? 'self' : 'staff', needsCode: !!p.joinCode, id: p.id, title: p.title, ...(p.description ? { description: p.description } : {}), priceRwf: p.priceRwf, days: p.days, ...(p.totalUses ? { totalUses: p.totalUses } : {}), items: p.items, openDays: p.openDays, ...(p.windows ? { windows: p.windows } : {}), ...(p.terms ? { terms: p.terms } : {}),
        full: !!p.maxMembers && members.filter((m) => m.programId === p.id && m.status !== 'cancelled' && planState(m, kigaliDate(h.now())) !== 'expired').length >= p.maxMembers,
      }));
    },
    /** Short user names proposed from a name, none taken at this business. */
    async suggestUsernames(slug: string, name: unknown, visitor: string): Promise<{ suggestions: string[] }> {
      const b = await h.publicLive(slug); if (!b) throw new ProgramError('This page is not available.', 404, 'NOT_FOUND');
      if (h.tooMany(`uname|${visitor}`, 60, h.now())) throw new ProgramError('Too many tries. Please wait a little.', 429, 'RATE');
      const people = await peopleOf(b.id); return { suggestions: suggestUsernames(name, new Set(people.map((x) => x.username).filter((x): x is string => !!x))) };
    },
    /** A customer joins from the shared link: name, phone, the owner's 4-digit join code (when the owner set one) and a passcode of their own. They are signed in at once. */
    async joinProgram(slug: string, programId: string, input: { name?: unknown; phone?: unknown; username?: unknown; idNumber?: unknown; startDate?: unknown; joinCode?: unknown; passcode?: unknown; remember?: unknown; website?: unknown }, visitor: string): Promise<{ session: string; expiresAt: string; cardId: string; code: string; username: string }> {
      if (clean(input.website, 40)) throw new ProgramError('Not accepted.');
      const b = await h.publicLive(slug); if (!b) throw new ProgramError('This page is not available.', 404, 'NOT_FOUND');
      if (h.tooMany(`join|${visitor}`, 10, h.now())) throw new ProgramError('Too many tries. Please wait a little and try again.', 429, 'RATE');
      const who = cleanJoin(input); if ('error' in who) throw new ProgramError(who.error); if (b.programText?.askId === false) delete who.idNumber;
      if (!validPasscode(input.passcode)) throw new ProgramError('Choose a passcode of 4 to 6 digits. You will use it every time you open your card.');
      return withLock(`mem|${b.id}`, async () => {
        const p = (await programsOf(b.id)).find((x) => x.id === programId && x.active); if (!p) throw new ProgramError('This plan is not open.', 404, 'NOT_FOUND');
        // The owner's join code: nobody joins without it, and guessing is slowed down.
        if (p.joinCode) {
          if (h.tooMany(`jc|${p.id}|${visitor}`, 8, h.now())) throw new ProgramError('Too many wrong codes. Please wait a while, or ask the business for the code again.', 429, 'RATE');
          if (!sameCode(input.joinCode, p.joinCode)) throw new ProgramError('That join code is not right. Ask the business for the code.', 403, 'BAD_CODE');
        }
        const list = await membersOf(b.id); const today = kigaliDate(h.now());
        const live = list.filter((m) => m.programId === p.id && m.status !== 'cancelled' && planState(m, today) !== 'expired');
        if (live.some((m) => m.phone === who.phone)) throw new ProgramError('This phone number already has this plan. Sign in with your passcode to open it.', 409, 'EXISTS');
        if (p.maxMembers && live.length >= p.maxMembers) throw new ProgramError('This plan is full.', 409, 'FULL');
        if (list.length >= MAX_MEMBERS) throw new ProgramError('This business cannot take more members right now.', 409, 'LIMIT');
        // The customer's account: a new phone number sets its passcode now; a phone number that already has one must use it.
        const people = await peopleOf(b.id); const existing = people.find((x) => x.phone === who.phone);
        if (existing) await checkPasscode(b.id, people, existing, input.passcode);
        else {
          // A short user name: the one the customer picked, or the first proposal. Never two the same at one business.
          const taken = new Set(people.map((x) => x.username).filter((x): x is string => !!x)); const want = cleanUsername(input.username);
          if (want && !validUsername(want)) throw new ProgramError('A user name is 3 to 12 letters or numbers, with no spaces.', 400, 'BAD_USERNAME');
          if (want && taken.has(want)) throw new ProgramError(`"${want}" is already taken. Try ${suggestUsernames(who.name, taken).join(' or ')}.`, 409, 'USERNAME_TAKEN');
          const username = want || suggestUsernames(who.name, taken)[0];
          const salt = newSalt(); people.push({ phone: who.phone, username, salt, hash: await hashPasscode(String(input.passcode), salt), fails: 0, createdAt: h.iso() }); await putPeople(b.id, people);
        }
        const secret = newToken(); let code = newCode(); while (list.some((m) => m.code === code)) code = newCode();
        const start = cleanStart(input.startDate, today);
        const m: Member = { id: randomUUID(), programId: p.id, name: who.name, phone: who.phone, ...(who.idNumber ? { idNumber: who.idNumber } : {}), code, passHash: hashToken(secret), passSealed: seal(secret, h.secretKey()), status: 'pending', startDate: start, endDate: endDateFor(start, p.days), paidRwf: 0, paid: false, createdAt: h.iso() };
        await putMembers(b.id, [...list, m]); await kv.put(k.pass(m.passHash), { bizId: b.id, memberId: m.id });
        h.alert(b, { title: `New plan member · ${b.name}`, text: `${m.name} joined "${p.title}" (${p.priceRwf.toLocaleString('en-US')} RWF). Waiting for payment.` });
        const s = await newSession(b.id, who.phone, input.remember === true);
        const mine = (await peopleOf(b.id)).find((x) => x.phone === who.phone);
        return { session: s.token, expiresAt: s.expiresAt, cardId: m.id, code, username: mine?.username ?? '' };
      });
    },
    /** Signing in again: phone number and the passcode the customer chose. Wrong tries are counted and lock the phone number for a while. */
    async login(slug: string, input: { username?: unknown; phone?: unknown; passcode?: unknown; remember?: unknown }, visitor: string): Promise<{ session: string; expiresAt: string; username: string }> {
      const b = await h.publicLive(slug); if (!b) throw new ProgramError('This page is not available.', 404, 'NOT_FOUND');
      if (h.tooMany(`login|${visitor}`, 20, h.now())) throw new ProgramError('Too many tries. Please wait a little and try again.', 429, 'RATE');
      const uname = cleanUsername(input.username); const phone = uname ? '' : cleanPhone(input.phone); if (!uname && !phone) throw BAD_LOGIN();
      return withLock(`mem|${b.id}`, async () => {
        const people = await peopleOf(b.id); const person = uname ? people.find((x) => x.username === uname) : people.find((x) => x.phone === phone);
        if (!person) { await hashPasscode(String(input.passcode ?? ''), 'x'.repeat(32)).catch(() => undefined); throw BAD_LOGIN(); }   // the same work and the same answer whether or not the number exists
        await checkPasscode(b.id, people, person, input.passcode);
        if (!(await membersOf(b.id)).some((m) => m.phone === person.phone && m.status !== 'cancelled')) throw BAD_LOGIN();
        const s = await newSession(b.id, person.phone, input.remember === true); return { session: s.token, expiresAt: s.expiresAt, username: person.username ?? '' };
      });
    },
    async logout(slug: string, session: string): Promise<{ ok: true }> {
      const b = await h.publicLive(slug); if (!b) throw new ProgramError('This page is not available.', 404, 'NOT_FOUND');
      await kv.del(k.sess(hashSession(String(session ?? '')))); return { ok: true as const };
    },
    async changePasscode(slug: string, session: string, input: { current?: unknown; next?: unknown }): Promise<{ ok: true }> {
      const b = await h.publicLive(slug); if (!b) throw new ProgramError('This page is not available.', 404, 'NOT_FOUND'); const me = await sessionOf(b.id, session);
      if (!validPasscode(input.next)) throw new ProgramError('Choose a passcode of 4 to 6 digits.');
      return withLock(`mem|${b.id}`, async () => {
        const people = await peopleOf(b.id); const person = people.find((x) => x.phone === me.phone); if (!person) throw BAD_LOGIN();
        await checkPasscode(b.id, people, person, input.current); person.salt = newSalt(); person.hash = await hashPasscode(String(input.next), person.salt); await putPeople(b.id, people); return { ok: true as const };
      });
    },
    /** The signed-in customer's dashboard: their name and their cards. */
    async me(slug: string, session: string) {
      const b = await h.publicLive(slug); if (!b) throw new ProgramError('This page is not available.', 404, 'NOT_FOUND'); const me = await sessionOf(b.id, session);
      const today = kigaliDate(h.now()); const progs = await programsOf(b.id); const served = await servedOn(b.id, today);
      const mine = (await membersOf(b.id)).filter((m) => m.phone === me.phone && m.status !== 'cancelled').sort((x, y) => y.createdAt.localeCompare(x.createdAt));
      const who = (await peopleOf(b.id)).find((x) => x.phone === me.phone);
      return { name: mine[0]?.name ?? '', phone: me.phone, username: who?.username ?? '', cards: mine.map((m) => { const v = view(m, progs.find((p) => p.id === m.programId), today, usedOf(served, m.id)); return { id: v.id, programId: m.programId, programTitle: v.programTitle, state: v.state, startDate: v.startDate, endDate: v.endDate, usesLeft: v.usesLeft, paid: v.paid }; }) };
    },
    /** One card, in full: who it is for, the dates and what was used each day (the grid), the QR code, and how to pay while it is unpaid. */
    async card(slug: string, session: string, cardId?: string) {
      const b = await h.publicLive(slug); if (!b) throw new ProgramError('This page is not available.', 404, 'NOT_FOUND'); const me = await sessionOf(b.id, session);
      return withLock(`mem|${b.id}`, async () => {
        const list = await membersOf(b.id); const mine = list.filter((x) => x.phone === me.phone && x.status !== 'cancelled');
        const m = cardId ? mine.find((x) => x.id === cardId) : mine.length === 1 ? mine[0] : mine.sort((x, y) => y.createdAt.localeCompare(x.createdAt))[0];
        const saved = m && (await programsOf(b.id)).find((x) => x.id === m.programId); if (!m || !saved) throw new ProgramError('This card was not found.', 404, 'NOT_FOUND');
        const p = servingHours(b, saved);
        // A payment prompt that was approved on the phone: settle it now (the customer's screen asks about it while waiting).
        let prompt = false;
        if (!m.paid && m.payRef) {
          const e = await h.settle(b, m.payRef);
          if (e?.pay?.state === 'success') { await activate(b, p, m, 'momo_prompt', e.id); await putMembers(b.id, list); h.alert(b, { title: `Plan paid · ${b.name}`, text: `${m.name} paid ${p.priceRwf.toLocaleString('en-US')} RWF for "${p.title}".` }); }
          else if (e?.pay?.state === 'failed') { delete m.payRef; await putMembers(b.id, list); } else prompt = true;
        }
        const t = h.now(); const date = kigaliDate(t); const own = ((await kv.get<{ items: Use[] }>(k.uses(b.id, m.id)))?.items ?? []).filter((x) => !x.undone);
        const r = remaining(m, p, date); const st = planState(m, date); const ateToday = own.filter((x) => x.date === date).length;
        let qr: string | null = null; if (m.paid && (st === 'active' || st === 'not_started') && m.passSealed) { try { qr = `BWPASS:${openSecret(m.passSealed, h.secretKey())}`; } catch { qr = null; } }
        return {
          cardId: m.id,
          business: { name: b.name, slug: b.slug, theme: b.theme },
          program: { title: p.title, shuffleCardColor: p.shuffleCardColor, cardColor: p.cardColor, arrivalColor: p.arrivalColor, ...(p.cardLayout ? { cardLayout: p.cardLayout } : {}), checkIn: p.checkIn === 'self' ? 'self' : 'staff', ...(p.totalUses ? { totalUses: p.totalUses } : {}), items: p.items, openDays: p.openDays, ...(p.windows ? { windows: p.windows } : {}), ...(p.terms ? { terms: p.terms } : {}), priceRwf: p.priceRwf, days: p.days },
          member: { name: m.name, phone: m.phone, ...(m.idNumber ? { idNumber: m.idNumber } : {}), code: m.code, state: st, startDate: m.startDate, endDate: m.endDate, daysLeft: r.calendarDays, servingDaysLeft: Math.max(0, r.servingDays - (ateToday >= p.items.length ? 1 : 0)), usesLeft: usesLeft(m, p, r.uses, ateToday), usedTotal: m.used ?? 0, paid: m.paid, paidAt: m.confirmedAt ?? null },
          qr,
          tick: p.checkIn === 'self' ? { needsCode: !(b.category === 'restaurant' && p.linkCheckIn), requiresPasscode: b.category === 'restaurant', ...tickOptions(m, p, own, t) } : null,
          today: { date, openToday: p.openDays.includes(dayOfWeek(date)), used: own.filter((x) => x.date === date).map((x) => ({ item: x.item, at: x.at })) },
          calendar: cardCalendar(m, p, own.map((x) => ({ date: x.date, item: x.item })).slice(-1500)),
          history: [],
          payment: m.paid ? null : {
            amount: p.priceRwf, momoCode: b.showPay ? b.momoCode ?? null : null, momoName: b.showPay ? b.momoName ?? null : null, online: await h.payReady(b), promptSent: prompt, claimed: m.claimed ?? null,
            whatsapp: b.whatsapp ?? null,
          },
        };
      });
    },
    /** The customer scans the business's rotating code (only when the owner chose self check-in): restaurant check-ins also confirm the customer's passcode. */
    async selfUse(slug: string, session: string, input: { cardId?: unknown; code?: unknown; item?: unknown; passcode?: unknown }, visitor: string) {
      const b = await h.publicLive(slug); if (!b) throw new ProgramError('This page is not available.', 404, 'NOT_FOUND'); const me = await sessionOf(b.id, session);
      if (h.tooMany(`tick|${b.id}|${me.phone}|${visitor}`, 30, h.now())) throw new ProgramError('Too many tries. Please wait a little.', 429, 'RATE');
      return withLock(`mem|${b.id}`, async () => {
        const progs = await programsOf(b.id); const cardId = clean(input.cardId, 60);
        const mine = (await membersOf(b.id)).filter((x) => x.phone === me.phone && x.status !== 'cancelled' && (!cardId || x.id === cardId));
        const cards = mine.map((m) => ({ m, p: progs.find((x) => x.id === m.programId) })).filter((x): x is { m: Member; p: Program } => !!x.p);
        if (!cards.length) throw new ProgramError('This card was not found.', 404, 'NOT_FOUND');
        const selfCards = cards.filter((x) => x.p.checkIn === 'self'); if (!selfCards.length) throw new ProgramError('At this business the staff ticks your card. Show your QR code.', 403, 'STAFF_ONLY');
        const t = h.now();
        // The customer proves they are at the business by the code it shows: it changes every minute and cannot be guessed.
        if (h.tooMany(`tickcode|${b.id}|${me.phone}|${visitor}`, 15, t)) throw new ProgramError('Too many wrong codes. Please wait a little.', 429, 'RATE');
        const direct = !input.code && !!cardId && b.category === 'restaurant';
        const hit = direct ? selfCards.find((x) => x.p.linkCheckIn) : selfCards.reverse().find((x) => venueCodeOk(b.id, x.p.id, input.code, t)); if (!hit) throw new ProgramError('That code is not right, or it has changed. Scan the business\'s code again.', 403, 'BAD_CODE');
        const restaurant = b.category === 'restaurant';
        if (restaurant) {
          if (!validPasscode(input.passcode)) throw new ProgramError('Enter your 4 to 6 digit passcode to check in.', 400, 'PASSCODE_REQUIRED');
          const people = await peopleOf(b.id);
          const person = people.find((entry) => entry.phone === me.phone);
          if (!person) throw new ProgramError('Please sign in again.', 401, 'SESSION');
          await checkPasscode(b.id, people, person, input.passcode);
        }
        const { m, p } = hit;
        const program = servingHours(b, p);
        const date = kigaliDate(t); const served = await servedOn(b.id, date); const used = usedOf(served, m.id);
        const item = restaurant ? restaurantMealAt(program, t) : clean(input.item, 24) || undefined;
        const r = canServe({ member: m, program, used, now: t, item });
        if (r.ok !== true) { const d = r as Exclude<typeof r, { ok: true }>; throw new ProgramError(d.message, 409, d.code === 'already' ? 'ALREADY' : 'DENIED'); }
        const use = await record(b.id, m, date, t, r.item, served, 'self');
        return { ok: true as const, item: r.item, useId: use.id, cardId: m.id };
      });
    },
    /** Takes back the customer's own tick, for a minute only (a wrong tap). Staff can still undo any tick for longer. */
    async selfUndo(slug: string, session: string, cardId: string, useId: string): Promise<{ ok: true }> {
      const b = await h.publicLive(slug); if (!b) throw new ProgramError('This page is not available.', 404, 'NOT_FOUND'); const me = await sessionOf(b.id, session);
      return withLock(`mem|${b.id}`, async () => {
        const m = (await membersOf(b.id)).find((x) => x.id === cardId && x.phone === me.phone); if (!m) throw new ProgramError('This card was not found.', 404, 'NOT_FOUND');
        const date = kigaliDate(h.now()); const served = await servedOn(b.id, date); const u = served.find((x) => x.id === useId && x.memberId === m.id && x.by === 'self' && !x.undone);
        if (!u) throw new ProgramError('That tick was not found.', 404, 'NOT_FOUND');
        if (h.now() - Date.parse(u.at) > SELF_UNDO_MS) throw new ProgramError('Too late to take it back. Ask the business.', 409, 'TOO_LATE');
        u.undone = true; await kv.put(k.served(b.id, date), { items: served });
        const own = (await kv.get<{ items: Use[] }>(k.uses(b.id, m.id)))?.items ?? []; const x = own.find((y) => y.id === useId); if (x) { x.undone = true; await kv.put(k.uses(b.id, m.id), { items: own }); }
        const all = await membersOf(b.id); const mm = all.find((y) => y.id === m.id); if (mm) { mm.used = Math.max(0, (mm.used ?? 0) - 1); await putMembers(b.id, all); }
        return { ok: true as const };
      });
    },
    /** The customer asks for a payment prompt on their phone (only when the owner takes online payments). */
    async payCard(slug: string, session: string, cardId: string, input: { phone?: unknown }, visitor: string): Promise<{ ok: true }> {
      const b = await h.publicLive(slug); if (!b) throw new ProgramError('This page is not available.', 404, 'NOT_FOUND'); const me = await sessionOf(b.id, session);
      if (h.tooMany(`planpay|${visitor}`, 6, h.now())) throw new ProgramError('Too many payment attempts. Please wait a little.', 429, 'RATE');
      return withLock(`mem|${b.id}`, async () => {
        const list = await membersOf(b.id); const m = list.find((x) => x.id === cardId && x.phone === me.phone); const p = m && (await programsOf(b.id)).find((x) => x.id === m.programId); if (!m || !p) throw new ProgramError('This card was not found.', 404, 'NOT_FOUND');
        if (m.paid) throw new ProgramError('This plan is already paid.', 409, 'PAID');
        if (!(await h.payReady(b))) throw new ProgramError('This business does not take online payments. Pay with MoMo or cash and tap "I have paid".', 409, 'NO_PAY');
        const e = await h.startPayment(b, { phone: String(input.phone ?? m.phone), amount: p.priceRwf, item: `Program: ${p.title}`, customer: m.name, src: 'page' });
        m.payRef = e.id; await putMembers(b.id, list); return { ok: true as const };
      });
    },
    /** "I have paid" (by MoMo code or cash): the owner is told, and confirms when the money is there. */
    async claimCard(slug: string, session: string, cardId: string, input: { ref?: unknown }, visitor: string): Promise<{ ok: true }> {
      const b = await h.publicLive(slug); if (!b) throw new ProgramError('This page is not available.', 404, 'NOT_FOUND'); const me = await sessionOf(b.id, session);
      if (h.tooMany(`claim|${visitor}`, 8, h.now())) throw new ProgramError('Too many tries. Please wait a little.', 429, 'RATE');
      return withLock(`mem|${b.id}`, async () => {
        const list = await membersOf(b.id); const m = list.find((x) => x.id === cardId && x.phone === me.phone); const p = m && (await programsOf(b.id)).find((x) => x.id === m.programId); if (!m || !p) throw new ProgramError('This card was not found.', 404, 'NOT_FOUND');
        if (m.paid) throw new ProgramError('This plan is already paid.', 409, 'PAID');
        const r = clean(input.ref, 40); m.claimed = { at: h.iso(), ...(r ? { ref: r } : {}) }; await putMembers(b.id, list);
        h.alert(b, { title: `Says paid · ${b.name}`, text: `${m.name} says they paid ${p.priceRwf.toLocaleString('en-US')} RWF for "${p.title}"${r ? ` (ref ${r})` : ''}. Check your MoMo and confirm.` });
        return { ok: true as const };
      });
    },
    /** The owner gives a customer who forgot their passcode a new temporary one (shown once to the owner, who tells the customer). */
    async resetPasscode(ownerId: string, id: string, memberId: string): Promise<{ passcode: string }> {
      const b = await h.mine(ownerId, id);
      return withLock(`mem|${b.id}`, async () => {
        const m = (await membersOf(b.id)).find((x) => x.id === memberId); if (!m) throw new ProgramError('That member was not found.', 404, 'NOT_FOUND');
        const people = await peopleOf(b.id); const pin = String(randomInt(1000, 10_000)); const salt = newSalt(); const hash = await hashPasscode(pin, salt); const existing = people.find((x) => x.phone === m.phone);
        if (existing) { existing.salt = salt; existing.hash = hash; existing.fails = 0; delete existing.lockedUntil; } else people.push({ phone: m.phone, salt, hash, fails: 0, createdAt: h.iso() });
        await putPeople(b.id, people); return { passcode: pin };
      });
    },
  };
}
export type Programs = ReturnType<typeof createPrograms>;
export type { DenyCode, PublicBusiness };

