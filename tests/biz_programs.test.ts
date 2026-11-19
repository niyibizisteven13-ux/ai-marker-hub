// Meal plans (programs): a restaurant sells a plan once, students join from a link, pay, and show a pass; the owner scans it and the system serves one meal a day.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBizService, resetBizLimitsForTests, type Kv } from '../server/services/biz/service.js';
import { memoryMediaStore } from '../server/services/biz/media.js';
import { keyFrom } from '../server/services/biz/secrets.js';
import type { Fetch } from '../server/services/biz/payments.js';
import { addDays, canServe, cleanJoin, cleanProgram, dayOfWeek, endDateFor, hashToken, kigaliDate, newCode, newToken, normalizeCode, passPayload, planState, remaining, tokenFromPayload, type Member, type Program } from '../server/services/biz/programs.js';

const memKv = (): Kv & { data: Map<string, unknown> } => { const data = new Map<string, unknown>(); return { data, async get<T>(k: string) { return (data.has(k) ? JSON.parse(JSON.stringify(data.get(k))) : null) as T | null; }, async put(k: string, v: unknown) { data.set(k, JSON.parse(JSON.stringify(v))); }, async del(k: string) { data.delete(k); } }; };
const T0 = Date.parse('2026-11-17T10:00:00Z');     // Tuesday, 12:00 in Kigali
const LUNCH = { title: 'Lunch plan', priceRwf: 40_000, days: 30, meals: ['Lunch'], openDays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'] };
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
const member = (o: Partial<Member> = {}): Member => ({ id: 'm1', programId: 'p', name: 'Ann', phone: '250788123456', code: 'ABCD-2345', passHash: 'h', status: 'active', startDate: '2026-11-17', endDate: '2026-12-16', paidRwf: 40000, paid: true, createdAt: '2026-11-16T00:00:00Z', ...o });
const program = (o: Partial<Program> = {}): Program => ({ id: 'p', title: 'Lunch', priceRwf: 40000, days: 30, meals: ['Lunch'], openDays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'], active: true, createdAt: '', ...o });

test('a plan needs a name, a sensible price and length, at least one meal and one serving day; serving times are optional and checked', () => {
  assert.ok('error' in (cleanProgram({ ...LUNCH, title: '' }, 'x', 'n') as any));
  assert.ok('error' in (cleanProgram({ ...LUNCH, priceRwf: 5 }, 'x', 'n') as any));
  assert.ok('error' in (cleanProgram({ ...LUNCH, days: 0 }, 'x', 'n') as any)); assert.ok('error' in (cleanProgram({ ...LUNCH, days: 999 }, 'x', 'n') as any));
  assert.ok('error' in (cleanProgram({ ...LUNCH, meals: [] }, 'x', 'n') as any)); assert.ok('error' in (cleanProgram({ ...LUNCH, openDays: [] }, 'x', 'n') as any));
  const p = cleanProgram({ ...LUNCH, priceRwf: '40,000', meals: ['Lunch', ' Lunch ', 'Dinner'], windows: [{ meal: 'Lunch', from: '11:00', to: '15:00' }, { meal: 'Supper', from: '18:00', to: '20:00' }, { meal: 'Dinner', from: '20:00', to: '19:00' }] }, 'x', 'n') as Program;
  assert.equal(p.priceRwf, 40000); assert.deepEqual(p.meals, ['Lunch', 'Dinner']); assert.deepEqual(p.windows, [{ meal: 'Lunch', from: '11:00', to: '15:00' }], 'unknown meals and backwards times are dropped');
  assert.deepEqual(cleanJoin({ name: 'A', phone: '0788123456' }), { error: 'Please write your name.' }); assert.ok('error' in (cleanJoin({ name: 'Ann', phone: '12' }) as any));
  assert.deepEqual(cleanJoin({ name: ' Ann  K ', phone: '0788 123 456', studentId: 'S-77' }), { name: 'Ann K', phone: '250788123456', studentId: 'S-77' });
});

test('dates: a 30-day plan starting on the 1st ends on the 30th; serving days skip closed days', () => {
  assert.equal(endDateFor('2026-11-01', 30), '2026-11-30'); assert.equal(endDateFor('2026-11-01', 30, 3), '2026-12-03');
  assert.equal(dayOfWeek('2026-11-17'), 'tue'); assert.equal(dayOfWeek('2026-11-22'), 'sun'); assert.equal(addDays('2026-11-30', 1), '2026-12-01');
  const r = remaining(member({ startDate: '2026-11-17', endDate: '2026-12-16' }), program(), '2026-11-17');
  assert.equal(r.calendarDays, 30); assert.equal(r.servingDays, 26, '30 days with 4 Sundays closed'); assert.equal(r.meals, 26);
  assert.equal(remaining(member({ endDate: '2026-11-18' }), program({ meals: ['Lunch', 'Dinner'] }), '2026-11-17').meals, 4);
  assert.equal(remaining(member(), program(), '2027-02-01').calendarDays, 0);
});

test('plan states: unpaid, not started, active, expired, paused, cancelled', () => {
  const s = (o: Partial<Member>, d = '2026-11-20') => planState(member(o), d);
  assert.equal(s({ paid: false, status: 'pending' }), 'pending'); assert.equal(s({ startDate: '2026-11-25' }), 'not_started'); assert.equal(s({}), 'active');
  assert.equal(s({}, '2026-12-17'), 'expired'); assert.equal(s({ status: 'paused' }), 'paused'); assert.equal(s({ status: 'cancelled' }), 'cancelled'); assert.equal(s({ endDate: '2026-11-20' }), 'active', 'the last day still counts');
});

test('who may be served now: one lunch a day, never unpaid/expired/paused/cancelled or on a closed day, serving times can be overridden, nothing else can', () => {
  const ok = (o: any) => canServe({ member: member(), program: program(), eaten: [], now: T0, ...o });
  assert.deepEqual(ok({}), { ok: true, meal: 'Lunch' });
  for (const [m, code] of [[{ paid: false, status: 'pending' }, 'pending'], [{ startDate: '2026-11-30', endDate: '2026-12-29' }, 'not_started'], [{ endDate: '2026-11-16' }, 'expired'], [{ status: 'paused' }, 'paused'], [{ status: 'cancelled' }, 'cancelled']] as const) assert.equal((ok({ member: member(m as any) }) as any).code, code);
  const again = ok({ eaten: [{ meal: 'Lunch', at: new Date(T0 - 600_000).toISOString() }] }) as any; assert.equal(again.code, 'already'); assert.match(again.message, /Already served today at 11:50/);
  assert.equal((ok({ now: Date.parse('2026-11-22T10:00:00Z') }) as any).code, 'closed_day', 'Sunday');
  const timed = program({ windows: [{ meal: 'Lunch', from: '12:30', to: '15:00' }] });
  assert.equal((ok({ program: timed }) as any).code, 'outside_window'); assert.match((ok({ program: timed }) as any).message, /12:30–15:00/);
  assert.deepEqual(ok({ program: timed, force: true }), { ok: true, meal: 'Lunch' }, 'the owner may serve outside the time');
  assert.equal((ok({ program: timed, force: true, member: member({ paid: false, status: 'pending' }) }) as any).code, 'pending', 'force never gets past unpaid');
  const two = program({ meals: ['Breakfast', 'Lunch'], windows: [{ meal: 'Breakfast', from: '06:00', to: '10:00' }, { meal: 'Lunch', from: '11:00', to: '15:00' }] });
  assert.deepEqual(ok({ program: two }), { ok: true, meal: 'Lunch' }, 'noon is lunch time');
  assert.deepEqual(ok({ program: two, eaten: [{ meal: 'Lunch', at: new Date(T0).toISOString() }], now: Date.parse('2026-11-17T05:00:00Z') }), { ok: true, meal: 'Breakfast' });
  assert.equal((ok({ meal: 'Dinner' }) as any).code, 'no_meal');
});

test('passes: the token is long and random, only its hash is stored, the QR text is recognised and a code survives typing mistakes in case and dashes', () => {
  const t = newToken(); assert.ok(t.length >= 30 && newToken() !== t); assert.notEqual(hashToken(t), t); assert.equal(hashToken(t), hashToken(t));
  assert.equal(tokenFromPayload(passPayload(t)), t); assert.equal(tokenFromPayload(`https://www.bwenge.space/b/x?pass=${t}`), t); assert.equal(tokenFromPayload('hello'), null); assert.equal(tokenFromPayload('BWPASS:short'), null);
  const c = newCode(); assert.match(c, /^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/); assert.equal(normalizeCode(c.toLowerCase().replace('-', ' ')), c); assert.equal(normalizeCode('123'), null);
});

test('the whole story: owner makes a plan, a student joins from the link, pays, shows the pass, is served once a day, and the money is in the notebook', async () => {
  const { svc, biz, prog, at } = await setup();
  const pub = (await svc.publicBySlug(biz.slug))!; assert.equal(pub.programs!.length, 1); assert.equal(pub.programs![0].priceRwf, 40000);
  const joined = await svc.joinProgram(biz.slug, prog.id, { name: 'Alice', phone: '0788123456', studentId: 'S1' }, 'v1');
  assert.ok(joined.token.length >= 30); assert.match(joined.code, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  // The student's pass, before paying: tells them how to pay; the money is not counted yet.
  let pass: any = await svc.passView(biz.slug, joined.token);
  assert.equal(pass.member.state, 'pending'); assert.equal(pass.payment.amount, 40000); assert.equal(pass.payment.momoCode, '123456'); assert.equal(pass.payment.online, false);
  assert.equal((await svc.dashboard('o', biz.id)).today.sales, 0);
  // The counter refuses an unpaid pass.
  const unpaid: any = await svc.redeem('o', biz.id, { code: joined.code }); assert.equal(unpaid.ok, false); assert.equal(unpaid.code, 'pending'); assert.equal(unpaid.member.name, 'Alice');
  // She says she paid; the owner is told; the owner confirms.
  await svc.claimPaid(biz.slug, joined.token, { ref: 'TX99' }, 'v1'); assert.equal((await svc.programSummary('o', biz.id)).waitingConfirmation, 1);
  const m0 = (await svc.members('o', biz.id))[0]; assert.equal(m0.claimed!.ref, 'TX99');
  const paid = await svc.confirmPayment('o', biz.id, m0.id, { method: 'momo' }); assert.equal(paid.state, 'active'); assert.equal(paid.paidRwf, 40000);
  assert.equal((await svc.dashboard('o', biz.id)).today.sales, 40000, 'the plan is a sale in the notebook'); await assert.rejects(svc.confirmPayment('o', biz.id, m0.id), (e: any) => e.status === 409, 'cannot be confirmed twice');
  // Scan the pass: served. Scan again: already served, with the time.
  const first: any = await svc.redeem('o', biz.id, { token: passPayload(joined.token) }); assert.equal(first.ok, true); assert.equal(first.meal, 'Lunch'); assert.equal(first.member.mealsLeft, 25, 'today\'s lunch is used'); assert.equal(((await svc.passView(biz.slug, joined.token)) as any).member.mealsLeft, 25);
  const second: any = await svc.redeem('o', biz.id, { token: passPayload(joined.token) }); assert.equal(second.ok, false); assert.equal(second.code, 'already'); assert.match(second.message, /12:00/);
  assert.equal(((await svc.redeem('o', biz.id, { code: joined.code.toLowerCase() })) as any).code, 'already', 'by code, any case');
  assert.equal(((await svc.redeem('o', biz.id, { code: 'ZZZZ-9999' })) as any).code, 'unknown');
  // Today and the student's own view.
  const today = await svc.today('o', biz.id); assert.equal(today.servedCount, 1); assert.equal(today.served[0].name, 'Alice'); assert.equal(today.notYet.length, 0);
  pass = await svc.passView(biz.slug, joined.token); assert.equal(pass.member.state, 'active'); assert.equal(pass.today.eaten.length, 1); assert.equal(pass.payment, null); assert.equal(pass.history[0].meals[0], 'Lunch');
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
  const j = await svc.joinProgram(biz.slug, prog.id, { name: 'Bob', phone: '0788222333' }, 'v'); const m = (await svc.members('o', biz.id))[0]; await svc.confirmPayment('o', biz.id, m.id, { method: 'cash' });
  assert.equal((await svc.dashboard('o', biz.id)).recent.some((e) => e.method === 'cash'), true);
  const r: any = await svc.redeem('o', biz.id, { code: j.code }); at(T0 + 5 * 60_000); await svc.undoMeal('o', biz.id, r.mealId);
  assert.equal(((await svc.redeem('o', biz.id, { code: j.code })) as any).ok, true, 'served again after the undo'); assert.equal((await svc.today('o', biz.id)).servedCount, 1);
  const r2: any = await svc.redeem('o', biz.id, { code: j.code, meal: 'Lunch' }); void r2; const served = (await svc.today('o', biz.id)).served[0]; at(T0 + 40 * 60_000);
  await assert.rejects(svc.undoMeal('o', biz.id, served.mealId), (e: any) => e.code === 'TOO_LATE');
  assert.equal((await svc.setMember('o', biz.id, m.id, { action: 'pause' })).state, 'paused'); at(T0 + 86_400_000);
  assert.equal(((await svc.redeem('o', biz.id, { code: j.code })) as any).code, 'paused'); assert.equal((await svc.setMember('o', biz.id, m.id, { action: 'resume' })).state, 'active');
  const before = (await svc.members('o', biz.id))[0].endDate; assert.equal((await svc.setMember('o', biz.id, m.id, { action: 'extend', days: 5 })).endDate, addDays(before, 5));
  await assert.rejects(svc.setMember('o', biz.id, m.id, { action: 'extend', days: 999 }), /1 and 60/); assert.equal((await svc.setMember('o', biz.id, m.id, { action: 'cancel' })).state, 'cancelled');
});

test('two scans at the same moment serve exactly one meal', async () => {
  const { svc, biz, prog } = await setup();
  const j = await svc.joinProgram(biz.slug, prog.id, { name: 'Cy', phone: '0788333444' }, 'v'); await svc.confirmPayment('o', biz.id, (await svc.members('o', biz.id))[0].id, { method: 'cash' });
  const results: any[] = await Promise.all(Array.from({ length: 6 }, () => svc.redeem('o', biz.id, { code: j.code })));
  assert.equal(results.filter((r) => r.ok).length, 1); assert.equal(results.filter((r) => r.code === 'already').length, 5); assert.equal((await svc.today('o', biz.id)).servedCount, 1);
});

test('joining: one plan per phone, a full plan closes, a closed plan is gone, spam is refused, and the page never shows other people', async () => {
  const { svc, biz, prog } = await setup({ maxMembers: 2 });
  await svc.joinProgram(biz.slug, prog.id, { name: 'A1', phone: '0788000001' }, 'v1');
  await assert.rejects(svc.joinProgram(biz.slug, prog.id, { name: 'A1 again', phone: '0788000001' }, 'v2'), (e: any) => e.code === 'EXISTS');
  await svc.joinProgram(biz.slug, prog.id, { name: 'A2', phone: '0788000002' }, 'v3'); assert.equal((await svc.publicBySlug(biz.slug))!.programs![0].full, true);
  await assert.rejects(svc.joinProgram(biz.slug, prog.id, { name: 'A3', phone: '0788000003' }, 'v4'), (e: any) => e.code === 'FULL');
  await assert.rejects(svc.joinProgram(biz.slug, prog.id, { name: 'Bot', phone: '0788000009', website: 'spam.com' }, 'v5'), /Not accepted/);
  const pubJson = JSON.stringify(await svc.publicBySlug(biz.slug)); assert.ok(!pubJson.includes('0788000001') && !pubJson.includes('250788000001') && !pubJson.includes('A1') && !pubJson.includes('passHash'));
  await svc.saveProgram('o', biz.id, { ...prog, id: prog.id, active: false }); assert.equal((await svc.publicBySlug(biz.slug))!.programs, undefined); await assert.rejects(svc.joinProgram(biz.slug, prog.id, { name: 'A4', phone: '0788000004' }, 'v6'), (e: any) => e.status === 404);
  await assert.rejects(svc.deleteProgram('o', biz.id, prog.id), (e: any) => e.code === 'HAS_MEMBERS');
  const { svc: s2, biz: b2, prog: p2 } = await setup(); for (let i = 0; i < 6; i++) await s2.joinProgram(b2.slug, p2.id, { name: `N${i}`, phone: `07882000${i}0` }, 'same');
  await assert.rejects(s2.joinProgram(b2.slug, p2.id, { name: 'N7', phone: '0788200070' }, 'same'), (e: any) => e.status === 429);
});

test('privacy: a pass belongs to its holder, another business cannot read it, strangers cannot use the owner side, and an unpublished page has no plans', async () => {
  const { svc, biz, prog, kv } = await setup(); const j = await svc.joinProgram(biz.slug, prog.id, { name: 'Dee', phone: '0788444555' }, 'v');
  const other = await svc.create('o2', { name: 'Other Cafe' }); await svc.update('o2', other.id, { about: 'x' }); await svc.setPublished('o2', other.id, true);
  await assert.rejects(svc.passView(other.slug, j.token), (e: any) => e.status === 404, 'a pass only opens on its own business page');
  await assert.rejects(svc.passView(biz.slug, 'x'.repeat(30)), (e: any) => e.status === 404); await assert.rejects(svc.passView(biz.slug, 'short'), (e: any) => e.status === 404);
  for (const call of [() => svc.programs('intruder', biz.id), () => svc.members('intruder', biz.id), () => svc.redeem('intruder', biz.id, { code: j.code }), () => svc.today('intruder', biz.id), () => svc.saveProgram('intruder', biz.id, LUNCH)]) await assert.rejects(call(), (e: any) => e.status === 404);
  const stored = JSON.stringify([...kv.data.entries()]); assert.ok(!stored.includes(j.token), 'only the hash of the pass token is stored');
  await svc.setPublished('o', biz.id, false); await assert.rejects(svc.passView(biz.slug, j.token), (e: any) => e.status === 404); assert.equal(await svc.publicBySlug(biz.slug), null);
});

test('paying by phone prompt: the customer approves, the plan starts, and the sale is counted once', async () => {
  const kv = memKv(); let state = 'PENDING';
  const f: Fetch = async (url, init) => { if (url.includes('/token/')) return { status: 200, json: async () => ({ access_token: 'T' }), text: async () => '' }; if (init.method === 'POST') return { status: 202, json: async () => ({}), text: async () => '' }; return { status: 200, json: async () => ({ status: state }), text: async () => '' }; };
  const svc = createBizService({ kv, media: memoryMediaStore(), isPaid: async () => true, now: () => T0, secretKey: keyFrom('t'), fetchImpl: f }); resetBizLimitsForTests();
  const biz = await svc.create('o', { name: 'Uni Canteen' }); await svc.update('o', biz.id, { about: 'x', acceptPay: true }); await svc.setPublished('o', biz.id, true); const prog = await svc.saveProgram('o', biz.id, LUNCH);
  const j = await svc.joinProgram(biz.slug, prog.id, { name: 'Eve', phone: '0788555666' }, 'v');
  await assert.rejects(svc.payMember(biz.slug, j.token, {}, 'v'), (e: any) => e.code === 'NO_PAY', 'no keys yet');
  await svc.saveSecrets('o', biz.id, 'mtn', { subscriptionKey: 'SKEY123', apiUser: '3f2b8c1e-aaaa-bbbb-cccc-1234567890ab', apiKey: 'APIKEY9999', environment: 'production' });
  assert.equal(((await svc.passView(biz.slug, j.token)) as any).payment.online, true);
  await svc.payMember(biz.slug, j.token, {}, 'v'); let pass: any = await svc.passView(biz.slug, j.token); assert.equal(pass.payment.promptSent, true); assert.equal(pass.member.state, 'pending');
  state = 'SUCCESSFUL'; pass = await svc.passView(biz.slug, j.token); assert.equal(pass.member.state, 'active'); assert.equal(pass.payment, null);
  assert.equal((await svc.dashboard('o', biz.id)).today.sales, 40000, 'one sale, not two'); assert.equal((await svc.members('o', biz.id))[0].payMethod, 'momo_prompt');
  assert.equal(((await svc.redeem('o', biz.id, { code: j.code })) as any).ok, true);
});

test('the owner sees expiring plans and what was sold; deleting the business removes every pass and record', async () => {
  const { svc, biz, prog, kv, at } = await setup(); const j = await svc.joinProgram(biz.slug, prog.id, { name: 'Fay', phone: '0788666777', startDate: '2026-11-17' }, 'v'); await svc.confirmPayment('o', biz.id, (await svc.members('o', biz.id))[0].id, { method: 'cash' });
  await svc.redeem('o', biz.id, { code: j.code }); let s = await svc.programSummary('o', biz.id); assert.equal(s.active, 1); assert.equal(s.soldThisMonth, 40000); assert.equal(s.expiring.length, 0);
  at(Date.parse('2026-12-14T10:00:00Z')); s = await svc.programSummary('o', biz.id); assert.equal(s.expiring.length, 1); assert.equal(s.expiring[0].name, 'Fay');
  await svc.remove('o', biz.id); const left = [...kv.data.keys()].filter((k) => /^biz-(programs|members|pass|meals|served)/.test(k)); assert.deepEqual(left, []);
});

import { bizTools } from '../server/services/ai/tools/bizTools.js';
test('the assistant can make a meal plan, give the share link, and report how the plans are doing', async () => {
  const { svc, kv } = make(); void kv; const tools = Object.fromEntries(bizTools(() => svc).map((t) => [t.definition.name, t])) as any; const c: any = { userId: 'u1', files: {}, services: {} };
  await tools.biz_create.execute({ name: 'Campus Canteen', category: 'restaurant' }, c);
  assert.match((await tools.biz_program.execute({}, c)).text, /No plans yet/);
  const made = await tools.biz_program.execute({ title: 'Lunch plan', price_rwf: 40000, days: 30, meals: ['Lunch'], open_days: ['mon', 'tue', 'wed', 'thu', 'fri'] }, c);
  assert.match(made.text, /40,000 RWF for 30 days/); assert.match(made.text, /\/b\/campus-canteen\?plan=/); assert.match(made.text, /not published yet/);
  const bad = await tools.biz_program.execute({ title: 'x', price_rwf: 5 }, c); assert.ok(bad.isError || /price must be between/.test(bad.text), bad.text);
  const list = await tools.biz_program.execute({}, c); assert.match(list.text, /Lunch plan \(id /); assert.match(list.text, /0 active, 0 waiting for payment/);
  const status = await tools.biz_plan_status.execute({}, c); assert.match(status.text, /Members: 0 active/); assert.match(status.text, /Nobody is ending within 3 days/);
  assert.match((await tools.biz_plan_status.execute({ q: 'zzz' }, c)).text, /No member matches/);
  const other: any = { userId: 'u2', files: {}, services: {} }; assert.match((await tools.biz_program.execute({}, other)).text, /no business page yet|No business/i, 'another person has no access');
});
