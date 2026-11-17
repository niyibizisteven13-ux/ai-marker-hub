import test from 'node:test';
import assert from 'node:assert/strict';
import { createBizService, resetBizLimitsForTests, type Kv } from '../server/services/biz/service.js';
import { memoryMediaStore } from '../server/services/biz/media.js';
import { cleanEntry, summarize, dayOf, type LedgerEntry } from '../server/services/biz/ledger.js';

// bwenge4biz money notebook: private, correct totals, stock follows sales, nobody else can read it.
const memKv = (): Kv & { data: Map<string, unknown> } => { const data = new Map<string, unknown>(); return { data, async get<T>(k: string) { return (data.has(k) ? JSON.parse(JSON.stringify(data.get(k))) : null) as T | null; }, async put(k, v) { data.set(k, JSON.parse(JSON.stringify(v))); }, async del(k) { data.delete(k); } }; };
const T0 = Date.parse('2026-11-17T10:00:00Z');
const make = () => { const kv = memKv(); const svc = createBizService({ kv, media: memoryMediaStore(), isPaid: async () => false, now: () => T0 }); resetBizLimitsForTests(); return { kv, svc }; };

test('entries: an amount above zero, no future dates, expense categories', () => {
  assert.ok('error' in (cleanEntry({ type: 'sale', amount: 0 }, 'x', T0) as any)); assert.ok('error' in (cleanEntry({ amount: 'abc' }, 'x', T0) as any));
  assert.ok('error' in (cleanEntry({ amount: 5, at: '2027-01-01' }, 'x', T0) as any));
  const e = cleanEntry({ type: 'expense', amount: '8,000', item: ' flour ', category: 'weird' }, 'x', T0) as LedgerEntry; assert.equal(e.amount, 8000); assert.equal(e.item, 'flour'); assert.equal(e.category, 'other');
});

test('summary: today against yesterday, profit, top sellers, orders by status, customers, low stock', () => {
  const mk = (o: Partial<LedgerEntry>): LedgerEntry => ({ id: Math.random().toString(), type: 'sale', amount: 1000, at: new Date(T0).toISOString(), status: 'completed', src: 'studio', ...o });
  const y = new Date(T0 - 86_400_000).toISOString();
  const s = summarize([mk({ amount: 3000, item: 'Bread', qty: 3, customer: 'Ann' }), mk({ amount: 2000, item: 'Bread', customer: 'ann' }), mk({ amount: 500, item: 'Tea', status: 'pending' }), mk({ type: 'expense', amount: 1500 }), mk({ amount: 2500, at: y })],
    [{ id: 'p', name: 'Flour', price: 100, available: true, stock: 2, lowAt: 5, unit: 'kg' }, { id: 'q', name: 'Sugar', price: 100, available: true, stock: 50 }, { id: 'r', name: 'NoCount', price: 1, available: true }], T0, 7);
  assert.equal(s.today.sales, 5000); assert.equal(s.today.expenses, 1500); assert.equal(s.today.profit, 3500); assert.equal(s.today.orders, 3); assert.equal(s.yesterday.sales, 2500); assert.equal(s.change.sales, 100);
  assert.deepEqual(s.orders, { completed: 2, pending: 1, cancelled: 0 }); assert.equal(s.top[0].name, 'Bread'); assert.equal(s.top[0].amount, 5000); assert.equal(s.customers, 1);
  assert.deepEqual(s.lowStock.map((l) => l.name), ['Flour']); assert.equal(s.series.length, 7); assert.equal(s.series[6].day, dayOf(T0));
});

