import test from 'node:test';
import assert from 'node:assert/strict';
import { createBizService, resetBizLimitsForTests, type Kv } from '../server/services/biz/service.js';
import { memoryMediaStore, sniff } from '../server/services/biz/media.js';
import { applyProfile, cleanProduct, cleanUrl, newBusiness, openNow, publicView, slugFrom, validSlug, type Business } from '../server/services/biz/model.js';

// bwenge4biz: the page rules. The most important: the public sees only publicView, and nobody can touch another owner's business.
const memKv = (): Kv & { data: Map<string, unknown> } => { const data = new Map<string, unknown>(); return { data, async get<T>(k: string) { return (data.has(k) ? JSON.parse(JSON.stringify(data.get(k))) : null) as T | null; }, async put(k, v) { data.set(k, JSON.parse(JSON.stringify(v))); }, async del(k) { data.delete(k); } }; };
const make = (paid = false, t = Date.parse('2026-11-17T10:00:00Z')) => { const kv = memKv(), media = memoryMediaStore(); let clock = t; const svc = createBizService({ kv, media, isPaid: async () => paid, now: () => clock }); resetBizLimitsForTests(); return { svc, kv, media, tick: (ms: number) => { clock += ms; } }; };
const png = (n = 100) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(n, 1)]);
const jpg = (n = 100) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n, 2)]);
const mp4 = (n = 100) => Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42'), Buffer.alloc(n, 3)]);
const webm = (n = 100) => Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(n, 4)]);

test('page names: valid shapes only, Bwenge’s own names kept back, a business name becomes a tidy suggestion', () => {
  assert.deepEqual(validSlug(' Mama-Grace '), { ok: true, slug: 'mama-grace' });
  for (const bad of ['ab', 'x'.repeat(33), 'mama grace', 'mama--grace', '-mama', 'mama-', 'mamá', 'api', 'admin', 'bwenge-shop', 'bwenge4biz', 'login']) assert.equal(validSlug(bad).ok, false, bad);
  assert.equal(slugFrom("Mama Grace's Café"), 'mama-graces-cafe'); assert.equal(slugFrom('A'), 'a-biz'); assert.equal(slugFrom('  '), 'my-biz');
});

test('links must be https and on the right site; phone numbers are digits; nothing runs as code', () => {
  assert.equal(cleanUrl('javascript:alert(1)'), undefined); assert.equal(cleanUrl('http://x.rw'), undefined); assert.equal(cleanUrl('https://user:pw@x.rw'), undefined); assert.equal(cleanUrl('data:text/html,x'), undefined);
  assert.equal(cleanUrl('mama.rw/menu'), 'https://mama.rw/menu'); assert.equal(cleanUrl('https://evil.com', /(^|\.)instagram\.com$/), undefined);
  const b = newBusiness('1', 'o', 'Shop', 'shop-x', 'shop', 'now'); applyProfile(b, { whatsapp: '+250 788 123 456', phone: 'call me', instagram: 'https://evil.com/x', mapUrl: 'https://maps.app.goo.gl/abc', tagline: 'Fresh\u0007 daily', theme: 'neon' });
  assert.deepEqual([b.whatsapp, b.phone, b.instagram, b.mapUrl, b.tagline, b.theme], ['250788123456', undefined, undefined, 'https://maps.app.goo.gl/abc', 'Fresh daily', 'gold']);
});

test('products: a name, a price in whole francs or none, never negative or silly', () => {
  assert.deepEqual(cleanProduct({ name: ' Tomatoes ', price: '1,200', unit: 'kg' }, 'p1'), { id: 'p1', name: 'Tomatoes', price: 1200, available: true, unit: 'kg' });
  assert.equal((cleanProduct({ name: 'Ask', price: '' }, 'p2') as any).price, null);
  for (const bad of [{ name: '' }, { name: 'x', price: -5 }, { name: 'x', price: 'abc' }, { name: 'x', price: 1e12 }]) assert.ok('error' in (cleanProduct(bad, 'p') as any), JSON.stringify(bad));
});

