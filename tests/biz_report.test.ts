// The closing report: sales and the programs added up from the owner's records, as numbers and as a short text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBizService, resetBizLimitsForTests, type Kv } from '../server/services/biz/service.js';
import { memoryMediaStore } from '../server/services/biz/media.js';
import { keyFrom } from '../server/services/biz/secrets.js';
import { buildDayReport, reportText, attentionOf } from '../server/services/biz/report.js';
import { DEFAULT_WORDS, RW_WORDS, wordsOf } from '../server/services/biz/programWords.js';
import { bizTools } from '../server/services/ai/tools/bizTools.js';
import { BIZ_READ_TOOLS, CHAT_TOOLS, PROMPTS } from '../server/services/biz/agent.js';

const memKv = (): Kv => { const data = new Map<string, unknown>(); return { async get<T>(k: string) { return (data.has(k) ? JSON.parse(JSON.stringify(data.get(k))) : null) as T | null; }, async put(k: string, v: unknown) { data.set(k, JSON.parse(JSON.stringify(v))); }, async del(k: string) { data.delete(k); } } as Kv; };
const T0 = Date.parse('2026-11-17T10:00:00Z');      // Tuesday 12:00 in Kigali
const entry = (o: any) => ({ id: Math.random().toString(36).slice(2), type: 'sale', amount: 1000, at: new Date(T0).toISOString(), status: 'completed', src: 'studio', ...o });

test('the report adds up the day: sales, expenses, profit, orders, best sellers, against yesterday; cancelled and pending sales are not money', () => {
  const y = new Date(T0 - 86_400_000).toISOString();
  const r = buildDayReport({ date: '2026-11-17', name: 'Canteen', lowStock: [{ name: 'Rice', stock: 2, unit: 'kg' }], newMessages: 2, programs: null, entries: [
    entry({ amount: 40_000, item: 'Rice and beans', qty: 8 }), entry({ amount: 10_000, item: 'Rice and beans', qty: 2 }), entry({ amount: 5_000, item: 'Juice' }), entry({ amount: 7_000, status: 'pending' }), entry({ amount: 9_000, status: 'cancelled' }),
    entry({ type: 'expense', amount: 20_000, category: 'stock' }), entry({ amount: 40_000, at: y }), entry({ amount: 1_000, at: '2026-11-10T10:00:00Z' }),
  ] as any });
  assert.deepEqual([r.money.sales, r.money.expenses, r.money.profit, r.money.orders, r.money.pending, r.money.cancelled], [55_000, 20_000, 35_000, 3, 1, 1]);
  assert.equal(r.money.yesterdaySales, 40_000); assert.equal(r.money.salesChangePct, 38); assert.deepEqual(r.top[0], { name: 'Rice and beans', amount: 50_000, qty: 10 });
  assert.deepEqual(r.attention, ['1 order still pending', 'Low stock: Rice', '2 new messages']);
  assert.equal(buildDayReport({ date: '2026-11-17', name: 'x', lowStock: [], newMessages: 0, programs: null, entries: [] }).money.salesChangePct, null, 'no percentage against a day with no sales');
});