test('service: sales lower stock, cancelling gives it back, running out marks the product out of stock; private to the owner; deleted with the page', async () => {
  const { svc, kv } = make(); const b = await svc.create('o', { name: 'Bakery' }); const p = await svc.addProduct('o', b.id, { name: 'Bread', price: 800, stock: 3 });
  const { entry } = await svc.addEntry('o', b.id, { type: 'sale', amount: 1600, productId: p.id, qty: 2 }); assert.equal((await svc.get('o', b.id)).products[0].stock, 1);
  await svc.setEntryStatus('o', b.id, entry.id, 'cancelled'); assert.equal((await svc.get('o', b.id)).products[0].stock, 3);
  await svc.setEntryStatus('o', b.id, entry.id, 'completed'); await svc.addEntry('o', b.id, { type: 'sale', amount: 800, productId: p.id, qty: 1 });
  const after = (await svc.get('o', b.id)).products[0]; assert.equal(after.stock, 0); assert.equal(after.available, false);
  await assert.rejects(svc.addEntry('intruder', b.id, { type: 'sale', amount: 5 }), (e: any) => e.status === 404); await assert.rejects(svc.dashboard('intruder', b.id), (e: any) => e.status === 404);
  const d = await svc.dashboard('o', b.id); assert.equal(d.today.sales, 2400); assert.equal(d.lowStock[0].name, 'Bread');
  await svc.update('o', b.id, { about: 'Fresh' }); await svc.setPublished('o', b.id, true);
  const pub = JSON.stringify(await svc.publicBySlug(b.slug)); assert.ok(!pub.includes('stock') && !pub.includes('2400'), 'stock and money never reach the public');
  await svc.remove('o', b.id); assert.equal(kv.data.has(`biz-ledger:${b.id}`), false);
});

test('orders from the page: saved as a pending sale with the total, needs name, contact and real products, robots ignored', async () => {
  const { svc } = make(); const b = await svc.create('o', { name: 'Cafe' }); const p = await svc.addProduct('o', b.id, { name: 'Coffee', price: 1000 }); await svc.update('o', b.id, { about: 'x' }); await svc.setPublished('o', b.id, true);
  await assert.rejects(svc.submitOrder(b.slug, { name: 'Jo', contact: '0788123456', items: [] }, 'v'), /at least one/);
  await assert.rejects(svc.submitOrder(b.slug, { name: '', contact: '0788123456', items: [{ productId: p.id, qty: 1 }] }, 'v'), /name/);
  assert.deepEqual(await svc.submitOrder(b.slug, { name: 'Jo', contact: 'x', items: [{ productId: p.id, qty: 1 }], website: 'spam.com' }, 'v'), { saved: false, total: 0 });
  const r = await svc.submitOrder(b.slug, { name: 'Jo', contact: '0788123456', items: [{ productId: p.id, qty: 3 }, { productId: 'fake', qty: 9 }] }, 'v2'); assert.equal(r.total, 3000);
  const list = await svc.ledger('o', b.id); assert.equal(list.length, 1); assert.equal(list[0].status, 'pending'); assert.equal(list[0].src, 'page'); assert.equal((await svc.dashboard('o', b.id)).today.sales, 0, 'a pending order is not income yet');
});

// ---- payment secrets and online payments
import { seal, open as unseal, keyFrom, cleanSecrets } from '../server/services/biz/secrets.js';
import { msisdn, providerOf, mtnGateway, airtelGateway, type Fetch } from '../server/services/biz/payments.js';

test('secrets: encrypted at rest, wrong key fails, validated, never echoed back', () => {
  const k = keyFrom('a'); const sealed = seal('{"apiKey":"SUPERSECRET"}', k); assert.ok(!JSON.stringify(sealed).includes('SUPERSECRET')); assert.equal(unseal(sealed, k), '{"apiKey":"SUPERSECRET"}');
  assert.throws(() => unseal(sealed, keyFrom('b')));
  assert.ok('error' in (cleanSecrets('mtn', { subscriptionKey: 'k', apiUser: 'not-uuid', apiKey: 'x' }) as any)); assert.ok('error' in (cleanSecrets('airtel', { clientId: 'id' }) as any));
  const ok = cleanSecrets('airtel', { clientId: 'id', clientSecret: 'abcd1234', environment: 'staging' }) as any; assert.equal(ok.hint, '…1234'); assert.equal(ok.environment, 'staging');
  assert.ok('error' in (cleanSecrets('airtel', { clientId: 'id', clientSecret: 'a b' }) as any));
});

test('Rwanda numbers: 078/079 MTN, 072/073 Airtel, junk refused', () => {
  assert.equal(msisdn('0788 123 456'), '250788123456'); assert.equal(msisdn('+250 733 123 456'), '250733123456'); assert.equal(msisdn('788123456'), '250788123456'); assert.equal(msisdn('0712345678'), null); assert.equal(msisdn('abc'), null);
  assert.equal(providerOf('250788123456'), 'mtn'); assert.equal(providerOf('250733123456'), 'airtel');
});

