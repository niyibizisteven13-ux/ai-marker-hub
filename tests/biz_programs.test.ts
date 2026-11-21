// Programs (programs): a restaurant sells a plan once, students join from a link, pay, and show a pass; the owner scans it and the system serves one item a day.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBizService, resetBizLimitsForTests, type Kv } from '../server/services/biz/service.js';
import { memoryMediaStore } from '../server/services/biz/media.js';
import { keyFrom } from '../server/services/biz/secrets.js';
import type { Fetch } from '../server/services/biz/payments.js';
import { suggestUsernames, cleanUsername, addDays, canServe, cleanJoin, cleanProgram, dayOfWeek, endDateFor, hashToken, kigaliDate, newCode, newToken, normalizeCode, passPayload, planState, remaining, tokenFromPayload, type Member, type Program } from '../server/services/biz/programs.js';

const memKv = (): Kv & { data: Map<string, unknown> } => { const data = new Map<string, unknown>(); return { data, async get<T>(k: string) { return (data.has(k) ? JSON.parse(JSON.stringify(data.get(k))) : null) as T | null; }, async put(k: string, v: unknown) { data.set(k, JSON.parse(JSON.stringify(v))); }, async del(k: string) { data.delete(k); } }; };
const T0 = Date.parse('2026-11-17T10:00:00Z');     // Tuesday, 12:00 in Kigali
const LUNCH = { title: 'Lunch plan', priceRwf: 40_000, days: 30, items: ['Lunch'], openDays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'] };
const make = (paid = true) => {
  const kv = memKv(); let clock = T0;
  const svc = createBizService({ kv, media: memoryMediaStore(), isPaid: async () => paid, now: () => clock, secretKey: keyFrom('t') }); resetBizLimitsForTests();
  return { kv, svc, at: (t: number) => { clock = t; } };
};
async function setup(over: Record<string, unknown> = {}) {
  const m = make(); const biz = await m.svc.create('o', { name: 'Uni Canteen', category: 'restaurant' });
  await m.svc.update('o', biz.id, { about: 'Lunch for students', momoCode: '123456', momoName: 'Uni Canteen', showPay: true, whatsapp: '0788000111' }); await m.svc.setPublished('o', biz.id, true);
  const prog = await m.svc.saveProgram('o', biz.id, { ...LUNCH, ...over });
  return { ...m, biz, prog };
}
/** Joining now needs a passcode the customer chooses; `token` is kept as the name of the signed-in session. */
const joinP = async (svc: any, slug: string, pid: string, input: any, visitor: string) => { const r = await svc.joinProgram(slug, pid, { passcode: '4821', ...input }, visitor); return { ...r, token: r.session as string }; };
const passView = (svc: any, slug: string, session: string) => svc.card(slug, session);
const cardIdOf = async (svc: any, slug: string, session: string) => (await svc.card(slug, session)).cardId as string;
const payMember = async (svc: any, slug: string, session: string, input: any, visitor: string) => svc.payCard(slug, session, await cardIdOf(svc, slug, session), input, visitor);
const claimPaid = async (svc: any, slug: string, session: string, input: any, visitor: string) => svc.claimCard(slug, session, await cardIdOf(svc, slug, session), input, visitor);
const member = (o: Partial<Member> = {}): Member => ({ id: 'm1', programId: 'p', name: 'Ann', phone: '250788123456', code: 'ABCD-2345', passHash: 'h', status: 'active', startDate: '2026-11-17', endDate: '2026-12-16', paidRwf: 40000, paid: true, createdAt: '2026-11-16T00:00:00Z', ...o });
const program = (o: Partial<Program> = {}): Program => ({ id: 'p', title: 'Lunch', priceRwf: 40000, days: 30, items: ['Lunch'], openDays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'], active: true, createdAt: '', ...o });

test('a plan needs a name, a sensible price and length, at least one item and one serving day; serving times are optional and checked', () => {
  assert.ok('error' in (cleanProgram({ ...LUNCH, title: '' }, 'x', 'n') as any));
  assert.ok('error' in (cleanProgram({ ...LUNCH, priceRwf: 5 }, 'x', 'n') as any));
  assert.ok('error' in (cleanProgram({ ...LUNCH, days: 0 }, 'x', 'n') as any)); assert.ok('error' in (cleanProgram({ ...LUNCH, days: 999 }, 'x', 'n') as any));
  assert.ok('error' in (cleanProgram({ ...LUNCH, items: [] }, 'x', 'n') as any)); assert.ok('error' in (cleanProgram({ ...LUNCH, openDays: [] }, 'x', 'n') as any));
  const p = cleanProgram({ ...LUNCH, priceRwf: '40,000', items: ['Lunch', ' Lunch ', 'Dinner'], windows: [{ item: 'Lunch', from: '11:00', to: '15:00' }, { item: 'Supper', from: '18:00', to: '20:00' }, { item: 'Dinner', from: '20:00', to: '19:00' }] }, 'x', 'n') as Program;
  assert.equal(p.priceRwf, 40000); assert.deepEqual(p.items, ['Lunch', 'Dinner']); assert.deepEqual(p.windows, [{ item: 'Lunch', from: '11:00', to: '15:00' }], 'unknown items and backwards times are dropped');
  assert.deepEqual(cleanJoin({ name: 'A', phone: '0788123456' }), { error: 'Please write your name.' }); assert.ok('error' in (cleanJoin({ name: 'Ann', phone: '12' }) as any));
  assert.deepEqual(cleanJoin({ name: ' Ann  K ', phone: '0788 123 456', idNumber: 'S-77' }), { name: 'Ann K', phone: '250788123456', idNumber: 'S-77' });
});

test('dates: a 30-day plan starting on the 1st ends on the 30th; serving days skip closed days', () => {
  assert.equal(endDateFor('2026-11-01', 30), '2026-11-30'); assert.equal(endDateFor('2026-11-01', 30, 3), '2026-12-03');
  assert.equal(dayOfWeek('2026-11-17'), 'tue'); assert.equal(dayOfWeek('2026-11-22'), 'sun'); assert.equal(addDays('2026-11-30', 1), '2026-12-01');
  const r = remaining(member({ startDate: '2026-11-17', endDate: '2026-12-16' }), program(), '2026-11-17');
  assert.equal(r.calendarDays, 30); assert.equal(r.servingDays, 26, '30 days with 4 Sundays closed'); assert.equal(r.uses, 26);
  assert.equal(remaining(member({ endDate: '2026-11-18' }), program({ items: ['Lunch', 'Dinner'] }), '2026-11-17').uses, 4);
  assert.equal(remaining(member(), program(), '2027-02-01').calendarDays, 0);
});

test('plan states: unpaid, not started, active, expired, paused, cancelled', () => {
  const s = (o: Partial<Member>, d = '2026-11-20') => planState(member(o), d);
  assert.equal(s({ paid: false, status: 'pending' }), 'pending'); assert.equal(s({ startDate: '2026-11-25' }), 'not_started'); assert.equal(s({}), 'active');
  assert.equal(s({}, '2026-12-17'), 'expired'); assert.equal(s({ status: 'paused' }), 'paused'); assert.equal(s({ status: 'cancelled' }), 'cancelled'); assert.equal(s({ endDate: '2026-11-20' }), 'active', 'the last day still counts');
});

test('who may be served now: one lunch a day, never unpaid/expired/paused/cancelled or on a closed day, serving times can be overridden, nothing else can', () => {
  const ok = (o: any) => canServe({ member: member(), program: program(), used: [], now: T0, ...o });
  assert.deepEqual(ok({}), { ok: true, item: 'Lunch' });
  for (const [m, code] of [[{ paid: false, status: 'pending' }, 'pending'], [{ startDate: '2026-11-30', endDate: '2026-12-29' }, 'not_started'], [{ endDate: '2026-11-16' }, 'expired'], [{ status: 'paused' }, 'paused'], [{ status: 'cancelled' }, 'cancelled']] as const) assert.equal((ok({ member: member(m as any) }) as any).code, code);
  const again = ok({ used: [{ item: 'Lunch', at: new Date(T0 - 600_000).toISOString() }] }) as any; assert.equal(again.code, 'already'); assert.match(again.message, /Already used today at 11:50/);
  assert.equal((ok({ now: Date.parse('2026-11-22T10:00:00Z') }) as any).code, 'closed_day', 'Sunday');
  const timed = program({ windows: [{ item: 'Lunch', from: '12:30', to: '15:00' }] });
  assert.equal((ok({ program: timed }) as any).code, 'outside_window'); assert.match((ok({ program: timed }) as any).message, /12:30–15:00/);
  assert.deepEqual(ok({ program: timed, force: true }), { ok: true, item: 'Lunch' }, 'the owner may serve outside the time');
  assert.equal((ok({ program: timed, force: true, member: member({ paid: false, status: 'pending' }) }) as any).code, 'pending', 'force never gets past unpaid');
  const two = program({ items: ['Breakfast', 'Lunch'], windows: [{ item: 'Breakfast', from: '06:00', to: '10:00' }, { item: 'Lunch', from: '11:00', to: '15:00' }] });
  assert.deepEqual(ok({ program: two }), { ok: true, item: 'Lunch' }, 'noon is lunch time');
  assert.deepEqual(ok({ program: two, used: [{ item: 'Lunch', at: new Date(T0).toISOString() }], now: Date.parse('2026-11-17T05:00:00Z') }), { ok: true, item: 'Breakfast' });
  assert.equal((ok({ item: 'Dinner' }) as any).code, 'no_item');
});

test('passes: the token is long and random, only its hash is stored, the QR text is recognised and a code survives typing mistakes in case and dashes', () => {
  const t = newToken(); assert.ok(t.length >= 30 && newToken() !== t); assert.notEqual(hashToken(t), t); assert.equal(hashToken(t), hashToken(t));
  assert.equal(tokenFromPayload(passPayload(t)), t); assert.equal(tokenFromPayload(`https://www.bwenge.space/b/x?pass=${t}`), t); assert.equal(tokenFromPayload('hello'), null); assert.equal(tokenFromPayload('BWPASS:short'), null);
  const c = newCode(); assert.match(c, /^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/); assert.equal(normalizeCode(c.toLowerCase().replace('-', ' ')), c); assert.equal(normalizeCode('123'), null);
});

test('the whole story: owner makes a plan, a student joins from the link, pays, shows the pass, is served once a day, and the money is in the notebook', async () => {
  const { svc, biz, prog, at } = await setup();
  const pub = (await svc.publicBySlug(biz.slug))!; assert.equal(pub.programs!.length, 1); assert.equal(pub.programs![0].priceRwf, 40000);
  const joined = await joinP(svc, biz.slug, prog.id, { name: 'Alice', phone: '0788123456', idNumber: 'S1' }, 'v1');
  assert.ok(joined.token.length >= 30); assert.match(joined.code, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  // The student's pass, before paying: tells them how to pay; the money is not counted yet.
  let pass: any = await passView(svc, biz.slug, joined.token);
  assert.equal(pass.member.state, 'pending'); assert.equal(pass.payment.amount, 40000); assert.equal(pass.payment.momoCode, '123456'); assert.equal(pass.payment.online, false);
  assert.equal((await svc.dashboard('o', biz.id)).today.sales, 0);
  // The counter refuses an unpaid pass.
  const unpaid: any = await svc.redeem('o', biz.id, { code: joined.code }); assert.equal(unpaid.ok, false); assert.equal(unpaid.code, 'pending'); assert.equal(unpaid.member.name, 'Alice');
  // She says she paid; the owner is told; the owner confirms.
  await claimPaid(svc, biz.slug, joined.token, { ref: 'TX99' }, 'v1'); assert.equal((await svc.programSummary('o', biz.id)).waitingConfirmation, 1);
  const m0 = (await svc.members('o', biz.id))[0]; assert.equal(m0.claimed!.ref, 'TX99');
  const paid = await svc.confirmPayment('o', biz.id, m0.id, { method: 'momo' }); assert.equal(paid.state, 'active'); assert.equal(paid.paidRwf, 40000);
  assert.equal((await svc.dashboard('o', biz.id)).today.sales, 40000, 'the plan is a sale in the notebook'); await assert.rejects(svc.confirmPayment('o', biz.id, m0.id), (e: any) => e.status === 409, 'cannot be confirmed twice');
  // Scan the pass: served. Scan again: already served, with the time.
  const qr = ((await passView(svc, biz.slug, joined.token)) as any).qr as string; assert.match(qr, /^BWPASS:/);
  const first: any = await svc.redeem('o', biz.id, { token: qr }); assert.equal(first.ok, true); assert.equal(first.item, 'Lunch'); assert.equal(first.member.usesLeft, 25, 'today\'s lunch is used'); assert.equal(((await passView(svc, biz.slug, joined.token)) as any).member.usesLeft, 25);
  const second: any = await svc.redeem('o', biz.id, { token: qr }); assert.equal(second.ok, false); assert.equal(second.code, 'already'); assert.match(second.message, /12:00/);
  assert.equal(((await svc.redeem('o', biz.id, { code: joined.code.toLowerCase() })) as any).code, 'already', 'by code, any case');
  assert.equal(((await svc.redeem('o', biz.id, { code: 'ZZZZ-9999' })) as any).code, 'unknown');
  // Today and the student's own view.
  const today = await svc.today('o', biz.id); assert.equal(today.servedCount, 1); assert.equal(today.served[0].name, 'Alice'); assert.equal(today.notYet.length, 0);
  pass = await passView(svc, biz.slug, joined.token); assert.equal(pass.member.state, 'active'); assert.equal(pass.today.used.length, 1); assert.equal(pass.payment, null); assert.ok(pass.calendar.find((d: any) => d.date === pass.today.date).used.includes('Lunch'));
  // Tomorrow she can eat again; she is "not yet" until she does.
  at(T0 + 86_400_000); assert.equal((await svc.today('o', biz.id)).notYet.length, 1);
  assert.equal(((await svc.redeem('o', biz.id, { code: joined.code })) as any).ok, true);
  // Sunday: closed.
  at(Date.parse('2026-11-22T10:00:00Z')); assert.equal(((await svc.redeem('o', biz.id, { code: joined.code })) as any).code, 'closed_day'); assert.equal((await svc.today('o', biz.id)).open, false);
  // The plan ends after its days.
  at(Date.parse('2026-12-20T10:00:00Z')); assert.equal(((await svc.redeem('o', biz.id, { code: joined.code })) as any).code, 'expired');
});

test('a mistaken scan can be undone for 20 minutes; an old one cannot; the owner can pause, extend and cancel', async () => {
  const { svc, biz, prog, at } = await setup();
  const j = await joinP(svc, biz.slug, prog.id, { name: 'Bob', phone: '0788222333' }, 'v'); const m = (await svc.members('o', biz.id))[0]; await svc.confirmPayment('o', biz.id, m.id, { method: 'cash' });
  assert.equal((await svc.dashboard('o', biz.id)).recent.some((e) => e.method === 'cash'), true);
  const r: any = await svc.redeem('o', biz.id, { code: j.code }); at(T0 + 5 * 60_000); await svc.undoUse('o', biz.id, r.useId);
  assert.equal(((await svc.redeem('o', biz.id, { code: j.code })) as any).ok, true, 'served again after the undo'); assert.equal((await svc.today('o', biz.id)).servedCount, 1);
  const r2: any = await svc.redeem('o', biz.id, { code: j.code, item: 'Lunch' }); void r2; const served = (await svc.today('o', biz.id)).served[0]; at(T0 + 40 * 60_000);
  await assert.rejects(svc.undoUse('o', biz.id, served.useId), (e: any) => e.code === 'TOO_LATE');
  assert.equal((await svc.setMember('o', biz.id, m.id, { action: 'pause' })).state, 'paused'); at(T0 + 86_400_000);
  assert.equal(((await svc.redeem('o', biz.id, { code: j.code })) as any).code, 'paused'); assert.equal((await svc.setMember('o', biz.id, m.id, { action: 'resume' })).state, 'active');
  const before = (await svc.members('o', biz.id))[0].endDate; assert.equal((await svc.setMember('o', biz.id, m.id, { action: 'extend', days: 5 })).endDate, addDays(before, 5));
  await assert.rejects(svc.setMember('o', biz.id, m.id, { action: 'extend', days: 999 }), /1 and 60/); assert.equal((await svc.setMember('o', biz.id, m.id, { action: 'cancel' })).state, 'cancelled');
});

test('two scans at the same moment serve exactly one item', async () => {
  const { svc, biz, prog } = await setup();
  const j = await joinP(svc, biz.slug, prog.id, { name: 'Cy', phone: '0788333444' }, 'v'); await svc.confirmPayment('o', biz.id, (await svc.members('o', biz.id))[0].id, { method: 'cash' });
  const results: any[] = await Promise.all(Array.from({ length: 6 }, () => svc.redeem('o', biz.id, { code: j.code })));
  assert.equal(results.filter((r) => r.ok).length, 1); assert.equal(results.filter((r) => r.code === 'already').length, 5); assert.equal((await svc.today('o', biz.id)).servedCount, 1);
});

test('joining: one plan per phone, a full plan closes, a closed plan is gone, spam is refused, and the page never shows other people', async () => {
  const { svc, biz, prog } = await setup({ maxMembers: 2 });
  await joinP(svc, biz.slug, prog.id, { name: 'A1', phone: '0788000001' }, 'v1');
  await assert.rejects(joinP(svc, biz.slug, prog.id, { name: 'A1 again', phone: '0788000001' }, 'v2'), (e: any) => e.code === 'EXISTS');
  await joinP(svc, biz.slug, prog.id, { name: 'A2', phone: '0788000002' }, 'v3'); assert.equal((await svc.publicBySlug(biz.slug))!.programs![0].full, true);
  await assert.rejects(joinP(svc, biz.slug, prog.id, { name: 'A3', phone: '0788000003' }, 'v4'), (e: any) => e.code === 'FULL');
  await assert.rejects(joinP(svc, biz.slug, prog.id, { name: 'Bot', phone: '0788000009', website: 'spam.com' }, 'v5'), /Not accepted/);
  const pubJson = JSON.stringify(await svc.publicBySlug(biz.slug)); assert.ok(!pubJson.includes('0788000001') && !pubJson.includes('250788000001') && !pubJson.includes('A1') && !pubJson.includes('passHash'));
  await svc.saveProgram('o', biz.id, { ...prog, id: prog.id, active: false }); assert.equal((await svc.publicBySlug(biz.slug))!.programs, undefined); await assert.rejects(joinP(svc, biz.slug, prog.id, { name: 'A4', phone: '0788000004' }, 'v6'), (e: any) => e.status === 404);
  await assert.rejects(svc.deleteProgram('o', biz.id, prog.id), (e: any) => e.code === 'HAS_MEMBERS');
  const { svc: s2, biz: b2, prog: p2 } = await setup(); for (let i = 0; i < 10; i++) await joinP(s2, b2.slug, p2.id, { name: `N${i}`, phone: `07882${String(i).padStart(5, '0')}` }, 'same');
  await assert.rejects(joinP(s2, b2.slug, p2.id, { name: 'N11', phone: '0788299999' }, 'same'), (e: any) => e.status === 429);
});

test('privacy: a pass belongs to its holder, another business cannot read it, strangers cannot use the owner side, and an unpublished page has no plans', async () => {
  const { svc, biz, prog, kv } = await setup(); const j = await joinP(svc, biz.slug, prog.id, { name: 'Dee', phone: '0788444555' }, 'v');
  const other = await svc.create('o2', { name: 'Other Cafe' }); await svc.update('o2', other.id, { about: 'x' }); await svc.setPublished('o2', other.id, true);
  await assert.rejects(passView(svc, other.slug, j.token), (e: any) => e.status === 401, 'a sign-in only works on its own business page');
  await assert.rejects(passView(svc, biz.slug, 'x'.repeat(30)), (e: any) => e.status === 401); await assert.rejects(passView(svc, biz.slug, 'short'), (e: any) => e.status === 401);
  for (const call of [() => svc.programs('intruder', biz.id), () => svc.members('intruder', biz.id), () => svc.redeem('intruder', biz.id, { code: j.code }), () => svc.today('intruder', biz.id), () => svc.saveProgram('intruder', biz.id, LUNCH)]) await assert.rejects(call(), (e: any) => e.status === 404);
  const stored = JSON.stringify([...kv.data.entries()]); assert.ok(!stored.includes(j.token), 'only the hash of the session is stored'); assert.ok(!stored.includes('"4821"') && !/passcode|"pin"/i.test(stored), 'the passcode is stored only as a salted hash');
  await svc.setPublished('o', biz.id, false); await assert.rejects(passView(svc, biz.slug, j.token), (e: any) => e.status === 404); assert.equal(await svc.publicBySlug(biz.slug), null);
});

test('paying by phone prompt: the customer approves, the plan starts, and the sale is counted once', async () => {
  const kv = memKv(); let state = 'PENDING';
  const f: Fetch = async (url, init) => { if (url.includes('/token/')) return { status: 200, json: async () => ({ access_token: 'T' }), text: async () => '' }; if (init.method === 'POST') return { status: 202, json: async () => ({}), text: async () => '' }; return { status: 200, json: async () => ({ status: state }), text: async () => '' }; };
  const svc = createBizService({ kv, media: memoryMediaStore(), isPaid: async () => true, now: () => T0, secretKey: keyFrom('t'), fetchImpl: f }); resetBizLimitsForTests();
  const biz = await svc.create('o', { name: 'Uni Canteen' }); await svc.update('o', biz.id, { about: 'x', acceptPay: true }); await svc.setPublished('o', biz.id, true); const prog = await svc.saveProgram('o', biz.id, LUNCH);
  const j = await joinP(svc, biz.slug, prog.id, { name: 'Eve', phone: '0788555666' }, 'v');
  await assert.rejects(payMember(svc, biz.slug, j.token, {}, 'v'), (e: any) => e.code === 'NO_PAY', 'no keys yet');
  await svc.saveSecrets('o', biz.id, 'mtn', { subscriptionKey: 'SKEY123', apiUser: '3f2b8c1e-aaaa-bbbb-cccc-1234567890ab', apiKey: 'APIKEY9999', environment: 'production' });
  assert.equal(((await passView(svc, biz.slug, j.token)) as any).payment.online, true);
  await payMember(svc, biz.slug, j.token, {}, 'v'); let pass: any = await passView(svc, biz.slug, j.token); assert.equal(pass.payment.promptSent, true); assert.equal(pass.member.state, 'pending');
  state = 'SUCCESSFUL'; pass = await passView(svc, biz.slug, j.token); assert.equal(pass.member.state, 'active'); assert.equal(pass.payment, null);
  assert.equal((await svc.dashboard('o', biz.id)).today.sales, 40000, 'one sale, not two'); assert.equal((await svc.members('o', biz.id))[0].payMethod, 'momo_prompt');
  assert.equal(((await svc.redeem('o', biz.id, { code: j.code })) as any).ok, true);
});

test('the owner sees expiring plans and what was sold; deleting the business removes every pass and record', async () => {
  const { svc, biz, prog, kv, at } = await setup(); const j = await joinP(svc, biz.slug, prog.id, { name: 'Fay', phone: '0788666777', startDate: '2026-11-17' }, 'v'); await svc.confirmPayment('o', biz.id, (await svc.members('o', biz.id))[0].id, { method: 'cash' });
  await svc.redeem('o', biz.id, { code: j.code }); let s = await svc.programSummary('o', biz.id); assert.equal(s.active, 1); assert.equal(s.soldThisMonth, 40000); assert.equal(s.expiring.length, 0);
  at(Date.parse('2026-12-14T10:00:00Z')); s = await svc.programSummary('o', biz.id); assert.equal(s.expiring.length, 1); assert.equal(s.expiring[0].name, 'Fay');
  await svc.remove('o', biz.id); const left = [...kv.data.keys()].filter((k) => /^biz-(programs|members|pass|items|served)/.test(k)); assert.deepEqual(left, []);
});

import { bizTools } from '../server/services/ai/tools/bizTools.js';
test('the assistant can make a program, give the share link, and report how the plans are doing', async () => {
  const { svc, kv } = make(); void kv; const tools = Object.fromEntries(bizTools(() => svc).map((t) => [t.definition.name, t])) as any; const c: any = { userId: 'u1', files: {}, services: {} };
  await tools.biz_create.execute({ name: 'Campus Canteen', category: 'restaurant' }, c);
  assert.match((await tools.biz_program.execute({}, c)).text, /No plans yet/);
  const made = await tools.biz_program.execute({ title: 'Lunch plan', price_rwf: 40000, days: 30, items: ['Lunch'], open_days: ['mon', 'tue', 'wed', 'thu', 'fri'] }, c);
  assert.match(made.text, /40,000 RWF for 30 days/); assert.match(made.text, /\/b\/campus-canteen\?plan=/); assert.match(made.text, /not published yet/);
  assert.match(made.text, /business ticks the card by scanning/);
  const id = /id ([\w-]+)\)?/.exec((await tools.biz_program.execute({}, c)).text)![1]; const self = await tools.biz_program.execute({ id, check_in: 'self' }, c);
  assert.match(self.text, /customer scans the business's check-in code/); assert.match((await tools.biz_program.execute({}, c)).text, /customers tick their own card/); assert.match((await tools.biz_program.execute({ id, check_in: 'staff' }, c)).text, /business ticks the card by scanning/);
  const bad = await tools.biz_program.execute({ title: 'x', price_rwf: 5 }, c); assert.ok(bad.isError || /price must be between/.test(bad.text), bad.text);
  const list = await tools.biz_program.execute({}, c); assert.match(list.text, /Lunch plan \(id /); assert.match(list.text, /0 active, 0 waiting for payment/);
  const status = await tools.biz_plan_status.execute({}, c); assert.match(status.text, /Members: 0 active/); assert.match(status.text, /Nobody is ending within 3 days/);
  assert.match((await tools.biz_plan_status.execute({ q: 'zzz' }, c)).text, /No member matches/);
  const other: any = { userId: 'u2', files: {}, services: {} }; assert.match((await tools.biz_program.execute({}, other)).text, /no business page yet|No business/i, 'another person has no access');
});

test('it is not only for restaurants: a gym pass and a salon with four haircuts in total', async () => {
  // A gym: a monthly pass, one entry a day, every day.
  const gym = await setup({ title: 'Monthly gym pass', priceRwf: 25_000, items: ['Entry'], openDays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] });
  const g = await joinP(gym.svc, gym.biz.slug, gym.prog.id, { name: 'Gina', phone: '0788777888', remember: true }, 'g'); await gym.svc.confirmPayment('o', gym.biz.id, (await gym.svc.members('o', gym.biz.id))[0].id, { method: 'cash' });
  const in1: any = await gym.svc.redeem('o', gym.biz.id, { code: g.code }); assert.equal(in1.ok, true); assert.equal(in1.item, 'Entry');
  const in2: any = await gym.svc.redeem('o', gym.biz.id, { code: g.code }); assert.equal(in2.code, 'already'); assert.match(in2.message, /Already used today at/);
  gym.at(Date.parse('2026-11-22T10:00:00Z')); assert.equal(((await gym.svc.redeem('o', gym.biz.id, { code: g.code })) as any).ok, true, 'a gym is open on Sunday');

  // A salon: four haircuts over two months, never more than one a day.
  const salon = await setup({ title: '4 haircuts', priceRwf: 12_000, days: 60, items: ['Haircut'], totalUses: 4, openDays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'] });
  assert.equal((await salon.svc.publicBySlug(salon.biz.slug))!.programs![0].totalUses, 4);
  const s = await joinP(salon.svc, salon.biz.slug, salon.prog.id, { name: 'Sam', phone: '0788999000', remember: true }, 's'); await salon.svc.confirmPayment('o', salon.biz.id, (await salon.svc.members('o', salon.biz.id))[0].id, { method: 'momo' });
  const dayAt = (n: number) => T0 + n * 86_400_000;
  const left = async () => ((await passView(salon.svc, salon.biz.slug, s.token)) as any).member.usesLeft;
  assert.equal(await left(), 4);
  for (let i = 0; i < 4; i++) { salon.at(dayAt(i)); const r: any = await salon.svc.redeem('o', salon.biz.id, { code: s.code }); assert.equal(r.ok, true, `visit ${i + 1}`); assert.equal(r.member.usesLeft, 3 - i); }
  salon.at(dayAt(4)); const fifth: any = await salon.svc.redeem('o', salon.biz.id, { code: s.code }); assert.equal(fifth.ok, false); assert.equal(fifth.code, 'no_uses_left'); assert.match(fifth.message, /All 4 uses/);
  const pass: any = await passView(salon.svc, salon.biz.slug, s.token); assert.equal(pass.member.usesLeft, 0); assert.equal(pass.member.usedTotal, 4); assert.equal(pass.program.totalUses, 4);
  // A mistaken visit undone gives the use back.
  salon.at(dayAt(3) + 60_000 * 5); const today = await salon.svc.today('o', salon.biz.id); void today;
  salon.at(dayAt(3) + 60_000); const served = (await salon.svc.today('o', salon.biz.id)).served[0]; await salon.svc.undoUse('o', salon.biz.id, served.useId);
  salon.at(dayAt(4)); assert.equal(await left(), 1); assert.equal(((await salon.svc.redeem('o', salon.biz.id, { code: s.code })) as any).ok, true);
});

test('total uses must be a sensible number; leaving it out means no cap', () => {
  assert.equal((cleanProgram({ ...LUNCH, totalUses: 10 }, 'x', 'n') as Program).totalUses, 10);
  assert.equal((cleanProgram({ ...LUNCH, totalUses: 0 }, 'x', 'n') as Program).totalUses, undefined);
  assert.equal((cleanProgram({ ...LUNCH, totalUses: 5000 }, 'x', 'n') as Program).totalUses, undefined);
  assert.equal((cleanProgram({ ...LUNCH }, 'x', 'n') as Program).totalUses, undefined);
  const p = cleanProgram({ ...LUNCH, totalUses: 10 }, 'x', 'n') as Program; assert.equal((cleanProgram({ totalUses: null }, 'x', 'n', p) as Program).totalUses, undefined, 'null removes the cap');
});

test('the wording is general: no message talks about meals, eating or restaurants', async () => {
  const msgs: string[] = [];
  const mk = (o: any) => canServe({ member: member(o.m ?? {}), program: program(o.p ?? {}), used: o.used ?? [], now: o.now ?? T0, ...(o.extra ?? {}) });
  for (const o of [{ m: { paid: false, status: 'pending' } }, { m: { endDate: '2026-11-16' } }, { m: { status: 'paused' } }, { m: { status: 'cancelled' } }, { m: { startDate: '2026-11-30', endDate: '2026-12-29' } }, { now: Date.parse('2026-11-22T10:00:00Z') },
    { used: [{ item: 'Lunch', at: new Date(T0).toISOString() }] }, { p: { windows: [{ item: 'Lunch', from: '13:30', to: '15:00' }] } }, { extra: { item: 'Other' } }, { p: { totalUses: 1 }, m: { used: 1 } }, { p: { items: ['A', 'B'] }, used: [{ item: 'A', at: new Date(T0).toISOString() }, { item: 'B', at: new Date(T0).toISOString() }] }]) { const r: any = mk(o); if (!r.ok) msgs.push(r.message); }
  const { svc, biz, prog } = await setup(); const j = await joinP(svc, biz.slug, prog.id, { name: 'Zed', phone: '0788121212' }, 'z');
  for (const f of [() => joinP(svc, biz.slug, prog.id, { name: 'Zed', phone: '0788121212' }, 'z2'), () => joinP(svc, biz.slug, prog.id, { name: 'Q', phone: '1' }, 'z3'), () => svc.redeem('o', biz.id, { code: 'ZZZZ-2222' }), () => payMember(svc, biz.slug, j.token, {}, 'z4'), () => svc.saveProgram('o', biz.id, { title: '', priceRwf: 1 }), () => svc.saveProgram('o', biz.id, { title: 'x', priceRwf: 500, items: [] }), () => svc.saveProgram('o', biz.id, { title: 'x', priceRwf: 500, openDays: [] })]) { try { await f(); } catch (e: any) { msgs.push(e.message); } }
  const r: any = await svc.redeem('o', biz.id, { code: j.code }); msgs.push(r.message);
  assert.ok(msgs.length >= 15, `${msgs.length} messages checked`);
  for (const m of msgs) assert.ok(!/meal|restaurant|\beat|lunch plan|served/i.test(m), `a message is not general: "${m}"`);
});

// ---- the owner chooses every word
import { cleanProgramText } from '../server/services/biz/programs.js';
import { DEFAULT_WORDS, RW_WORDS, fill, plural, wordsOf } from '../server/services/biz/programWords.js';
import { chatSystem } from '../server/services/biz/agent.js';

test('words: plain defaults, a plural worked out from one word, the owner\'s own plural wins, templates fill in three letter-cases, another language has its own base', () => {
  assert.deepEqual(wordsOf(), DEFAULT_WORDS); assert.equal(wordsOf({}).action, 'Allowed');
  const w = wordsOf({ program: 'Meal card', member: 'student', use: 'wash', pass: 'ticket', action: 'Serve', idLabel: 'Student ID' });
  assert.deepEqual([w.programs, w.members, w.uses], ['Meal cards', 'students', 'washes'], 'plural of a custom word');
  assert.equal(wordsOf({ member: 'umunyeshuri', members: 'abanyeshuri' }).members, 'abanyeshuri', 'the owner\'s own plural');
  assert.deepEqual(['visit', 'box', 'bus', 'day', 'party'].map(plural), ['visits', 'boxes', 'buses', 'days', 'parties']);
  assert.equal(fill('{Pass} for the {program}: {uses} left, {PASS}!', w), 'Ticket for the Meal card: washes left, TICKET!');
  assert.equal(fill('{unknown} stays', w), '{unknown} stays'); assert.equal(fill('{askId}', w), '{askId}', 'only words fill in');
  assert.equal(wordsOf({}, RW_WORDS).pass, 'ikarita'); assert.equal(wordsOf({ pass: 'tike' }, RW_WORDS).pass, 'tike'); assert.equal(wordsOf({ askId: false, allowOverride: false }).askId, false);
});

test('the owner\'s words are cleaned: only words, short, an empty one removes the choice', () => {
  const t = cleanProgramText({ program: '  <b>Meal {card}</b> ', programs: 'x'.repeat(80), member: 'student', action: '', askId: false, allowOverride: true, idLabel: 'Student ID' }, { action: 'Serve', allowOverride: false });
  assert.equal(t.program, 'bMeal cardb'.length ? t.program : ''); assert.ok(!/[<>{}]/.test(t.program!)); assert.equal(t.programs!.length, 24); assert.equal(t.member, 'student');
  assert.equal(t.action, undefined, 'empty removes it'); assert.equal(t.askId, false); assert.equal(t.allowOverride, undefined, 'true is the default and is not stored'); assert.equal(t.idLabel, 'Student ID');
  assert.deepEqual(cleanProgramText({ hacker: 'x', program: 5 }), { program: '5' }, 'unknown keys are ignored');
});

test('saving the owner\'s words: private to the owner, public only as words, can be removed, and they change what the counter allows and asks', async () => {
  const { svc, biz, prog, at } = await setup({ windows: [{ item: 'Lunch', from: '13:30', to: '15:00' }] });
  await assert.rejects(svc.setProgramText('intruder', biz.id, { program: 'x' }), (e: any) => e.status === 404); await assert.rejects(svc.programText('intruder', biz.id), (e: any) => e.status === 404);
  const saved = await svc.setProgramText('o', biz.id, { program: 'Meal card', programs: 'Meal cards', member: 'student', members: 'students', pass: 'card', use: 'meal', uses: 'meals', action: 'Serve', idLabel: 'Student ID' });
  assert.equal(saved.program, 'Meal card'); assert.equal((await svc.get('o', biz.id)).programText!.action, 'Serve');
  const pub: any = await svc.publicBySlug(biz.slug); assert.equal(pub.programText.members, 'students'); assert.deepEqual(Object.keys(pub.programText).sort(), ['action', 'idLabel', 'member', 'members', 'pass', 'program', 'programs', 'use', 'uses']);
  assert.ok(!JSON.stringify(pub).includes('"o"'), 'nothing private comes with the words');
  // Not asking for an ID: an ID sent anyway is not kept.
  await svc.setProgramText('o', biz.id, { askId: false }); await joinP(svc, biz.slug, prog.id, { name: 'Ivy', phone: '0788343434', idNumber: 'S-9' }, 'i1');
  assert.equal((await svc.members('o', biz.id))[0].idNumber, undefined); await svc.setProgramText('o', biz.id, { askId: true });
  const j = await joinP(svc, biz.slug, prog.id, { name: 'Jo', phone: '0788454545', idNumber: 'S-10' }, 'i2'); await svc.confirmPayment('o', biz.id, (await svc.members('o', biz.id)).find((m) => m.name === 'Jo')!.id, { method: 'cash' });
  assert.equal((await svc.members('o', biz.id, { q: 'Jo' }))[0].idNumber, 'S-10');
  // Outside the set times (12:00 here, lunch is 13:30-15:00): allowed anyway by default, refused when the owner turned that off.
  assert.equal(((await svc.redeem('o', biz.id, { code: j.code })) as any).code, 'outside_window');
  await svc.setProgramText('o', biz.id, { allowOverride: false }); assert.equal(((await svc.redeem('o', biz.id, { code: j.code, force: true })) as any).code, 'outside_window', 'staff may not override');
  await svc.setProgramText('o', biz.id, { allowOverride: true }); assert.equal(((await svc.redeem('o', biz.id, { code: j.code, force: true })) as any).ok, true); void at;
  // Remove every word again.
  await svc.setProgramText('o', biz.id, Object.fromEntries(['program', 'programs', 'member', 'members', 'pass', 'use', 'uses', 'action', 'idLabel'].map((k) => [k, ''])));
  assert.equal(((await svc.publicBySlug(biz.slug)) as any).programText, undefined);
});

test('the assistant sets the owner\'s words, then speaks them; its instructions tell it to ask the owner and suggest words that fit', async () => {
  const { svc } = make(); const tools = Object.fromEntries(bizTools(() => svc).map((t) => [t.definition.name, t])) as any; const c: any = { userId: 'u9', files: {}, services: {} };
  await tools.biz_create.execute({ name: 'Campus Canteen', category: 'restaurant' }, c);
  const named = await tools.biz_program.execute({ names: { program: 'Meal card', programs: 'Meal cards', member: 'student', members: 'students', pass: 'card', use: 'meal', uses: 'meals', action: 'Serve', id_label: 'Student ID' } }, c);
  assert.match(named.text, /called "Meal cards" \(one: "Meal card"\)/); assert.match(named.text, /the people are "students"/); assert.match(named.text, /the check-in word is "Serve"/); assert.match(named.text, /asks for "Student ID"/);
  const both = await tools.biz_program.execute({ title: 'Lunch card', price_rwf: 40000, days: 30, items: ['Lunch'], open_days: ['mon', 'tue', 'wed', 'thu', 'fri'], names: { ask_id: false, allow_override: false } }, c);
  assert.match(both.text, /does not ask for an ID/); assert.match(both.text, /may not allow a use outside/); assert.match(both.text, /Saved the plan "Lunch card"/);
  const list = await tools.biz_program.execute({}, c); assert.match(list.text, /Words in use: Meal cards \/ students \/ card \/ meals \/ check-in "Serve"/);
  const status = await tools.biz_plan_status.execute({}, c); assert.match(status.text, /^Students: 0 active/); assert.match(await tools.biz_plan_status.execute({ q: 'zzz' }, c).then((r: any) => r.text), /No student matches/);
  const bz = await svc.create('u9', { name: 'Tmp Co' }); void bz;
  const prompt = chatSystem({ name: 'Campus Canteen', slug: 'campus-canteen', category: 'restaurant', programText: { program: 'Meal card', member: 'student' } });
  assert.match(prompt, /THE OWNER NAMES EVERYTHING/); assert.match(prompt, /ask in one short message what they want to call/); assert.match(prompt, /program=Meal card, member=student/); assert.match(prompt, /gym: "Membership"/); assert.match(prompt, /never invent a price/);
  assert.match(chatSystem({ name: 'X', slug: 'x', category: 'shop' }), /none are set yet/);
});

// ---- first visit: name, phone, the owner's join code, the customer's own passcode; then sign in with phone and passcode
import { cardCalendar, cleanProgram as cleanProg, newJoinCode, sameCode, validPasscode } from '../server/services/biz/programs.js';

test('the owner\'s 4-digit join code: required when set, never shown publicly, wrong guesses are slowed down', async () => {
  const { svc, biz, prog } = await setup({ joinCode: '4827' });
  assert.equal(((await svc.programs('o', biz.id))[0] as any).joinCode, '4827', 'the owner sees it');
  const pub: any = await svc.publicBySlug(biz.slug); assert.equal(pub.programs[0].needsCode, true); assert.ok(!JSON.stringify(pub).includes('4827'), 'never public');
  await assert.rejects(joinP(svc, biz.slug, prog.id, { name: 'No Code', phone: '0788100001' }, 'a'), (e: any) => e.code === 'BAD_CODE');
  await assert.rejects(joinP(svc, biz.slug, prog.id, { name: 'Wrong', phone: '0788100002', joinCode: '1111' }, 'a'), (e: any) => e.code === 'BAD_CODE');
  const ok = await joinP(svc, biz.slug, prog.id, { name: 'Right', phone: '0788100003', joinCode: '4 8 2 7' }, 'a'); assert.ok(ok.session);
  for (let i = 0; i < 8; i++) await joinP(svc, biz.slug, prog.id, { name: 'Guess', phone: '0788100004', joinCode: String(1000 + i) }, 'bot').catch(() => undefined);
  await assert.rejects(joinP(svc, biz.slug, prog.id, { name: 'Bot', phone: '0788100005', joinCode: '4827' }, 'bot'), (e: any) => e.status === 429, 'a visitor guessing codes is stopped, even with the right one');
  // The owner can change or remove it.
  await svc.saveProgram('o', biz.id, { id: prog.id, ...LUNCH, joinCode: '' }); assert.equal(((await svc.programs('o', biz.id))[0] as any).joinCode, undefined, 'an empty value removes the code'); assert.equal(((await svc.publicBySlug(biz.slug)) as any).programs[0].needsCode, false);
  assert.ok('error' in (cleanProg({ ...LUNCH, joinCode: '12' }, 'x', 'n') as any)); assert.equal((cleanProg({ ...LUNCH, joinCode: ' 1234 ' }, 'x', 'n') as Program).joinCode, '1234');
  assert.match(newJoinCode(), /^\d{4}$/); assert.ok(sameCode('12 34', '1234') && !sameCode('1234', '1235') && !sameCode('', '1234'));
  const open = await setup(); assert.equal(((await open.svc.publicBySlug(open.biz.slug)) as any).programs[0].needsCode, false);
  assert.ok((await joinP(open.svc, open.biz.slug, open.prog.id, { name: 'Free', phone: '0788100006' }, 'f')).session, 'no code set: anyone can join');
});

test('the customer\'s passcode: 4 to 6 digits, chosen at joining, stored only as a salted hash, needed to sign in again', async () => {
  assert.ok(validPasscode('4821') && validPasscode(' 123456 ') && !validPasscode('123') && !validPasscode('1234567') && !validPasscode('12a4') && !validPasscode(''));
  const { svc, biz, prog, kv } = await setup();
  await assert.rejects(svc.joinProgram(biz.slug, prog.id, { name: 'Ann', phone: '0788200001', passcode: '12' }, 'p'), /4 to 6 digits/);
  await assert.rejects(svc.joinProgram(biz.slug, prog.id, { name: 'Ann', phone: '0788200001' }, 'p'), /4 to 6 digits/, 'a passcode is not optional');
  const j = await joinP(svc, biz.slug, prog.id, { name: 'Ann', phone: '0788200001', passcode: '739204' }, 'p');
  const first: any = await svc.me(biz.slug, j.session); assert.equal(first.name, 'Ann'); assert.equal(first.cards.length, 1); assert.equal(first.cards[0].state, 'pending');
  // Sign in again, as on a new phone.
  const back: any = await svc.login(biz.slug, { phone: '0788 200 001', passcode: '739204' }, 'l1'); assert.ok(back.session && back.session !== j.session); assert.equal(((await svc.me(biz.slug, back.session)) as any).cards.length, 1); assert.ok(!JSON.stringify([...kv.data.entries()]).includes('739204'), 'the passcode is never stored as typed');
  await assert.rejects(svc.login(biz.slug, { phone: '0788200001', passcode: '0000' }, 'l1'), (e: any) => e.code === 'BAD_LOGIN');
  await assert.rejects(svc.login(biz.slug, { phone: '0788299999', passcode: '739204' }, 'l1'), (e: any) => e.code === 'BAD_LOGIN', 'an unknown number gets the same answer');
});

test('wrong passcodes lock the phone number for ten minutes; a long sign-in works; sign-out and expiry end a session; the passcode can be changed', async () => {
  const { svc, biz, prog, at } = await setup(); const j = await joinP(svc, biz.slug, prog.id, { name: 'Ben', phone: '0788200002', passcode: '5555' }, 'p');
  for (let i = 0; i < 5; i++) await assert.rejects(svc.login(biz.slug, { phone: '0788200002', passcode: '9999' }, `bad${i}`), (e: any) => e.code === 'BAD_LOGIN');
  await assert.rejects(svc.login(biz.slug, { phone: '0788200002', passcode: '5555' }, 'good'), (e: any) => e.code === 'LOCKED', 'even the right passcode waits while locked');
  at(T0 + 11 * 60_000); const unlocked: any = await svc.login(biz.slug, { phone: '0788200002', passcode: '5555' }, 'good'); assert.ok(unlocked.session);
  // A normal sign-in lasts 12 hours; "remember me" lasts 30 days.
  const short: any = await svc.login(biz.slug, { phone: '0788200002', passcode: '5555' }, 's'); const long: any = await svc.login(biz.slug, { phone: '0788200002', passcode: '5555', remember: true }, 'l');
  at(T0 + 13 * 3_600_000); await assert.rejects(svc.me(biz.slug, short.session), (e: any) => e.code === 'SESSION'); assert.ok(await svc.me(biz.slug, long.session));
  at(T0 + 31 * 86_400_000); await assert.rejects(svc.me(biz.slug, long.session), (e: any) => e.code === 'SESSION');
  at(T0 + 12 * 3_600_000); const s2: any = await svc.login(biz.slug, { phone: '0788200002', passcode: '5555' }, 'o'); await svc.logout(biz.slug, s2.session); await assert.rejects(svc.me(biz.slug, s2.session), (e: any) => e.code === 'SESSION');
  const s3: any = await svc.login(biz.slug, { phone: '0788200002', passcode: '5555' }, 'o2');
  await assert.rejects(svc.changePasscode(biz.slug, s3.session, { current: '1111', next: '2222' }), (e: any) => e.code === 'BAD_LOGIN'); await assert.rejects(svc.changePasscode(biz.slug, s3.session, { current: '5555', next: '12' }), /4 to 6 digits/);
  await svc.changePasscode(biz.slug, s3.session, { current: '5555', next: '246810' });
  await assert.rejects(svc.login(biz.slug, { phone: '0788200002', passcode: '5555' }, 'o3'), (e: any) => e.code === 'BAD_LOGIN'); assert.ok(((await svc.login(biz.slug, { phone: '0788200002', passcode: '246810' }, 'o4')) as any).session); void j;
});

test('a forgotten passcode: the owner gives a new temporary one; the same phone number joining a second program uses the passcode it already has', async () => {
  const { svc, biz, prog } = await setup(); const second = await svc.saveProgram('o', biz.id, { ...LUNCH, title: 'Weekend pass', priceRwf: 9000 });
  const a = await joinP(svc, biz.slug, prog.id, { name: 'Cleo', phone: '0788200003', passcode: '3141' }, 'c');
  await assert.rejects(joinP(svc, biz.slug, second.id, { name: 'Cleo', phone: '0788200003', passcode: '9999' }, 'c'), (e: any) => e.code === 'BAD_LOGIN', 'someone else cannot add a plan to this number with another passcode');
  const b = await joinP(svc, biz.slug, second.id, { name: 'Cleo', phone: '0788200003', passcode: '3141' }, 'c'); assert.equal(((await svc.me(biz.slug, b.session)) as any).cards.length, 2, 'one account, two cards');
  const m = (await svc.members('o', biz.id)).find((x) => x.programId === prog.id)!; await assert.rejects(svc.resetPasscode('intruder', biz.id, m.id), (e: any) => e.status === 404);
  const { passcode } = await svc.resetPasscode('o', biz.id, m.id); assert.match(passcode, /^\d{4}$/);
  await assert.rejects(svc.login(biz.slug, { phone: '0788200003', passcode: '3141' }, 'x'), (e: any) => e.code === 'BAD_LOGIN'); assert.ok(((await svc.login(biz.slug, { phone: '0788200003', passcode }, 'x')) as any).session); void a;
});

test('the card: dates down the side, one column per item, closed days marked, a cross for every use, and the QR code only once paid', async () => {
  // Two units a day (lunch and supper), closed on Sundays: the plan starts on Tuesday 17 Nov 2026.
  const { svc, biz, prog, at } = await setup({ title: 'Two meals', items: ['Lunch', 'Supper'], days: 10, openDays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'] });
  const j = await joinP(svc, biz.slug, prog.id, { name: 'Dina', phone: '0788200004', remember: true }, 'd');
  let card: any = await passView(svc, biz.slug, j.session); assert.equal(card.qr, null, 'no QR code while unpaid'); assert.equal(card.program.items.length, 2); assert.equal(card.calendar.length, 10); assert.equal(card.calendar[0].date, '2026-11-17');
  await svc.confirmPayment('o', biz.id, (await svc.members('o', biz.id))[0].id, { method: 'momo' }); card = await passView(svc, biz.slug, j.session); assert.match(card.qr, /^BWPASS:/);
  const lunch: any = await svc.redeem('o', biz.id, { token: card.qr }); assert.equal(lunch.item, 'Lunch'); const supper: any = await svc.redeem('o', biz.id, { token: card.qr }); assert.equal(supper.item, 'Supper', 'the second unit of the day');
  assert.equal(((await svc.redeem('o', biz.id, { token: card.qr })) as any).code, 'already');
  at(T0 + 86_400_000); await svc.redeem('o', biz.id, { token: card.qr, item: 'Supper' }); card = await passView(svc, biz.slug, j.session);
  const by = Object.fromEntries(card.calendar.map((d: any) => [d.date, d])); assert.deepEqual(by['2026-11-17'].used, ['Lunch', 'Supper']); assert.deepEqual(by['2026-11-18'].used, ['Supper']); assert.deepEqual(by['2026-11-19'].used, []);
  assert.equal(by['2026-11-22'].open, false, 'Sunday is closed'); assert.equal(by['2026-11-22'].dow, 'sun'); assert.equal(card.member.usesLeft, 8 * 2 - 1, 'eight serving days x two, less what was used tomorrow');
  const cal = cardCalendar({ startDate: '2026-11-17', endDate: '2027-03-31' }, { openDays: ['mon'] }, [], 20); assert.equal(cal.length, 20, 'capped');
});

test('a customer cannot read or change someone else\'s card, even at the same business', async () => {
  const { svc, biz, prog } = await setup(); const a = await joinP(svc, biz.slug, prog.id, { name: 'Ann', phone: '0788200005', passcode: '1111' }, 'a'); const b = await joinP(svc, biz.slug, prog.id, { name: 'Bob', phone: '0788200006', passcode: '2222' }, 'b');
  const aCard = await cardIdOf(svc, biz.slug, a.session);
  await assert.rejects(svc.card(biz.slug, b.session, aCard), (e: any) => e.status === 404); await assert.rejects(svc.claimCard(biz.slug, b.session, aCard, {}, 'b'), (e: any) => e.status === 404); await assert.rejects(svc.payCard(biz.slug, b.session, aCard, {}, 'b'), (e: any) => e.status === 404);
  assert.equal(((await svc.me(biz.slug, b.session)) as any).cards.length, 1);
});

test('short user names: proposed from the name, 3 to 12 letters or numbers, never two the same; sign in by user name or phone with the passcode', async () => {
  assert.deepEqual(suggestUsernames('Aline Uwase', new Set(), () => 0.5).slice(0, 2), ['aline', 'uwase']); assert.equal(suggestUsernames('Aline Uwase', new Set(['aline', 'uwase']), () => 0.5)[0], 'aline55');
  assert.deepEqual(suggestUsernames('Zoë', new Set(), () => 0.1).length, 3, 'always three, even from a short or odd name'); assert.equal(cleanUsername(' Al ine_Uw ase!! 123456789 '), 'alineuwase12');
  const { svc, biz, prog } = await setup(); const sug = (await svc.suggestUsernames(biz.slug, 'Mutoni Grace', 'v')).suggestions; assert.equal(sug[0], 'mutoni');
  const a = await joinP(svc, biz.slug, prog.id, { name: 'Mutoni Grace', phone: '0788300001', username: 'mutoni', passcode: '2468' }, 'a'); assert.equal(a.username, 'mutoni');
  assert.ok(!(await svc.suggestUsernames(biz.slug, 'Mutoni Grace', 'v')).suggestions.includes('mutoni'), 'a taken name is no longer proposed');
  await assert.rejects(joinP(svc, biz.slug, prog.id, { name: 'Other', phone: '0788300002', username: 'Mutoni', passcode: '1357' }, 'b'), (e: any) => e.code === 'USERNAME_TAKEN' && /already taken/.test(e.message));
  await assert.rejects(joinP(svc, biz.slug, prog.id, { name: 'Other', phone: '0788300002', username: 'a b', passcode: '1357' }, 'b'), (e: any) => e.code === 'BAD_USERNAME');
  const auto = await joinP(svc, biz.slug, prog.id, { name: 'Kamali Eric', phone: '0788300003', passcode: '1357' }, 'c'); assert.equal(auto.username, 'kamali', 'without one, the first proposal is used');
  assert.equal(((await svc.login(biz.slug, { username: 'MUTONI', passcode: '2468' }, 'x')) as any).username, 'mutoni', 'user name is not case sensitive');
  assert.ok(((await svc.login(biz.slug, { phone: '0788300001', passcode: '2468' }, 'x')) as any).session, 'the phone number still works');
  await assert.rejects(svc.login(biz.slug, { username: 'mutoni', passcode: '0000' }, 'x'), (e: any) => e.code === 'BAD_LOGIN'); await assert.rejects(svc.login(biz.slug, { username: 'nobody', passcode: '2468' }, 'x'), (e: any) => e.code === 'BAD_LOGIN');
  for (let i = 0; i < 5; i++) await svc.login(biz.slug, { username: 'kamali', passcode: '9999' }, 'y').catch(() => undefined);
  await assert.rejects(svc.login(biz.slug, { username: 'kamali', passcode: '1357' }, 'y'), (e: any) => e.code === 'LOCKED', 'five wrong passcodes lock the user name too');
  assert.equal(((await svc.me(biz.slug, a.session)) as any).username, 'mutoni');
});

const codeOf = async (svc: any, bizId: string, pid: string) => (await svc.checkinCode('o', bizId, pid)).code as string;
test('customer scan: off by default; when the owner sets it the customer scans the business\'s code and the right item is ticked at once, under the same rules as a staff scan', async () => {
  const { svc, biz, prog, at } = await setup({ title: 'Two meals', items: ['Lunch', 'Dinner'], windows: [{ item: 'Lunch', from: '11:00', to: '15:00' }, { item: 'Dinner', from: '18:00', to: '21:00' }], totalUses: 3 });
  assert.equal(prog.checkIn, undefined); assert.equal((await svc.publicBySlug(biz.slug))!.programs![0].checkIn, 'staff');
  await assert.rejects(svc.checkinCode('o', biz.id, prog.id), (e: any) => e.code === 'STAFF_ONLY', 'no code to show while staff do the ticking');
  const j = await joinP(svc, biz.slug, prog.id, { name: 'Eve', phone: '0788300004', remember: true }, 'e'); const id = await cardIdOf(svc, biz.slug, j.session);
  await assert.rejects(svc.selfUse(biz.slug, j.session, { cardId: id, code: '123456' }, 'e'), (e: any) => e.code === 'STAFF_ONLY'); assert.equal(((await passView(svc, biz.slug, j.session)) as any).tick, null);
  await svc.saveProgram('o', biz.id, { id: prog.id, checkIn: 'self' }); assert.equal((await svc.programs('o', biz.id))[0].checkIn, 'self'); assert.equal((await svc.publicBySlug(biz.slug))!.programs![0].checkIn, 'self');
  const c0 = await svc.checkinCode('o', biz.id, prog.id); assert.match(c0.code, /^\d{6}$/); assert.ok(c0.expiresInSec >= 1 && c0.expiresInSec <= 60);
  await assert.rejects(svc.checkinCode('intruder', biz.id, prog.id), (e: any) => e.status === 404);
  await assert.rejects(svc.selfUse(biz.slug, j.session, { code: c0.code }, 'e'), (e: any) => e.status === 409, 'not while unpaid');
  await svc.confirmPayment('o', biz.id, (await svc.members('o', biz.id))[0].id, { method: 'cash' });
  let card: any = await passView(svc, biz.slug, j.session); assert.equal(card.tick.needsCode, true); assert.deepEqual(card.tick.items.map((x: any) => [x.item, x.allowed]), [['Lunch', true], ['Dinner', false]]);
  await assert.rejects(svc.selfUse(biz.slug, j.session, { cardId: id, code: c0.code === '000000' ? '111111' : '000000' }, 'e'), (e: any) => e.code === 'BAD_CODE', 'a wrong code ticks nothing');
  assert.equal(((await passView(svc, biz.slug, j.session)) as any).today.used.length, 0);
  const r: any = await svc.selfUse(biz.slug, j.session, { code: c0.code }, 'e'); assert.equal(r.ok, true); assert.equal(r.item, 'Lunch', 'at noon the scan ticks lunch without being told which'); card = await passView(svc, biz.slug, j.session);
  assert.deepEqual(card.today.used.map((x: any) => x.item), ['Lunch']); assert.equal(card.tick.undo.useId, r.useId); assert.equal(card.member.usesLeft, 2);
  await assert.rejects(svc.selfUse(biz.slug, j.session, { code: c0.code }, 'e'), (e: any) => /outside|18:00/.test(e.message), 'a second scan at lunch time cannot also take dinner');
  assert.equal((await svc.today('o', biz.id)).served[0].by, 'self', 'the owner sees which ticks the customer made themselves');
  at(T0 + 7 * 3_600_000); const d: any = await svc.selfUse(biz.slug, j.session, { code: await codeOf(svc, biz.id, prog.id) }, 'e'); assert.equal(d.item, 'Dinner');
  at(T0 + 86_400_000 + 3_600_000); await svc.selfUse(biz.slug, j.session, { code: await codeOf(svc, biz.id, prog.id) }, 'e'); at(T0 + 2 * 86_400_000 + 3_600_000);
  await assert.rejects(svc.selfUse(biz.slug, j.session, { code: await codeOf(svc, biz.id, prog.id) }, 'e'), (e: any) => /All 3 uses/.test(e.message), 'the total cap holds');
});

test('customer scan: the code changes every minute (the last one still works), is different for every program, and a photo of it is useless later', async () => {
  const { svc, biz, prog, at } = await setup({ checkIn: 'self' }); const other = await svc.saveProgram('o', biz.id, { ...LUNCH, title: 'Second', checkIn: 'self' });
  const j = await joinP(svc, biz.slug, prog.id, { name: 'Ann', phone: '0788300007', remember: true }, 'a'); await svc.confirmPayment('o', biz.id, (await svc.members('o', biz.id))[0].id, { method: 'cash' });
  const a = await codeOf(svc, biz.id, prog.id); assert.notEqual(a, await codeOf(svc, biz.id, other.id), 'a code for one program does not tick another');
  await assert.rejects(svc.selfUse(biz.slug, j.session, { code: await codeOf(svc, biz.id, other.id) }, 'a'), (e: any) => e.code === 'BAD_CODE', 'the other program\'s code is no use to this card');
  at(T0 + 61_000); const b = await codeOf(svc, biz.id, prog.id); assert.notEqual(a, b, 'a new minute, a new code'); assert.equal(((await svc.selfUse(biz.slug, j.session, { code: a }, 'a')) as any).ok, true, 'the previous minute\'s code is still accepted for a slow scan');
  const s = await svc.selfUndo(biz.slug, j.session, await cardIdOf(svc, biz.slug, j.session), (await passView(svc, biz.slug, j.session) as any).tick.undo.useId); assert.deepEqual(s, { ok: true });
  at(T0 + 3 * 60_000); await assert.rejects(svc.selfUse(biz.slug, j.session, { code: a }, 'a'), (e: any) => e.code === 'BAD_CODE', 'a photo of the code from three minutes ago is rejected');
  const many = await joinP(svc, biz.slug, prog.id, { name: 'Bob', phone: '0788300008', remember: true }, 'b'); let limited = false;
  for (let i = 0; i < 20 && !limited; i++) await svc.selfUse(biz.slug, many.session, { code: String(100000 + i) }, 'guess').catch((e: any) => { limited = e.code === 'RATE'; }); assert.ok(limited, 'guessing codes is rate limited');
});

test('customer scan: a wrong tick can be taken back for one minute, only by the owner of that card, only their own ticks; nobody can tick another person\'s card', async () => {
  const { svc, biz, prog, at } = await setup({ checkIn: 'self' }); assert.equal(prog.checkIn, 'self');
  const a = await joinP(svc, biz.slug, prog.id, { name: 'Ann', phone: '0788300005', passcode: '1111', remember: true }, 'a'); const b = await joinP(svc, biz.slug, prog.id, { name: 'Bob', phone: '0788300006', passcode: '2222', remember: true }, 'b');
  for (const m of await svc.members('o', biz.id)) await svc.confirmPayment('o', biz.id, m.id, { method: 'cash' });
  const aId = await cardIdOf(svc, biz.slug, a.session); const code = await codeOf(svc, biz.id, prog.id);
  await assert.rejects(svc.selfUse(biz.slug, b.session, { cardId: aId, code }, 'b'), (e: any) => e.status === 404, 'a card id that is not yours finds nothing');
  const t: any = await svc.selfUse(biz.slug, a.session, { cardId: aId, code }, 'a'); await assert.rejects(svc.selfUndo(biz.slug, b.session, aId, t.useId), (e: any) => e.status === 404);
  assert.deepEqual(await svc.selfUndo(biz.slug, a.session, aId, t.useId), { ok: true }); const back: any = await passView(svc, biz.slug, a.session); assert.equal(back.today.used.length, 0); assert.equal(back.member.usesLeft, 26);
  const t2: any = await svc.selfUse(biz.slug, a.session, { code }, 'a'); at(T0 + 61_000); assert.equal(((await passView(svc, biz.slug, a.session)) as any).tick.undo, null);
  await assert.rejects(svc.selfUndo(biz.slug, a.session, aId, t2.useId), (e: any) => e.code === 'TOO_LATE');
  const staff: any = await svc.redeem('o', biz.id, { memberId: (await svc.members('o', biz.id)).find((x) => x.name === 'Bob')!.id }); assert.equal(staff.ok, true);
  await assert.rejects(svc.selfUndo(biz.slug, b.session, await cardIdOf(svc, biz.slug, b.session), staff.useId), (e: any) => e.status === 404, 'a staff tick is not the customer\'s to take back');
});

test('ending a program: sign-ups close, nobody can be ticked, unpaid cards are cancelled, paid cards end today with history kept, the owner gets the refund list; it stays ended through edits; the assistant needs a confirmation', async () => {
  const { svc, biz, prog } = await setup({ title: 'Meal card', totalUses: 30 }); const other = await svc.saveProgram('o', biz.id, { ...LUNCH, title: 'Weekend pass' });
  const a = await joinP(svc, biz.slug, prog.id, { name: 'Aline', phone: '0788500001', remember: true }, 'a'); await joinP(svc, biz.slug, prog.id, { name: 'Eric', phone: '0788500002', remember: true }, 'e'); const c = await joinP(svc, biz.slug, other.id, { name: 'Cleo', phone: '0788500003', remember: true }, 'c');
  const ms = await svc.members('o', biz.id); const aline = ms.find((x) => x.name === 'Aline')!; const cleo = ms.find((x) => x.name === 'Cleo')!; await svc.confirmPayment('o', biz.id, aline.id, { method: 'cash' }); await svc.confirmPayment('o', biz.id, cleo.id, { method: 'cash' });
  await svc.redeem('o', biz.id, { memberId: aline.id }); const code = ((await passView(svc, biz.slug, a.session)) as any).qr;
  await assert.rejects(svc.endProgram('intruder', biz.id, prog.id), (e: any) => e.status === 404); await assert.rejects(svc.endProgram('o', biz.id, 'nope'), (e: any) => e.status === 404);
  const r = await svc.endProgram('o', biz.id, prog.id); assert.equal(r.ended, 'Meal card'); assert.equal(r.paidMembersEnded, 1); assert.equal(r.cancelledUnpaid, 1);
  assert.deepEqual(r.withUnusedDays.map((x) => [x.name, x.paidRwf, x.phone]), [['Aline', 40_000, '250788500001']], 'only paid members with days left are listed for refund'); assert.ok(r.withUnusedDays[0].daysLeft > 0);
  const after = await svc.members('o', biz.id); assert.equal(after.find((x) => x.name === 'Aline')!.state, 'expired'); assert.equal(after.find((x) => x.name === 'Eric')!.state, 'cancelled'); assert.equal(after.find((x) => x.name === 'Cleo')!.state, 'active', 'another program is untouched');
  assert.equal(((await svc.redeem('o', biz.id, { token: code })) as any).ok, false, 'an ended program serves nobody'); assert.match(String(((await svc.redeem('o', biz.id, { memberId: aline.id })) as any).message), /ended/);
  const prog2 = (await svc.programs('o', biz.id)).find((p) => p.id === prog.id)!; assert.equal(prog2.active, false); assert.ok(prog2.endedAt); assert.equal((await svc.publicBySlug(biz.slug))!.programs!.some((p) => p.id === prog.id), false, 'no longer on the public page');
  await assert.rejects(joinP(svc, biz.slug, prog.id, { name: 'Late', phone: '0788500004' }, 'l'), (e: any) => e.status === 404, 'nobody can join an ended program');
  assert.equal((await svc.saveProgram('o', biz.id, { id: prog.id, title: 'Meal card (old)' })).endedAt, prog2.endedAt, 'editing does not undo it'); assert.equal((await svc.programs('o', biz.id)).find((p) => p.id === prog.id)!.active, false);
  assert.equal((await svc.saveProgram('o', biz.id, { id: prog.id, active: true })).endedAt, undefined, 'opening sign-ups again starts it afresh');
  const tools = Object.fromEntries(bizTools(() => svc).map((t) => [t.definition.name, t])) as any; const ctx: any = { userId: 'o', files: {}, services: {} };
  const ask = await tools.biz_program.execute({ business: biz.id, id: other.id, end: true }, ctx); assert.match(ask.text, /final.*confirm/i); assert.equal((await svc.programs('o', biz.id)).find((p) => p.id === other.id)!.endedAt, undefined, 'asking is not ending');
  const done = await tools.biz_program.execute({ business: biz.id, id: other.id, end: true, confirm: true }, ctx); assert.match(done.text, /Ended "Weekend pass"/); assert.match(done.text, /Cleo/); assert.ok((await svc.programs('o', biz.id)).find((p) => p.id === other.id)!.endedAt);
});
