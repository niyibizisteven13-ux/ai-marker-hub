import { randomUUID } from 'node:crypto';
import { clean } from './model.js';
import type { Business, PublicBusiness } from './model.js';
import type { LedgerEntry } from './ledger.js';
import {
  MAX_MEMBERS, MAX_PROGRAMS, addDays, canServe, cleanJoin, cleanProgram, cleanStart, dayOfWeek, endDateFor, hashToken, kigaliDate, newCode, newToken, normalizeCode,
  oneOfMethod, planState, remaining, tokenFromPayload, usesLeft, type DenyCode, type Use, type Member, type PlanState, type Program,
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
  mine: (ownerId: string, id: string) => Promise<Business>;
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
  id: string; programId: string; programTitle: string; name: string; phone: string; studentId?: string; code: string; state: PlanState;
  startDate: string; endDate: string; paid: boolean; paidRwf: number; payMethod?: Member['payMethod']; claimed?: Member['claimed']; note?: string;
  servingDaysLeft: number; usesLeft: number; totalUses?: number; usedTotal?: number; usedToday: string[]; createdAt: string;
}
export interface PublicProgram { id: string; title: string; description?: string; priceRwf: number; days: number; items: string[]; openDays: Program['openDays']; windows?: Program['windows']; terms?: string; full: boolean }