const fakeFetch = (log: any[], replies: Record<string, { status: number; body: any }>): Fetch => async (url, init) => { log.push({ url, init }); const key = Object.keys(replies).find((k) => url.includes(k))!; const r = replies[key]; return { status: r.status, json: async () => r.body, text: async () => JSON.stringify(r.body) }; };
test('MTN and Airtel adapters call the documented endpoints and map the answers', async () => {
  const log: any[] = [];
  const mtn = mtnGateway({ subscriptionKey: 'SK', apiUser: 'u', apiKey: 'k' }, 'production', fakeFetch(log, { '/collection/token/': { status: 200, body: { access_token: 'T' } }, '/requesttopay/ref1': { status: 200, body: { status: 'SUCCESSFUL' } }, '/requesttopay': { status: 202, body: {} } }));
  await mtn.request({ amount: 1500, phone: '250788123456', ref: 'ref1', note: 'Bread' }); const req = log.find((l) => l.url.endsWith('/requesttopay'));
  assert.equal(req.init.headers['X-Target-Environment'], 'mtnrwanda'); assert.equal(req.init.headers['X-Reference-Id'], 'ref1'); assert.equal(JSON.parse(req.init.body).currency, 'RWF'); assert.equal(JSON.parse(req.init.body).payer.partyId, '250788123456');
  assert.equal(await mtn.status('ref1'), 'success');
  const log2: any[] = []; const air = airtelGateway({ clientId: 'c', clientSecret: 's' }, 'production', fakeFetch(log2, { '/auth/oauth2/token': { status: 200, body: { access_token: 'T' } }, '/standard/v1/payments/': { status: 200, body: { data: { transaction: { status: 'TF' } } } }, '/merchant/v2/payments/': { status: 200, body: { status: { success: true, response_code: 'DP00800001001' } } } }));
  await air.request({ amount: 2000, phone: '250733123456', ref: 'ref2', note: 'x' }); const b2 = JSON.parse(log2.find((l) => l.url.endsWith('/merchant/v2/payments/')).init.body); assert.equal(b2.subscriber.msisdn, '733123456'); assert.equal(b2.transaction.currency, 'RWF');
  assert.equal(await air.status('ref2'), 'failed');
  const bad = mtnGateway({ subscriptionKey: 'SK', apiUser: 'u', apiKey: 'k' }, 'production', fakeFetch([], { '/collection/token/': { status: 401, body: {} } })); await assert.rejects(bad.ping(), /did not accept/);
});