test('"open now" follows the hours in Rwanda time, including a closing time after midnight', () => {
  const h = [{ day: 'tue' as const, open: '08:00', close: '18:00' }, { day: 'wed' as const, open: '20:00', close: '02:00' }, { day: 'thu' as const, open: '00:00', close: '00:00', closed: true }];
  assert.equal(openNow(h, Date.parse('2026-11-17T10:00:00Z')), true, 'Tuesday 12:00 Kigali');
  assert.equal(openNow(h, Date.parse('2026-11-17T17:00:00Z')), false, 'Tuesday 19:00 Kigali');
  assert.equal(openNow(h, Date.parse('2026-11-18T21:00:00Z')), true, 'Wednesday 23:00 Kigali, open until 02:00');
  assert.equal(openNow(h, Date.parse('2026-11-19T10:00:00Z')), false, 'Thursday closed'); assert.equal(openNow([]), null);
});

test('file types are decided by their first bytes: photos and short videos in, SVG and HTML out, whatever the name says', () => {
  assert.equal(sniff(png())?.mime, 'image/png'); assert.equal(sniff(jpg())?.mime, 'image/jpeg'); assert.equal(sniff(mp4())?.mime, 'video/mp4'); assert.equal(sniff(webm())?.mime, 'video/webm');
  assert.equal(sniff(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')), null);
  assert.equal(sniff(Buffer.from('<html><script>alert(1)</script></html>')), null); assert.equal(sniff(Buffer.from('GIF89a' + 'x'.repeat(20)))?.mime, 'image/gif');
  assert.equal(sniff(Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.alloc(20)])), null, 'iPhone HEIC photos are not shown by every browser');
});

test('THE BOUNDARY: secret text in every private field never appears in what the public gets', () => {
  const b: Business = newBusiness('id-SECRET-ID', 'owner-SECRET-OWNER', 'Mama Grace', 'mama-grace', 'restaurant', '2026-11-17T00:00:00Z');
  Object.assign(b, { about: 'We cook.', tagline: 'Good food', notes: 'NOTE-SECRET: supplier owes 50,000', momoCode: '123456', momoName: 'Grace M', showPay: false, whatsapp: '250788000000', suspended: undefined, published: true });
  b.media = [{ id: 'm1', kind: 'image', mime: 'image/png', size: 1, name: 'FILE-SECRET.png', createdAt: 'x', visible: true }, { id: 'm2', kind: 'image', mime: 'image/png', size: 1, name: 'HIDDEN-SECRET.png', createdAt: 'x', visible: false }, { id: 'm3', kind: 'video', mime: 'video/mp4', size: 1, name: 'clip.mp4', caption: 'Our kitchen', createdAt: 'x', visible: true }];
  b.coverId = 'm1'; b.products = [{ id: 'p1', name: 'Rice', price: 1500, available: true, mediaId: 'm2' }, { id: 'p2', name: 'HIDDEN-PRODUCT-SECRET', price: 1, available: true, hidden: true }];
  const json = JSON.stringify(publicView(b));
  for (const secret of ['SECRET-ID', 'SECRET-OWNER', 'NOTE-SECRET', 'FILE-SECRET', 'HIDDEN-SECRET', 'HIDDEN-PRODUCT-SECRET', '123456', 'Grace M', 'ownerId', 'notes', 'suspended', 'createdAt', 'size']) assert.ok(!json.includes(secret), `leaked: ${secret}`);
  const v = publicView(b); assert.equal(v.cover?.id, 'm1'); assert.deepEqual(v.gallery.map((g) => g.id), ['m3'], 'the cover is not repeated, hidden files are not shown'); assert.equal(v.products.length, 1); assert.equal(v.products[0].media, undefined, 'a product photo the owner hid is not shown');
  assert.equal(v.pay, undefined); b.showPay = true; assert.deepEqual(publicView(b).pay, { momoCode: '123456', momoName: 'Grace M' });
});

test('owners: one business on Free, none can touch another owner’s, names are unique', async () => {
  const { svc } = make(false);
  const a = await svc.create('alice', { name: "Alice's Shop", category: 'shop' }); assert.equal(a.slug, 'alices-shop');
  await assert.rejects(svc.create('alice', { name: 'Second' }), (e: any) => e.status === 402);
  await assert.rejects(svc.create('bob', { name: 'Copy', slug: 'alices-shop' }), (e: any) => e.code === 'SLUG_TAKEN');
  const b = await svc.create('bob', { name: "Alice's Shop" }); assert.notEqual(b.slug, 'alices-shop', 'a free suggestion is made when the name is taken');
  for (const act of [() => svc.get('bob', a.id), () => svc.update('bob', a.id, { name: 'Hacked' }), () => svc.setPublished('bob', a.id, true), () => svc.remove('bob', a.id), () => svc.addProduct('bob', a.id, { name: 'x' }), () => svc.addMedia('bob', a.id, { name: 'x.png', data: png() }), () => svc.enquiries('bob', a.id), () => svc.stats('bob', a.id)]) await assert.rejects(act(), (e: any) => e.status === 404);
  assert.equal((await svc.list('alice')).length, 1); assert.equal((await svc.list('bob')).length, 1);
  const paid = make(true); await paid.svc.create('c', { name: 'One' }); await paid.svc.create('c', { name: 'Two' }); await paid.svc.create('c', { name: 'Three' }); await assert.rejects(paid.svc.create('c', { name: 'Four' }), (e: any) => e.status === 402);
});