export function createPrograms(h: Helpers) {
  const { kv } = h;
  const k = { programs: (b: string) => `biz-programs:${b}`, members: (b: string) => `biz-members:${b}`, pass: (hash: string) => `biz-pass:${hash}`, uses: (b: string, m: string) => `biz-uses:${b}:${m}`, served: (b: string, d: string) => `biz-served:${b}:${d}`, days: (b: string) => `biz-served-days:${b}` };
  const programsOf = async (bizId: string) => (await kv.get<{ items: Program[] }>(k.programs(bizId)))?.items ?? [];
  const membersOf = async (bizId: string) => (await kv.get<{ items: Member[] }>(k.members(bizId)))?.items ?? [];
  const putMembers = (bizId: string, items: Member[]) => kv.put(k.members(bizId), { items });
  const servedOn = async (bizId: string, date: string) => (await kv.get<{ items: Use[] }>(k.served(bizId, date)))?.items ?? [];
  const usedOf = (list: Use[], memberId: string) => list.filter((m) => m.memberId === memberId && !m.undone).sort((a, b) => a.at.localeCompare(b.at));

  function view(m: Member, p: Program | undefined, today: string, used: Use[] = []): MemberView {
    const r = p ? remaining(m, p, today) : { servingDays: 0, uses: 0 };
    return {
      id: m.id, programId: m.programId, programTitle: p?.title ?? '(removed plan)', name: m.name, phone: m.phone, ...(m.studentId ? { studentId: m.studentId } : {}), code: m.code, state: planState(m, today),
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
        return { ...p, counts: { active: mine.filter((m) => planState(m, today) === 'active').length, pending: mine.filter((m) => planState(m, today) === 'pending').length, total: mine.filter((m) => m.status !== 'cancelled').length } };
      });
    },
    async saveProgram(ownerId: string, id: string, input: any): Promise<Program> {
      const b = await h.mine(ownerId, id);
      return withLock(`prog|${b.id}`, async () => {
        const list = await programsOf(b.id); const prev = input?.id ? list.find((p) => p.id === String(input.id)) : undefined;
        if (input?.id && !prev) throw new ProgramError('That plan was not found.', 404, 'NOT_FOUND');
        if (!prev && list.length >= MAX_PROGRAMS) throw new ProgramError(`You can have up to ${MAX_PROGRAMS} plans.`, 409, 'LIMIT');
        const p = cleanProgram(input, prev?.id ?? randomUUID(), h.iso(), prev); if ('error' in p) throw new ProgramError(p.error);
        await kv.put(k.programs(b.id), { items: prev ? list.map((x) => (x.id === p.id ? p : x)) : [...list, p] });
        return p;
      });
    },
    async deleteProgram(ownerId: string, id: string, programId: string): Promise<void> {
      const b = await h.mine(ownerId, id);
      await withLock(`prog|${b.id}`, async () => {
        if ((await membersOf(b.id)).some((m) => m.programId === programId && m.status !== 'cancelled')) throw new ProgramError('This plan has members. Pause it instead (it stops taking new members) or cancel the members first.', 409, 'HAS_MEMBERS');
        await kv.put(k.programs(b.id), { items: (await programsOf(b.id)).filter((p) => p.id !== programId) });
      });
    },
    async members(ownerId: string, id: string, o: { programId?: string; state?: string; q?: string } = {}): Promise<MemberView[]> {
      const b = await h.mine(ownerId, id); const today = kigaliDate(h.now()); const progs = await programsOf(b.id); const served = await servedOn(b.id, today);
      const q = String(o.q ?? '').trim().toLowerCase();
      return (await membersOf(b.id)).filter((m) => (!o.programId || m.programId === o.programId) && (!q || m.name.toLowerCase().includes(q) || m.phone.includes(q.replace(/\D/g, '') || '\u0000') || m.code.toLowerCase().includes(q) || (m.studentId ?? '').toLowerCase().includes(q)))
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
    async redeem(ownerId: string, id: string, input: { token?: unknown; code?: unknown; memberId?: unknown; item?: unknown; force?: unknown }) {
      const b = await h.mine(ownerId, id);
      return withLock(`mem|${b.id}`, async () => {
        const m = await findMember(b.id, input); if (!m) return { ok: false as const, code: 'unknown' as const, message: 'This pass was not found. Check the code, or ask the customer to open their pass link.' };
        const p = (await programsOf(b.id)).find((x) => x.id === m.programId); if (!p) return { ok: false as const, code: 'unknown' as const, message: 'This plan no longer exists.' };
        const t = h.now(); const date = kigaliDate(t); const served = await servedOn(b.id, date); const used = usedOf(served, m.id);
        const r = canServe({ member: m, program: p, used, now: t, item: input.item === undefined || input.item === '' ? undefined : String(input.item), force: input.force === true });
        if (!r.ok) return { ...r, member: view(m, p, date, used) };
        const use: Use = { id: randomUUID(), memberId: m.id, date, item: r.item, at: new Date(t).toISOString(), by: tokenFromPayload(input.token) || typeof input.token === 'string' ? 'scan' : 'code' };
        await kv.put(k.served(b.id, date), { items: [...served, use] });
        const idx = (await kv.get<{ dates: string[] }>(k.days(b.id)))?.dates ?? []; if (!idx.includes(date)) await kv.put(k.days(b.id), { dates: [...idx, date].slice(-400) });
        const own = (await kv.get<{ items: Use[] }>(k.uses(b.id, m.id)))?.items ?? []; await kv.put(k.uses(b.id, m.id), { items: [...own, use].slice(-1500) });
        // The pass's running count (for programs with a total number of uses).
        const all = await membersOf(b.id); const mm = all.find((x) => x.id === m.id); if (mm) { mm.used = (mm.used ?? 0) + 1; m.used = mm.used; await putMembers(b.id, all); }
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
        served: served.slice().reverse().slice(0, 200).map((s) => ({ useId: s.id, memberId: s.memberId, name: byId.get(s.memberId)?.name ?? '', code: byId.get(s.memberId)?.code ?? '', item: s.item, at: s.at, canUndo: t - Date.parse(s.at) <= 20 * 60_000 })),
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
    async dropAll(b: Business): Promise<void> {
      const members = await membersOf(b.id);
      for (const m of members) { await kv.del(k.pass(m.passHash)); await kv.del(k.uses(b.id, m.id)); }
      for (const d of (await kv.get<{ dates: string[] }>(k.days(b.id)))?.dates ?? []) await kv.del(k.served(b.id, d));
      await kv.del(k.days(b.id)); await kv.del(k.members(b.id)); await kv.del(k.programs(b.id));
    },

    /* ---------------------------------------------------------------- public */
    async publicPrograms(b: Business): Promise<PublicProgram[]> {
      const members = await membersOf(b.id);
      return (await programsOf(b.id)).filter((p) => p.active).map((p) => ({
        id: p.id, title: p.title, ...(p.description ? { description: p.description } : {}), priceRwf: p.priceRwf, days: p.days, ...(p.totalUses ? { totalUses: p.totalUses } : {}), items: p.items, openDays: p.openDays, ...(p.windows ? { windows: p.windows } : {}), ...(p.terms ? { terms: p.terms } : {}),
        full: !!p.maxMembers && members.filter((m) => m.programId === p.id && m.status !== 'cancelled' && planState(m, kigaliDate(h.now())) !== 'expired').length >= p.maxMembers,
      }));
    },
    /** A customer joins from the shared link. They get a pass (waiting for payment) and pay next. */
    async joinProgram(slug: string, programId: string, input: { name?: unknown; phone?: unknown; studentId?: unknown; startDate?: unknown; website?: unknown }, visitor: string): Promise<{ token: string; code: string }> {
      if (clean(input.website, 40)) throw new ProgramError('Not accepted.');
      const b = await h.publicLive(slug); if (!b) throw new ProgramError('This page is not available.', 404, 'NOT_FOUND');
      if (h.tooMany(`join|${visitor}`, 6, h.now())) throw new ProgramError('Too many tries. Please wait a little and try again.', 429, 'RATE');
      const who = cleanJoin(input); if ('error' in who) throw new ProgramError(who.error);
      return withLock(`mem|${b.id}`, async () => {
        const p = (await programsOf(b.id)).find((x) => x.id === programId && x.active); if (!p) throw new ProgramError('This plan is not open.', 404, 'NOT_FOUND');
        const list = await membersOf(b.id); const today = kigaliDate(h.now());
        const live = list.filter((m) => m.programId === p.id && m.status !== 'cancelled' && planState(m, today) !== 'expired');
        if (live.some((m) => m.phone === who.phone)) throw new ProgramError('This phone number already has this plan. Ask the business to send you your pass link.', 409, 'EXISTS');
        if (p.maxMembers && live.length >= p.maxMembers) throw new ProgramError('This plan is full.', 409, 'FULL');
        if (list.length >= MAX_MEMBERS) throw new ProgramError('This business cannot take more members right now.', 409, 'LIMIT');
        const token = newToken(); let code = newCode(); while (list.some((m) => m.code === code)) code = newCode();
        const start = cleanStart(input.startDate, today);
        const m: Member = { id: randomUUID(), programId: p.id, name: who.name, phone: who.phone, ...(who.studentId ? { studentId: who.studentId } : {}), code, passHash: hashToken(token), status: 'pending', startDate: start, endDate: endDateFor(start, p.days), paidRwf: 0, paid: false, createdAt: h.iso() };
        await putMembers(b.id, [...list, m]); await kv.put(k.pass(m.passHash), { bizId: b.id, memberId: m.id });
        h.alert(b, { title: `New plan member · ${b.name}`, text: `${m.name} joined "${p.title}" (${p.priceRwf.toLocaleString('en-US')} RWF). Waiting for payment.` });
        return { token, code };
      });
    },
    async passView(slug: string, token: string) {
      const b = await h.publicLive(slug); if (!b) throw new ProgramError('This page is not available.', 404, 'NOT_FOUND');
      if (!/^[A-Za-z0-9_-]{20,64}$/.test(String(token))) throw new ProgramError('This pass was not found.', 404, 'NOT_FOUND');
      return withLock(`mem|${b.id}`, async () => {
        const ref = await kv.get<{ bizId: string; memberId: string }>(k.pass(hashToken(token))); if (!ref || ref.bizId !== b.id) throw new ProgramError('This pass was not found.', 404, 'NOT_FOUND');
        const list = await membersOf(b.id); const m = list.find((x) => x.id === ref.memberId); const p = m && (await programsOf(b.id)).find((x) => x.id === m.programId);
        if (!m || !p) throw new ProgramError('This pass was not found.', 404, 'NOT_FOUND');
        // A payment prompt that was approved on the phone: settle it now (the customer's screen asks about it while waiting).
        let prompt = false;
        if (!m.paid && m.payRef) {
          const e = await h.settle(b, m.payRef);
          if (e?.pay?.state === 'success') { await activate(b, p, m, 'momo_prompt', e.id); await putMembers(b.id, list); h.alert(b, { title: `Plan paid · ${b.name}`, text: `${m.name} paid ${p.priceRwf.toLocaleString('en-US')} RWF for "${p.title}".` }); }
          else if (e?.pay?.state === 'failed') { delete m.payRef; await putMembers(b.id, list); } else prompt = true;
        }
        const t = h.now(); const date = kigaliDate(t); const own = ((await kv.get<{ items: Use[] }>(k.uses(b.id, m.id)))?.items ?? []).filter((x) => !x.undone);
        const byDate = new Map<string, string[]>(); for (const x of own.slice(-120)) byDate.set(x.date, [...(byDate.get(x.date) ?? []), x.item]);
        const r = remaining(m, p, date); const st = planState(m, date); const ateToday = own.filter((x) => x.date === date).length;
        return {
          business: { name: b.name, slug: b.slug, theme: b.theme },
          program: { title: p.title, ...(p.totalUses ? { totalUses: p.totalUses } : {}), items: p.items, openDays: p.openDays, ...(p.windows ? { windows: p.windows } : {}), ...(p.terms ? { terms: p.terms } : {}), priceRwf: p.priceRwf },
          member: { name: m.name, code: m.code, state: st, startDate: m.startDate, endDate: m.endDate, daysLeft: r.calendarDays, servingDaysLeft: Math.max(0, r.servingDays - (ateToday >= p.items.length ? 1 : 0)), usesLeft: usesLeft(m, p, r.uses, ateToday), usedTotal: m.used ?? 0, paid: m.paid },
          today: { date, openToday: p.openDays.includes(dayOfWeek(date)), used: own.filter((x) => x.date === date).map((x) => ({ item: x.item, at: x.at })) },
          history: [...byDate.entries()].slice(-31).map(([d, items]) => ({ date: d, items })),
          payment: m.paid ? null : {
            amount: p.priceRwf, momoCode: b.showPay ? b.momoCode ?? null : null, momoName: b.showPay ? b.momoName ?? null : null, online: await h.payReady(b), promptSent: prompt, claimed: m.claimed ?? null,
            whatsapp: b.whatsapp ?? null,
          },
        };
      });
    },
    /** The customer asks for a payment prompt on their phone (only when the owner takes online payments). */
    async payMember(slug: string, token: string, input: { phone?: unknown }, visitor: string): Promise<{ ok: true }> {
      const b = await h.publicLive(slug); if (!b) throw new ProgramError('This page is not available.', 404, 'NOT_FOUND');
      if (h.tooMany(`planpay|${visitor}`, 6, h.now())) throw new ProgramError('Too many payment attempts. Please wait a little.', 429, 'RATE');
      return withLock(`mem|${b.id}`, async () => {
        const ref = await kv.get<{ bizId: string; memberId: string }>(k.pass(hashToken(String(token)))); if (!ref || ref.bizId !== b.id) throw new ProgramError('This pass was not found.', 404, 'NOT_FOUND');
        const list = await membersOf(b.id); const m = list.find((x) => x.id === ref.memberId); const p = m && (await programsOf(b.id)).find((x) => x.id === m.programId); if (!m || !p) throw new ProgramError('This pass was not found.', 404, 'NOT_FOUND');
        if (m.paid) throw new ProgramError('This plan is already paid.', 409, 'PAID');
        if (!(await h.payReady(b))) throw new ProgramError('This business does not take online payments. Pay with MoMo or cash and tap "I have paid".', 409, 'NO_PAY');
        const e = await h.startPayment(b, { phone: String(input.phone ?? m.phone), amount: p.priceRwf, item: `Program: ${p.title}`, customer: m.name, src: 'page' });
        m.payRef = e.id; await putMembers(b.id, list); return { ok: true as const };
      });
    },
    /** "I have paid" (by MoMo code or cash): the owner is told, and confirms when the money is there. */
    async claimPaid(slug: string, token: string, input: { ref?: unknown }, visitor: string): Promise<{ ok: true }> {
      const b = await h.publicLive(slug); if (!b) throw new ProgramError('This page is not available.', 404, 'NOT_FOUND');
      if (h.tooMany(`claim|${visitor}`, 8, h.now())) throw new ProgramError('Too many tries. Please wait a little.', 429, 'RATE');
      return withLock(`mem|${b.id}`, async () => {
        const ref = await kv.get<{ bizId: string; memberId: string }>(k.pass(hashToken(String(token)))); if (!ref || ref.bizId !== b.id) throw new ProgramError('This pass was not found.', 404, 'NOT_FOUND');
        const list = await membersOf(b.id); const m = list.find((x) => x.id === ref.memberId); const p = m && (await programsOf(b.id)).find((x) => x.id === m.programId); if (!m || !p) throw new ProgramError('This pass was not found.', 404, 'NOT_FOUND');
        if (m.paid) throw new ProgramError('This plan is already paid.', 409, 'PAID');
        const r = clean(input.ref, 40); m.claimed = { at: h.iso(), ...(r ? { ref: r } : {}) }; await putMembers(b.id, list);
        h.alert(b, { title: `Says paid · ${b.name}`, text: `${m.name} says they paid ${p.priceRwf.toLocaleString('en-US')} RWF for "${p.title}"${r ? ` (ref ${r})` : ''}. Check your MoMo and confirm.` });
        return { ok: true as const };
      });
    },
  };
}
export type Programs = ReturnType<typeof createPrograms>;
export type { DenyCode, PublicBusiness };