test('online payment end to end: keys saved sealed, never readable, customer pays by QR page, state settles the sale and stock', async () => {
  const kv = memKv(); const log: any[] = []; let state = 'PENDING';
  const f: Fetch = async (url, init) => { log.push(url); if (url.includes('/token/')) return { status: 200, json: async () => ({ access_token: 'T' }), text: async () => '' }; if (init.method === 'POST') return { status: 202, json: async () => ({}), text: async () => '' }; return { status: 200, json: async () => ({ status: state }), text: async () => '' }; };
  let clock = T0; const svc = createBizService({ kv, media: memoryMediaStore(), isPaid: async () => true, now: () => clock, secretKey: keyFrom('t'), fetchImpl: f }); resetBizLimitsForTests();
  const b = await svc.create('o', { name: 'Cafe' }); const p = await svc.addProduct('o', b.id, { name: 'Coffee', price: 1000, stock: 5 }); await svc.update('o', b.id, { about: 'x', acceptPay: true }); await svc.setPublished('o', b.id, true);
  assert.equal((await svc.publicBySlug(b.slug))!.payOnline, undefined, 'no keys yet');
  await assert.rejects(svc.submitPayment(b.slug, { name: 'A', phone: '0788123456', items: [{ productId: p.id, qty: 1 }] }, 'v'), (e: any) => e.status === 409);
  await svc.saveSecrets('o', b.id, 'mtn', { subscriptionKey: 'SKEY123', apiUser: '3f2b8c1e-aaaa-bbbb-cccc-1234567890ab', apiKey: 'APIKEY9999', environment: 'production' });
  assert.ok(!JSON.stringify([...kv.data.values()]).includes('APIKEY9999'), 'stored sealed'); const st = JSON.stringify(await svc.secretsStatus('o', b.id)); assert.ok(!st.includes('APIKEY9999') && !st.includes('SKEY123') && st.includes('9999'));
  assert.deepEqual((await svc.publicBySlug(b.slug))!.payOnline, { open: false }); assert.ok(!JSON.stringify(await svc.publicBySlug(b.slug)).includes('APIKEY'));
  await assert.rejects(svc.submitPayment(b.slug, { name: 'A', phone: '0733123456', items: [{ productId: p.id, qty: 1 }] }, 'v'), (e: any) => e.status === 409, 'Airtel not set up');
  await assert.rejects(svc.submitPayment(b.slug, { name: 'A', phone: '0788123456', amount: 5 }, 'v'), /at least one/, 'open amount is off');
  const r = await svc.submitPayment(b.slug, { name: 'Ann', phone: '0788123456', items: [{ productId: p.id, qty: 2 }, { productId: 'x', qty: 1 }], amount: 1 }, 'v2'); assert.equal(r.total, 2000, 'the server computes the amount');
  assert.deepEqual(await svc.publicPayStatus(b.slug, r.ref), { state: 'pending' }); assert.equal((await svc.dashboard('o', b.id)).today.sales, 0);
  state = 'SUCCESSFUL'; assert.deepEqual(await svc.publicPayStatus(b.slug, r.ref), { state: 'success' });
  assert.equal((await svc.dashboard('o', b.id)).today.sales, 2000); assert.equal((await svc.get('o', b.id)).products[0].stock, 3);
  const entry = (await svc.ledger('o', b.id))[0]; assert.equal(entry.status, 'completed'); assert.ok(entry.pay!.phone.includes('***') && !entry.pay!.phone.includes('123456'));
  await assert.rejects(svc.secretsStatus('intruder', b.id), (e: any) => e.status === 404); await assert.rejects(svc.publicPayStatus(b.slug, 'nope'), (e: any) => e.status === 404);
  await svc.clearSecrets('o', b.id, 'mtn'); assert.equal((await svc.publicBySlug(b.slug))!.payOnline, undefined);
  // owner-requested payment that is never approved times out
  await svc.saveSecrets('o', b.id, 'mtn', { subscriptionKey: 'SKEY123', apiUser: '3f2b8c1e-aaaa-bbbb-cccc-1234567890ab', apiKey: 'APIKEY9999' }); state = 'PENDING';
  const o = await svc.requestPayment('o', b.id, { phone: '0788 123 456', amount: 3000, item: 'Cakes' }); assert.equal(o.status, 'pending'); clock += 16 * 60_000; assert.equal((await svc.refreshPayment('o', b.id, o.id)).status, 'cancelled');
});

// ---- the business agent
import { cleanAgent, syncBizAgenda, bizToolsFor, bizSystem } from '../server/services/biz/agent.js';
import { agendaStore, memoryKV } from '../server/services/agenda/store.js';
import { toolsFor } from '../server/services/agenda/runner.js';

test('agent: settings are cleaned, the schedule follows them, and the tools it may use grow only with the level', async () => {
  assert.equal(cleanAgent({ level: 'god' }).level, 'off'); assert.deepEqual(cleanAgent({ level: 'assist', alerts: true, weekly: false }), { level: 'assist', alerts: true, morning: true, evening: true, weekly: false });
  const store = agendaStore(memoryKV()); const b = { id: 'b1', ownerId: 'o', name: 'Cafe', agent: cleanAgent({ level: 'assist', alerts: true, weekly: false }) };
  assert.equal(await syncBizAgenda(store, b, new Date('2026-11-17T08:00:00Z')), 2); let items = await store.list('o'); assert.deepEqual(items.map((i) => i.title).sort(), ['Cafe: closing summary', 'Cafe: morning plan']); assert.ok(items.every((i) => i.kind === 'biz' && i.bizId === 'b1' && i.bizLevel === 'assist'));
  assert.equal(await syncBizAgenda(store, b, new Date('2026-11-17T08:00:00Z')), 2); assert.equal((await store.list('o')).length, 2, 'idempotent');
  await store.put({ ...(await store.list('o'))[0], id: 'other', bizId: 'b2' }); await syncBizAgenda(store, { ...b, agent: cleanAgent({ level: 'off' }) }); items = await store.list('o'); assert.deepEqual(items.map((i) => i.bizId), ['b2'], 'only this business’s items are removed');
  const watch = bizToolsFor('watch'), assist = bizToolsFor('assist'), run = bizToolsFor('run');
  for (const t of [watch, assist, run]) for (const bad of ['biz_request_payment', 'biz_record_sale', 'biz_publish', 'biz_update', 'biz_change_product', 'biz_orders', 'biz_agent']) assert.ok(!t.includes(bad), `${bad} is never given to an unattended run`);
  assert.ok(!watch.includes('propose_actions') && assist.includes('propose_actions') && !assist.includes('biz_payment_status') && run.includes('biz_payment_status'));
  assert.deepEqual(toolsFor({ allowMarking: false, kind: 'biz', bizLevel: 'watch' }), watch); assert.ok(bizSystem('run', 'Cafe').includes('Never: publish'));
});