test('a page is public only when published and not hidden by Bwenge; an unpublished page looks like a missing one', async () => {
  const { svc } = make(); const b = await svc.create('o', { name: 'Cafe Kigali' });
  assert.equal(await svc.publicBySlug(b.slug), null, 'not published yet');
  await assert.rejects(svc.setPublished('o', b.id, true), (e: any) => e.code === 'EMPTY', 'an empty page is not published');
  await svc.update('o', b.id, { about: 'Coffee and cakes' }); await svc.setPublished('o', b.id, true);
  assert.equal((await svc.publicBySlug(b.slug.toUpperCase()))?.name, 'Cafe Kigali');
  await svc.adminSuspend(b.slug, 'scam reports'); assert.equal(await svc.publicBySlug(b.slug), null, 'hidden by Bwenge');
  await assert.rejects(svc.setPublished('o', b.id, true), (e: any) => e.code === 'SUSPENDED'); await svc.adminSuspend(b.slug, null); assert.ok(await svc.publicBySlug(b.slug));
  await svc.setPublished('o', b.id, false); assert.equal(await svc.publicBySlug(b.slug), null);
});

test('photos and videos: right types, size and count limits, the first photo becomes the cover, only shown files are served, removal deletes the file', async () => {
  const { svc, media } = make(false); const b = await svc.create('o', { name: 'Photo Shop' }); await svc.update('o', b.id, { about: 'x' }); await svc.setPublished('o', b.id, true);
  await assert.rejects(svc.addMedia('o', b.id, { name: 'logo.png', data: Buffer.from('<svg><script>alert(1)</script></svg>') }), (e: any) => e.code === 'TYPE', 'an SVG named .png is refused');
  await assert.rejects(svc.addMedia('o', b.id, { name: 'big.png', data: png(7 * 1048576) }), (e: any) => e.code === 'TOO_LARGE'); await assert.rejects(svc.addMedia('o', b.id, { name: 'big.mp4', data: mp4(26 * 1048576) }), (e: any) => e.code === 'TOO_LARGE');
  const m1 = await svc.addMedia('o', b.id, { name: 'front.jpg', data: jpg(), caption: ' Our shop ' }); assert.equal(m1.caption, 'Our shop'); assert.equal((await svc.get('o', b.id)).coverId, m1.id);
  const v = await svc.addMedia('o', b.id, { name: 'tour.mp4', data: mp4() }); assert.equal(v.kind, 'video');
  assert.ok(await svc.mediaFor(b.slug, m1.id)); assert.equal(await svc.mediaFor(b.slug, 'nope'), null);
  await svc.updateMedia('o', b.id, v.id, { visible: false }); assert.equal(await svc.mediaFor(b.slug, v.id), null, 'a hidden video is not served');
  await svc.addMedia('o', b.id, { name: 'c.mp4', data: mp4() }); await assert.rejects(svc.addMedia('o', b.id, { name: 'd.mp4', data: mp4() }), (e: any) => e.status === 402, 'Free: 2 videos');
  assert.ok([...media.files.keys()].some((k) => k.endsWith(`${m1.id}.jpg`))); await svc.removeMedia('o', b.id, m1.id); assert.ok(![...media.files.keys()].some((k) => k.includes(m1.id)), 'the file is gone'); assert.equal((await svc.get('o', b.id)).coverId, undefined);
  const s = await svc.mediaFor(b.slug, (await svc.get('o', b.id)).media.find((m) => m.visible && m.kind === 'video')!.id); const range = await s!.open({ start: 2, end: 9 }); const chunks: Buffer[] = []; for await (const c of range.stream) chunks.push(c as Buffer); assert.equal(Buffer.concat(chunks).length, 8, 'a video can be read in parts, so it can be sought');
  const total = make(false); const t = await total.svc.create('o', { name: 'Big' }); for (let i = 0; i < 4; i++) await total.svc.addMedia('o', t.id, { name: `a${i}.mp4`, data: mp4(20 * 1048576) }).catch(() => undefined);
  assert.ok((await total.svc.get('o', t.id)).media.reduce((a, m) => a + m.size, 0) <= 80 * 1048576, 'the total stays inside the plan');
});