const prog = { byItem: [{ item: 'Lunch', count: 14 }, { item: 'Dinner', count: 11 }], served: 25, people: 21, bySelf: 6, notYet: [{ name: 'Aline' }, { name: 'Eric' }], expected: 23, newMembers: 3, collectedRwf: 120_000, waiting: [{ name: 'Chantal', programTitle: 'Meal card' }], expiring: [{ name: 'Jean', endDate: '2026-11-19' }], plans: 1, activeMembers: 23 };
test('the text is short and plain, in the owner\'s own words, in English or Kinyarwanda, and says so when nothing was recorded', () => {
  const r = buildDayReport({ date: '2026-11-17', name: 'Heaven', lowStock: [], newMessages: 0, programs: prog, entries: [entry({ amount: 120_000, item: 'Meal card' }), entry({ type: 'expense', amount: 45_000 })] as any });
  const words = wordsOf({ program: 'meal card', member: 'student', use: 'meal' });
  const t = reportText(r, words); assert.match(t, /^\*Heaven: closing report\*\nTue 17 Nov 2026/); assert.match(t, /Sales 120,000 RWF/); assert.match(t, /Profit 75,000 RWF/);
  assert.match(t, /\*Meal cards\*/); assert.match(t, /Served today: 25 meals · 21 people \(Lunch 14 · Dinner 11\) · 6 ticked by the customer/); assert.match(t, /did not come: 2 \(Aline, Eric\)/);
  assert.match(t, /New students: 3 · Collected for plans: 120,000 RWF/); assert.match(t, /Waiting for your confirmation: 1 \(Chantal\)/); assert.match(t, /Ending within 3 days: 1 \(Jean 19 Nov\)/); assert.match(t, /23 students active/);
  assert.match(t, /\*Look at\*\n• 1 payment to confirm\n• 2 with a plan today did not come\n• 1 plan ending within 3 days/);
  const rw = reportText(r, RW_WORDS, 'rw'); assert.match(rw, /raporo y’umunsi/); assert.match(rw, /Kuwa kabiri 17 Nov 2026/); assert.match(rw, /Bakiriwe uyu munsi: 25 inshuro/); assert.match(rw, /\*Reba\*\n• Kwemeza ubwishyu 1/);
  assert.match(reportText(buildDayReport({ date: '2026-11-17', name: 'Quiet', lowStock: [], newMessages: 0, programs: null, entries: [] }), DEFAULT_WORDS), /Nothing recorded for this day yet\./);
  assert.ok(!/(^|\n)undefined|NaN|\[object/.test(t + rw), 'no stray placeholders');
  assert.ok(attentionOf({ ...r, programs: null, lowStock: [], newMessages: 0, money: { ...r.money, pending: 0, sales: 0 } }, 'en').includes('Expenses today but no sales recorded'));
});

const make = () => { const kv = memKv(); let clock = T0; const svc = createBizService({ kv, media: memoryMediaStore(), isPaid: async () => true, now: () => clock, secretKey: keyFrom('t') }); resetBizLimitsForTests(); return { svc, at: (t: number) => { clock = t; } }; };
test('the service report puts the ledger and the programs together: who was served by item, who did not come, new members, money, what waits; only the owner can read it', async () => {
  const { svc, at } = make(); const biz = await svc.create('o', { name: 'Heaven', category: 'restaurant' }); await svc.update('o', biz.id, { about: 'Lunch for students', momoCode: '123456', showPay: true }); await svc.setPublished('o', biz.id, true);
  const prog = await svc.saveProgram('o', biz.id, { title: 'Meal card', priceRwf: 40_000, days: 30, items: ['Lunch', 'Dinner'], openDays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'], checkIn: 'self' });
  const join = async (n: string, p: string) => (await svc.joinProgram(biz.slug, prog.id, { name: n, phone: p, passcode: '4821', remember: true }, n)) as any;
  const a = await join('Aline', '0788400001'); await join('Eric', '0788400002'); await join('Chantal', '0788400003'); await join('Dina', '0788400004');
  const ms = await svc.members('o', biz.id); for (const m of ms.filter((x) => x.name !== 'Chantal')) await svc.confirmPayment('o', biz.id, m.id, { method: 'cash' });
  const chantal = ms.find((x) => x.name === 'Chantal')!;
  await svc.claimCard(biz.slug, (await svc.login(biz.slug, { phone: '0788400003', passcode: '4821' }, 'c') as any).session, chantal.id, {}, 'c');
  await svc.redeem('o', biz.id, { memberId: ms.find((x) => x.name === 'Eric')!.id });
  const code = (await svc.checkinCode('o', biz.id, prog.id)).code; await svc.selfUse(biz.slug, a.session, { code }, 'a');
  const { report, text } = await svc.dayReport('o', biz.id); const p = report.programs!;
  assert.equal(p.served, 2); assert.equal(p.people, 2); assert.equal(p.bySelf, 1); assert.deepEqual(p.byItem, [{ item: 'Lunch', count: 2 }]);
  assert.deepEqual(p.notYet, [{ name: 'Dina' }], 'Dina has a paid plan today and did not come; Aline and Eric did'); assert.equal(p.expected, 3); assert.equal(p.newMembers, 4); assert.equal(p.collectedRwf, 120_000); assert.deepEqual(p.waiting.map((x) => x.name), ['Chantal']);
  assert.equal(report.money.sales, 120_000, 'each plan sale is in the notebook once'); assert.match(text, /Served today: 2 meals|Served today: 2 uses/);
  const y = await svc.dayReport('o', biz.id, { date: '2026-11-16' }); assert.equal(y.report.programs!.served, 0); assert.equal(y.report.programs!.notYet, null, 'who did not come is only known for today'); assert.equal(y.report.date, '2026-11-16');
  assert.equal((await svc.dayReport('o', biz.id, { date: '2026-10-01' })).report.date, '2026-11-17', 'too old a date falls back to today'); assert.equal((await svc.dayReport('o', biz.id, { date: '2027-01-01' })).report.date, '2026-11-17', 'a future date too');
  assert.match((await svc.dayReport('o', biz.id, { lang: 'rw' })).text, /raporo y’umunsi/);
  await assert.rejects(svc.dayReport('intruder', biz.id), (e: any) => e.status === 404 || /not found/i.test(e.message));
  at(T0 + 86_400_000); assert.equal((await svc.dayReport('o', biz.id, { date: '2026-11-17' })).report.programs!.served, 2, 'yesterday still shows what was served');
  const empty = await svc.create('o2', { name: 'Shop', category: 'shop' }); assert.equal((await svc.dayReport('o2', empty.id)).report.programs, null, 'no programs, no programs section');
});

test('the assistant can read the report, the evening digest uses it, and it is read-only', async () => {
  const { svc } = make(); const tools = Object.fromEntries(bizTools(() => svc).map((t) => [t.definition.name, t])) as any; const c: any = { userId: 'u1', files: {}, services: {} };
  await tools.biz_create.execute({ name: 'Campus Canteen', category: 'restaurant' }, c); await tools.biz_record_sale.execute({ amount: 5000, item: 'Juice' }, c);
  const r = await tools.biz_day_report.execute({}, c); assert.match(r.text, /Campus Canteen: closing report/); assert.match(r.text, /Sales 5,000 RWF/); assert.match((await tools.biz_day_report.execute({ lang: 'rw' }, c)).text, /raporo y’umunsi/);
  assert.ok(BIZ_READ_TOOLS.includes('biz_day_report') && CHAT_TOOLS.includes('biz_day_report')); assert.match(PROMPTS.evening, /biz_day_report/);
});

test('verified badge on the public page: shown only when the owner bought it, never leaks the owner, and the studio can tell', async () => {
  const mk = (verified: boolean) => { const kv = memKv(); const svc = createBizService({ kv, media: memoryMediaStore(), isPaid: async () => true, isVerified: async (id) => verified && id === 'o', now: () => T0, secretKey: keyFrom('t') }); resetBizLimitsForTests(); return svc; };
  for (const verified of [true, false]) {
    const svc = mk(verified); const biz = await svc.create('o', { name: 'Heaven', category: 'restaurant' }); await svc.update('o', biz.id, { about: 'Lunch' }); await svc.setPublished('o', biz.id, true);
    const pub: any = await svc.publicBySlug(biz.slug); assert.equal(pub.verified, verified ? true : undefined); assert.ok(!JSON.stringify(pub).includes('"o"'), 'no owner id on the public page');
    assert.equal(await svc.verifiedOwner('o'), verified); assert.equal(await svc.verifiedOwner('someone-else'), false);
  }
  const none = createBizService({ kv: memKv(), media: memoryMediaStore(), isPaid: async () => true, now: () => T0, secretKey: keyFrom('t') }); assert.equal(await none.verifiedOwner('o'), false, 'without the check wired in, nobody is verified');
});