test('agent alerts: instant notices only when the agent is on with alerts; a new order brings a one-tap confirm plan; a failing notifier never breaks the sale', async () => {
  const kv = memKv(); const notes: any[] = []; let boom = false; const synced: any[] = [];
  const svc = createBizService({ kv, media: memoryMediaStore(), isPaid: async () => true, now: () => T0, notify: async (o, n) => { if (boom) throw new Error('telegram down'); notes.push({ o, n }); }, syncAgenda: async (b) => { synced.push(b.agent?.level ?? 'gone'); } }); resetBizLimitsForTests();
  const b = await svc.create('o', { name: 'Cafe' }); const p = await svc.addProduct('o', b.id, { name: 'Coffee', price: 1000, stock: 6, lowAt: 5 }); await svc.update('o', b.id, { about: 'x' }); await svc.setPublished('o', b.id, true);
  await svc.submitOrder(b.slug, { name: 'Jo', contact: '0788123456', items: [{ productId: p.id, qty: 1 }] }, 'v1'); await new Promise((r) => setImmediate(r)); assert.equal(notes.length, 0, 'agent off: silent');
  await assert.rejects(svc.setAgent('intruder', b.id, { level: 'run' }), (e: any) => e.status === 404);
  await svc.setAgent('o', b.id, { level: 'assist', alerts: true }); assert.deepEqual(synced, ['assist']);
  await svc.submitOrder(b.slug, { name: 'Ann', contact: '0788123456', items: [{ productId: p.id, qty: 2 }] }, 'v2'); await new Promise((r) => setImmediate(r));
  assert.equal(notes.length, 1); assert.match(notes[0].n.title, /New order/); assert.equal(notes[0].n.plan.steps[0].tool, 'biz_orders'); assert.equal(notes[0].n.plan.steps[0].input.confirm_ids.length, 1);
  await svc.submitEnquiry(b.slug, { name: 'Zed', contact: 'z@x.rw', message: 'Do you open on Sunday?' }, 'v3'); await new Promise((r) => setImmediate(r)); assert.match(notes[1].n.title, /New message/);
  const pending = (await svc.ledger('o', b.id)).find((e) => e.customer === 'Ann')!; await svc.setEntryStatus('o', b.id, pending.id, 'completed'); await svc.addEntry('o', b.id, { type: 'sale', amount: 1000, productId: p.id, qty: 1 }); await new Promise((r) => setImmediate(r));
  assert.ok(notes.some((x) => /Low stock/.test(x.n.title)), 'stock at or below the alert level warns');
  boom = true; const r = await svc.submitOrder(b.slug, { name: 'Bo', contact: '0788123456', items: [{ productId: p.id, qty: 1 }] }, 'v4'); assert.equal(r.saved, true);
  await svc.remove('o', b.id); assert.equal(synced[synced.length - 1], 'gone', 'deleting the business removes its scheduled digests');
});

import { CHAT_TOOLS, chatSystem } from '../server/services/biz/agent.js';
import { bizTools } from '../server/services/ai/tools/bizTools.js';
test('the Business Agent chat: its tool list is exactly business tools that exist, and its prompt keeps it to one business and keeps secrets out of chat', () => {
  const names = new Set(bizTools(async () => ({}) as any).map((t) => t.definition.name));
  for (const t of CHAT_TOOLS) assert.ok(names.has(t), `${t} exists`); assert.ok(CHAT_TOOLS.every((t) => t.startsWith('biz_')), 'nothing outside the business toolbox'); assert.ok(!CHAT_TOOLS.includes('biz_add_media'), 'no file ids in this chat');
  const sys = chatSystem({ name: 'Cafe', slug: 'cafe-1', category: 'restaurant' }); assert.ok(sys.includes('cafe-1') && /never ask for or accept payment keys/.test(sys) && /not a general chatbot/.test(sys));
});