test('visitor messages: valid, limited, private to the owner; robots and hidden pages get nothing', async () => {
  const { svc } = make(); const b = await svc.create('o', { name: 'Msg Shop' }); await svc.update('o', b.id, { about: 'x' }); await svc.setPublished('o', b.id, true);
  assert.deepEqual(await svc.submitEnquiry(b.slug, { name: 'Jean', contact: '+250 788 111 222', message: 'Do you deliver?', website: 'http://spam' }, 'v1'), { saved: false }, 'a robot filled the hidden field');
  assert.equal((await svc.enquiries('o', b.id)).length, 0);
  await assert.rejects(svc.submitEnquiry(b.slug, { name: 'Jean', contact: 'nope', message: 'Hi' }, 'v1'), /phone number or an email/); await assert.rejects(svc.submitEnquiry(b.slug, { contact: '0788111222', message: '  ' }, 'v1'), /Write your message/);
  assert.equal((await svc.submitEnquiry(b.slug, { name: 'Jean', contact: '0788111222', message: 'Do you deliver?' }, 'v1')).saved, true);
  const [e] = await svc.enquiries('o', b.id); assert.deepEqual([e.name, e.contact, e.message, e.status], ['Jean', '0788111222', 'Do you deliver?', 'new']);
  assert.equal((await svc.setEnquiry('o', b.id, e.id, 'done')).status, 'done'); assert.equal((await svc.stats('o', b.id)).newMessages, 0);
  for (let i = 0; i < 4; i++) await svc.submitEnquiry(b.slug, { contact: 'a@b.rw', message: `m${i}` }, 'v1'); await assert.rejects(svc.submitEnquiry(b.slug, { contact: 'a@b.rw', message: 'again' }, 'v1'), (e2: any) => e2.status === 429);
  await svc.setPublished('o', b.id, false); await assert.rejects(svc.submitEnquiry(b.slug, { contact: 'a@b.rw', message: 'hi' }, 'v2'), (e3: any) => e3.status === 404);
});

test('counts: views, taps (a repeat tap within 30 seconds counts once) and the last 30 days; reports reach the administrator', async () => {
  const { svc, tick } = make(); const b = await svc.create('o', { name: 'Count Shop' }); await svc.update('o', b.id, { about: 'x' }); await svc.setPublished('o', b.id, true);
  await svc.publicBySlug(b.slug, { count: true }); await svc.publicBySlug(b.slug, { count: true }); await svc.publicBySlug(b.slug);
  await svc.track(b.slug, 'whatsapp', 'v'); await svc.track(b.slug, 'whatsapp', 'v'); tick(31_000); await svc.track(b.slug, 'whatsapp', 'v'); await svc.track(b.slug, 'call', 'v'); assert.equal(await svc.track('missing', 'call', 'v'), false);
  const s = await svc.stats('o', b.id); assert.deepEqual([s.last30.views, s.last30.whatsapp, s.last30.calls], [2, 2, 1]);
  await svc.report(b.slug, { reason: 'scam', detail: ' sells fake goods ' }, 'r1'); const o = await svc.adminOverview(); assert.equal(o.reports[0].detail, 'sells fake goods'); assert.equal(o.businesses[0].reports, 1);
});

test('deleting a business removes the page, the name, the files and the messages', async () => {
  const { svc, kv, media } = make(); const b = await svc.create('o', { name: 'Gone Shop' }); await svc.addMedia('o', b.id, { name: 'a.png', data: png() });
  await svc.remove('o', b.id); assert.equal(await svc.publicBySlug(b.slug), null); assert.equal(media.files.size, 0); assert.ok(![...kv.data.keys()].some((k) => k.includes(b.id) || k === `biz-slug:${b.slug}`));
  assert.equal((await svc.create('o', { name: 'Gone Shop', slug: b.slug })).slug, b.slug, 'the name can be used again');
});