// ---- paid gate, feed, location
test('the dashboard is paid: owner side refused with UPGRADE_REQUIRED until allowed; the public page is never affected', async () => {
  let ok = true; const kv = memKv();
  const svc = createBizService({ kv, media: memoryMediaStore(), isPaid: async () => false, now: () => T0, allowed: async () => ok }); resetBizLimitsForTests();
  const b = await svc.create('o', { name: 'Cafe' }); await svc.update('o', b.id, { about: 'x' }); await svc.setPublished('o', b.id, true);
  ok = false;
  for (const call of [() => svc.get('o', b.id), () => svc.update('o', b.id, { about: 'y' }), () => svc.dashboard('o', b.id), () => svc.addEntry('o', b.id, { type: 'sale', amount: 5 }), () => svc.create('o', { name: 'Two' }), () => svc.addPost('o', b.id, { text: 'hi' })])
    await assert.rejects(call(), (e: any) => e.status === 402 && e.code === 'UPGRADE_REQUIRED');
  assert.equal((await svc.list('o')).length, 1, 'the names can still be listed so the screen can say what is paused'); assert.ok(await svc.publicBySlug(b.slug), 'customers still see the page');
  ok = true; assert.equal((await svc.get('o', b.id)).name, 'Cafe');
});

test('feed: owner posts text and photos, the public sees them newest first with the pinned one on top, feed-only photos are public only while a post shows them', async () => {
  let clock = T0; const kv = memKv(); const store = memoryMediaStore(); const svc = createBizService({ kv, media: store, isPaid: async () => true, now: () => clock }); resetBizLimitsForTests();
  const b = await svc.create('o', { name: 'Cafe' }); await svc.update('o', b.id, { about: 'x' }); await svc.setPublished('o', b.id, true);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(80, 1)]);
  const m = await svc.addMedia('o', b.id, { name: 'a.png', data: png, scope: 'feed' }); assert.equal(m.visible, false); assert.equal((await svc.get('o', b.id)).coverId, undefined, 'a post photo never becomes the cover');
  assert.equal(await svc.mediaFor(b.slug, m.id), null, 'not public before a post shows it'); assert.equal((await svc.publicBySlug(b.slug))!.gallery.length, 0, 'not in the gallery');
  await assert.rejects(svc.addPost('o', b.id, { text: '  ' }), /Write something/);
  const p1 = await svc.addPost('o', b.id, { text: 'Fresh bread today', mediaIds: [m.id, 'nope'] }); clock += 60_000; const p2 = await svc.addPost('o', b.id, { text: 'Closed Monday' });
  assert.ok(await svc.mediaFor(b.slug, m.id), 'public once a post shows it');
  let feed = await svc.publicPosts(b.slug); assert.deepEqual(feed.map((x) => x.id), [p2.id, p1.id]); assert.equal(feed[1].media.length, 1);
  await svc.setPost('o', b.id, p1.id, { pinned: true }); feed = await svc.publicPosts(b.slug); assert.equal(feed[0].id, p1.id);
  await assert.rejects(svc.addPost('intruder', b.id, { text: 'x' }), (e: any) => e.status === 404);
  await svc.removePost('o', b.id, p1.id); assert.equal(await svc.mediaFor(b.slug, m.id), null, 'the post’s own photo goes with it'); assert.equal((await svc.get('o', b.id)).media.length, 0);
  await svc.setPublished('o', b.id, false); assert.deepEqual(await svc.publicPosts(b.slug), [], 'an unpublished page shows no feed');
});

test('location: valid coordinates become public, junk is ignored, clearing removes them', async () => {
  const svc = createBizService({ kv: memKv(), media: memoryMediaStore(), isPaid: async () => true, now: () => T0 }); resetBizLimitsForTests();
  const b = await svc.create('o', { name: 'Cafe' }); await svc.update('o', b.id, { about: 'x', lat: '-1.9441234567', lng: 30.0619 }); await svc.setPublished('o', b.id, true);
  assert.deepEqual((await svc.publicBySlug(b.slug))!.location, { lat: -1.944123, lng: 30.0619 });
  await svc.update('o', b.id, { lat: 999, lng: 30 }); assert.deepEqual((await svc.publicBySlug(b.slug))!.location, { lat: -1.944123, lng: 30.0619 }, 'out of range is ignored'); await svc.update('o', b.id, { lat: 'abc', lng: 'x' }); assert.ok((await svc.publicBySlug(b.slug))!.location);
  await svc.update('o', b.id, { lat: null, lng: null }); assert.equal((await svc.publicBySlug(b.slug))!.location, undefined);
});

// ---- Instagram-style feed: love, comments, order
test('feed: love is one per visitor and toggles, comments are validated and limited, the owner can reply and delete, a tagged product gives the post an Order button, deleting a post removes its likes and comments', async () => {
  const notes: any[] = []; const kv = memKv(); const svc = createBizService({ kv, media: memoryMediaStore(), isPaid: async () => true, now: () => T0, notify: async (_o, n) => { notes.push(n); } }); resetBizLimitsForTests();
  const b = await svc.create('o', { name: 'Cafe' }); const prod = await svc.addProduct('o', b.id, { name: 'Coffee', price: 1000 }); await svc.update('o', b.id, { about: 'x' }); await svc.setPublished('o', b.id, true); await svc.setAgent('o', b.id, { level: 'watch', alerts: true });
  const post = await svc.addPost('o', b.id, { text: 'New coffee', productId: prod.id }); const other = await svc.addPost('o', b.id, { text: 'Hello', productId: 'not-a-product' });
  assert.equal(post.productId, prod.id); assert.equal(other.productId, undefined);
  assert.deepEqual(await svc.like(b.slug, post.id, 'ann'), { liked: true, likes: 1 }); assert.deepEqual(await svc.like(b.slug, post.id, 'bob'), { liked: true, likes: 2 }); assert.deepEqual(await svc.like(b.slug, post.id, 'ann'), { liked: false, likes: 1 });
  await assert.rejects(svc.like(b.slug, 'nope', 'ann'), (e: any) => e.status === 404);
  let feed = await svc.publicPosts(b.slug, { visitor: 'bob' }); const f = feed.find((x) => x.id === post.id)!; assert.equal(f.likes, 1); assert.equal(f.liked, true); assert.equal(f.productId, prod.id); assert.equal((await svc.publicPosts(b.slug, { visitor: 'zed' })).find((x) => x.id === post.id)!.liked, false);
  assert.ok(!JSON.stringify(await svc.publicPosts(b.slug)).includes('ann'), 'who liked is never exposed');
  await assert.rejects(svc.addComment(b.slug, post.id, { name: '', text: 'x' }, 'v'), /name/); await assert.rejects(svc.addComment(b.slug, post.id, { name: 'A', text: ' ' }, 'v'), /comment/); await assert.rejects(svc.addComment(b.slug, post.id, { name: 'A', text: 'x', website: 'spam' }, 'v'), /Not accepted/);
  const c = await svc.addComment(b.slug, post.id, { name: 'Ann', text: 'Looks delicious!' }, 'v1'); await new Promise((r) => setImmediate(r)); assert.match(notes[0].title, /New comment/);
  assert.equal((await svc.publicPosts(b.slug)).find((x) => x.id === post.id)!.comments, 1);
  const r = await svc.replyComment('o', b.id, post.id, 'Thank you!'); assert.equal(r.owner, true); const pub = await svc.publicComments(b.slug, post.id); assert.deepEqual(pub.map((x) => x.text), ['Looks delicious!', 'Thank you!']); assert.equal(pub[1].owner, true); assert.ok(!('postId' in pub[0]));
  await assert.rejects(svc.replyComment('intruder', b.id, post.id, 'x'), (e: any) => e.status === 404);
  for (let i = 0; i < 12; i++) await svc.addComment(b.slug, post.id, { name: 'Spam', text: `m${i}` }, 'busy').catch(() => undefined); await assert.rejects(svc.addComment(b.slug, post.id, { name: 'Spam', text: 'more' }, 'busy'), (e: any) => e.status === 429);
  await svc.removeComment('o', b.id, c.id); assert.ok(!(await svc.publicComments(b.slug, post.id)).some((x) => x.id === c.id));
  await svc.removePost('o', b.id, post.id); assert.equal(await kv.get(`biz-comments:${b.id}`) && ((await kv.get<any>(`biz-comments:${b.id}`)).items as any[]).filter((x) => x.postId === post.id).length, 0); assert.equal(((await kv.get<any>(`biz-likes:${b.id}`))?.by ?? {})[post.id], undefined);
  await svc.setPublished('o', b.id, false); await assert.rejects(svc.like(b.slug, other.id, 'q'), (e: any) => e.status === 404); assert.deepEqual(await svc.publicComments(b.slug, other.id), []);
});
