// The 4biz venture page: one page for the three products under "AI in our context", made for an account in one step and safe to run again.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBizService, resetBizLimitsForTests, type Kv } from '../server/services/biz/service.js';
import { memoryMediaStore } from '../server/services/biz/media.js';
import { keyFrom } from '../server/services/biz/secrets.js';
import { VENTURE_SLUG, ensureVenture, venturePage } from '../server/services/biz/venture.js';
import { validSlug } from '../server/services/biz/model.js';

const memKv = (): Kv => { const data = new Map<string, unknown>(); return { async get<T>(k: string) { return (data.has(k) ? JSON.parse(JSON.stringify(data.get(k))) : null) as T | null; }, async put(k: string, v: unknown) { data.set(k, JSON.parse(JSON.stringify(v))); }, async del(k: string) { data.delete(k); } } as Kv; };
const SITE = 'https://example.test';
const make = (verified: Set<string> = new Set()) => { const svc = createBizService({ kv: memKv(), media: memoryMediaStore(), isPaid: async () => true, isVerified: async (id) => verified.has(id), secretKey: keyFrom('t') }); resetBizLimitsForTests(); return { svc, verified }; };

test('the venture page says what the venture is: "AI in our context", the three products, what it helps with, the usual questions, in English and Kinyarwanda', () => {
  const v = venturePage(SITE); assert.equal(v.name, '4biz'); assert.equal(v.tagline, 'AI in our context'); assert.equal(v.rw.tagline, 'AI mu byacu');
  assert.deepEqual(v.products.map((p) => p.name), ['MySEB', 'Bwenge AI', 'Bwenge4biz']); assert.ok(validSlug(VENTURE_SLUG).ok, 'the page name 4biz is allowed');
  for (const w of ['growth', 'records', 'new markets']) assert.match(v.sections[1].items!.map((i) => i.title).join(' ').toLowerCase(), new RegExp(w)); assert.ok(v.about.length < 1500 && v.rw.about.length < 1500);
  assert.deepEqual(v.sections[0].items!.map((i) => i.url), [`${SITE}/myseb`, `${SITE}/`, `${SITE}/biz`]);
});

test('ensureVenture makes the page for the admin account, publishes it, gives the badge, and running it again changes nothing but refreshes the words', async () => {
  const { svc, verified } = make(); let badges = 0;
  const r = await ensureVenture(svc, 'admin-1', { whatsapp: '250799691108', grantBadge: async (id) => { badges++; verified.add(id); } }, SITE);
  assert.deepEqual([r.created, r.products, r.sections, r.verified, r.url], [true, 3, 3, true, `${SITE}/b/4biz`]); assert.equal(badges, 1);
  const pub: any = await svc.publicBySlug('4biz'); assert.equal(pub.name, '4biz'); assert.equal(pub.tagline, 'AI in our context'); assert.equal(pub.verified, true, 'the blue check shows');
  assert.deepEqual(pub.products.map((p: any) => p.name), ['MySEB', 'Bwenge AI', 'Bwenge4biz']); assert.deepEqual(pub.sections.map((s: any) => s.title), ['Our products', 'What we help with', 'Good to know']);
  assert.equal(pub.contact.whatsapp, '250799691108'); assert.equal(pub.theme, 'ink'); assert.ok(pub.translations.rw.tagline === 'AI mu byacu' && Object.keys(pub.translations.rw.products).length === 3, 'Kinyarwanda is there');
  assert.ok(!JSON.stringify(pub).includes('admin-1'), 'the owner id never reaches the public page');
  // run it again after an edit: still one page, three products, three sections, no duplicates
  const mine = (await svc.list('admin-1')); assert.equal(mine.length, 1); await svc.update('admin-1', mine[0].id, { tagline: 'old words' }); await svc.updateProduct('admin-1', mine[0].id, mine[0].products[0].id, { description: 'changed' });
  const again = await ensureVenture(svc, 'admin-1', { grantBadge: async () => undefined }, SITE); assert.equal(again.created, false);
  const after = (await svc.list('admin-1')); assert.equal(after.length, 1); assert.equal(after[0].products.length, 3); assert.equal((after[0].sections ?? []).length, 3); assert.equal(after[0].tagline, 'AI in our context'); assert.match(after[0].products[0].description ?? '', /Secure online exams/);
  assert.equal(after[0].published, true);
});

test('another account cannot take the 4biz name, and without a badge grant nobody is verified', async () => {
  const { svc } = make(); await ensureVenture(svc, 'admin-1', {}, SITE); assert.equal(((await svc.publicBySlug('4biz')) as any).verified, undefined, 'no badge unless it is given');
  await assert.rejects(ensureVenture(svc, 'someone-else', {}, SITE), (e: any) => /taken/i.test(e.message), 'the name belongs to the first account');
  assert.equal((await svc.list('someone-else')).length, 0);
});

import { resolveVentureOwner } from '../server/services/biz/venture.js';
test('the venture page goes to the account with the email given, or to the caller; an unknown or odd email is refused with a plain message', async () => {
  const find = async (e: string) => (e === 'owner@example.test' ? { id: 'u-owner' } : null);
  assert.equal(await resolveVentureOwner('  Owner@Example.test ', 'admin-9', find), 'u-owner', 'case and spaces do not matter');
  assert.equal(await resolveVentureOwner('', 'admin-9', find), 'admin-9'); assert.equal(await resolveVentureOwner(undefined, 'admin-9', find), 'admin-9');
  await assert.rejects(resolveVentureOwner('nobody@example.test', 'admin-9', find), /No account has the email nobody@example.test/); await assert.rejects(resolveVentureOwner('not an email', 'admin-9', find), /does not look like an email/);
});

import { bizTools } from '../server/services/ai/tools/bizTools.js';
import { needsPlatformTools } from '../server/services/ai/platformIntent.js';
import { buildCapabilitiesPrompt } from '../server/services/ai/capabilitiesPrompt.js';
import { CHAT_TOOLS, chatSystem } from '../server/services/biz/agent.js';

test('Bwenge AI can build a venture page for anyone: it is private until they say publish, never duplicates on a second run, takes Kinyarwanda, and refuses what is not allowed', async () => {
  const { svc } = make(); const tools = Object.fromEntries(bizTools(() => svc).map((t) => [t.definition.name, t])) as any; const c: any = { userId: 'u1', files: {}, services: {} };
  const input = { name: 'Kigali Tech Studio', slug: 'kts', aim: 'Software that fits our shops', description: 'We build small tools for shops in Kigali.', category: 'services', theme: 'teal', whatsapp: '0788111222',
    products: [{ name: 'ShopBook', description: 'Sales and stock on a phone.', price_rwf: 15000 }, { name: 'QueueMe', description: 'A queue for salons.' }], helps: [{ title: 'Records', text: 'Every sale written down.' }], links: [{ title: 'ShopBook', text: 'See it', url: 'https://shopbook.example.test' }],
    faq: [{ question: 'Is it free?', answer: 'The first month is.' }], rw: { tagline: 'Porogaramu zijyanye n’amaduka yacu', products: { ShopBook: 'Ibyagurishijwe n’ibisigaye kuri telefoni.' } } };
  const made = await tools.biz_venture.execute(input, c); assert.match(made.text, /Created the venture page: 2 product\(s\), 4 picture\(s\), 3 section\(s\), with Kinyarwanda/); assert.match(made.text, /still private/); assert.match(made.text, /Verified badge \(1,000 RWF/);
  assert.equal(await svc.publicBySlug('kts'), null, 'nothing is public until the owner says so');
  const again = await tools.biz_venture.execute({ ...input, publish: true }, c); assert.match(again.text, /Refreshed/); assert.match(again.text, /It is published: .*\/b\/kts/);
  const pub: any = await svc.publicBySlug('kts'); assert.equal(pub.tagline, 'Software that fits our shops'); assert.equal(pub.products.length, 2); assert.equal(pub.products[0].price, 15000); assert.deepEqual(pub.sections.map((s: any) => s.title), ['Our products', 'What we help with', 'Good to know']); assert.equal(pub.translations.rw.tagline, 'Porogaramu zijyanye n’amaduka yacu');
  assert.equal((await svc.list('u1')).length, 1, 'one page, however many times it is run'); assert.equal((await svc.list('u1'))[0].products.length, 2);
  assert.equal(pub.verified, undefined, 'the badge is not something the assistant can give');
  const noName = await tools.biz_venture.execute({ name: '', aim: 'x', description: 'y' }, c); assert.ok(noName.isError || /name/i.test(noName.text), noName.text);
  const other = await tools.biz_venture.execute({ ...input }, { userId: 'u2', files: {}, services: {} }); assert.ok(other.isError || /taken/i.test(other.text), 'a name that is already used by another account is refused: ' + other.text); assert.equal((await svc.list('u2')).length, 0);
});

test('the assistant is taught the venture, programs, report and badge skills, and those requests reach the business tools', () => {
  const prompt = buildCapabilitiesPrompt({ tools: ['biz_get', 'biz_program', 'biz_venture', 'biz_day_report'] });
  for (const s of ['biz_venture', 'biz_program', 'biz_day_report', 'END PROGRAM', 'CHECKS? the business|THE CUSTOMER SCANS', 'Verified badge', '1,000 RWF', 'AI in our context']) assert.match(prompt, new RegExp(s, 'i'), s);
  assert.ok(CHAT_TOOLS.includes('biz_venture')); assert.match(chatSystem({ name: 'X', slug: 'x', category: 'services' }), /biz_venture/);
  for (const m of ['I want a page for my venture, it has three products', 'create a meal card for students', 'give me the closing report', 'how do I get the verified badge', 'set up my 4biz page', 'end the program please', 'show the check-in code']) assert.equal(needsPlatformTools(m), true, m);
  for (const m of ['explain photosynthesis', 'what is the capital of Rwanda', 'help me write a poem']) assert.equal(needsPlatformTools(m), false, m);
});

import sharp from 'sharp';
import { artDirectory, fourbizArt } from '../server/services/biz/venture.js';
test('the brand art is there and the right size: the Bwenge logo, a wide banner, and one picture for each product', async () => {
  const dir = artDirectory(); assert.ok(dir, 'the images are committed with the code'); const art = fourbizArt(dir)!;
  const dims = async (a?: { data: Buffer }) => { const m = await sharp(a!.data).metadata(); return `${m.width}x${m.height} ${m.format}`; };
  assert.equal(await dims(art.logo), '512x512 png'); assert.equal(await dims(art.cover), '2400x600 jpeg'); for (const n of ['MySEB', 'Bwenge AI', 'Bwenge4biz']) assert.equal(await dims(art.products![n]), '1200x900 jpeg', n);
  for (const a of [art.logo!, art.cover!, ...Object.values(art.products!)]) assert.ok(a.data.length > 5_000 && a.data.length < 1_000_000, `${a.name} is a sensible size`);
  assert.equal(fourbizArt(null), null, 'no folder, no art');
});

test('ensureVenture puts the logo, the banner and a picture on every product, keeps them out of the gallery, never uploads twice and drops an old version of the design', async () => {
  const { svc } = make(); const r = await ensureVenture(svc, 'admin-1', {}, SITE); assert.equal(r.pictures, 5);
  const biz = (await svc.list('admin-1'))[0]; assert.equal(biz.media.length, 5); assert.ok(biz.logoId && biz.coverId && biz.logoId !== biz.coverId);
  assert.equal(biz.media.find((m) => m.id === biz.logoId)!.mime, 'image/png'); assert.equal(biz.media.find((m) => m.id === biz.coverId)!.name, '4biz-banner-v1.jpg');
  assert.ok(biz.products.every((p) => p.mediaId && biz.media.some((m) => m.id === p.mediaId)), 'every product has a picture');
  const pub: any = await svc.publicBySlug('4biz'); assert.ok(pub.logo && pub.cover, 'logo and banner are on the page'); assert.ok(pub.products.every((p: any) => p.media), 'products show their pictures'); assert.equal(pub.gallery.length, 0, 'the art is not repeated in the photo gallery');
  const ids = biz.media.map((m) => m.id).sort(); await ensureVenture(svc, 'admin-1', {}, SITE); const again = (await svc.list('admin-1'))[0]; assert.deepEqual(again.media.map((m) => m.id).sort(), ids, 'a second run uploads nothing new');
  // an owner's own photo is untouched, and an older version of the design is replaced
  const own = await svc.addMedia('admin-1', biz.id, { name: 'team.jpg', data: await sharp({ create: { width: 40, height: 40, channels: 3, background: '#888' } }).jpeg().toBuffer() }); const old = await svc.addMedia('admin-1', biz.id, { name: '4biz-banner-v0.jpg', data: await sharp({ create: { width: 40, height: 40, channels: 3, background: '#444' } }).jpeg().toBuffer(), gallery: false });
  await ensureVenture(svc, 'admin-1', {}, SITE); const names = (await svc.list('admin-1'))[0].media.map((m) => m.name); assert.ok(names.includes('team.jpg') && !names.includes('4biz-banner-v0.jpg'), names.join(', ')); void own; void old;
  assert.equal(((await svc.publicBySlug('4biz')) as any).gallery.length, 1, 'the owner\'s own photo still shows in the gallery');
});

import { ensureVenturePage } from '../server/services/biz/venture.js';
test('without the image files the page is still made, just without pictures; and any venture can bring its own pictures', async () => {
  const { svc } = make(); const spec = { ...fourbizSpecForTest(), art: null }; const r = await ensureVenturePage(svc, 'a', spec as any, { publish: true }, SITE); assert.equal(r.pictures, 0); assert.equal((await svc.list('a'))[0].media.length, 0);
  const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#0B1420' } }).png().toBuffer();
  const r2 = await ensureVenturePage(svc, 'b', { name: 'Own Venture', slug: 'ownv', tagline: 'x', about: 'y', products: [{ name: 'Thing' }], art: { logo: { name: 'logo.png', data: png }, products: { Thing: { name: 'thing.png', data: png } } } }, {}, SITE); assert.equal(r2.pictures, 2);
});
import { fourbizSpec } from '../server/services/biz/venture.js';
const fourbizSpecForTest = () => fourbizSpec(SITE);

import React from 'react';
import { renderToString } from 'react-dom/server';
import { VerifiedBadge } from '../src/components/VerifiedBadge.js';
import { cleanProduct } from '../server/services/biz/model.js';
import { renderVentureArt } from '../server/services/biz/ventureArt.js';

test('a product can carry a link: only https, shown on the public page, and the 4biz products link to their sites', async () => {
  assert.equal((cleanProduct({ name: 'X', url: 'https://example.test/x' }, 'p') as any).url, 'https://example.test/x'); assert.equal((cleanProduct({ name: 'X', url: ' www.example.test/x ' }, 'p') as any).url, 'https://www.example.test/x', 'a bare address gets https');
  for (const bad of ['http://example.test', 'javascript:alert(1)', 'ftp://x.test/y', 'https://user:pw@example.test', 'not a link']) assert.match((cleanProduct({ name: 'X', url: bad }, 'p') as any).error, /https/, bad);
  assert.equal((cleanProduct({ name: 'X', url: '' }, 'p', { id: 'p', name: 'X', price: null, available: true, url: 'https://a.test' } as any) as any).url, undefined, 'an empty link removes it'); assert.equal((cleanProduct({ name: 'Y' }, 'p', { id: 'p', name: 'X', price: null, available: true, url: 'https://a.test' } as any) as any).url, 'https://a.test', 'untouched when not given');
  const { svc } = make(); await ensureVenture(svc, 'admin-1', {}, SITE); const pub: any = await svc.publicBySlug('4biz');
  assert.deepEqual(pub.products.map((p: any) => p.url), [`${SITE}/myseb`, `${SITE}/`, `${SITE}/biz`]);
  const tools = Object.fromEntries(bizTools(() => svc).map((t) => [t.definition.name, t])) as any; const c: any = { userId: 'u9', files: {}, services: {} };
  await tools.biz_create.execute({ name: 'Link Shop', category: 'shop' }, c); await tools.biz_add_product.execute({ name: 'Course', link: 'https://learn.example.test/course' }, c);
  assert.equal((await svc.list('u9'))[0].products[0].url, 'https://learn.example.test/course'); assert.match((await tools.biz_add_product.execute({ name: 'Bad', link: 'http://insecure.test' }, c)).text, /https/);
  await tools.biz_change_product.execute({ product: 'Course', link: '' }, c); assert.equal((await svc.list('u9'))[0].products[0].url, undefined);
});

test('Bwenge AI draws a logo, a banner and a picture for every product of any venture, in its theme, the same words give the same files and changed words replace them', async () => {
  const spec = { name: 'Kigali Tech Studio', tagline: 'Software that fits our shops', theme: 'teal', products: [{ name: 'ShopBook', description: 'Sales and stock on a phone, kept by chat or by tap.' }, { name: 'QueueMe', description: 'A queue for salons so nobody waits in the street.' }, { name: 'PayLink' }] };
  const a = await renderVentureArt(spec); const dims = async (x: { data: Buffer }) => { const m = await sharp(x.data).metadata(); return `${m.width}x${m.height} ${m.format}`; };
  assert.equal(await dims(a.logo!), '512x512 png'); assert.equal(await dims(a.cover!), '2400x600 jpeg'); for (const n of ['ShopBook', 'QueueMe', 'PayLink']) assert.equal(await dims(a.products![n]), '1200x900 jpeg', n);
  const b = await renderVentureArt(spec); assert.equal(b.cover!.name, a.cover!.name, 'same words, same names'); assert.ok(a.cover!.data.equals(b.cover!.data), 'and the same picture');
  const c = await renderVentureArt({ ...spec, tagline: 'Another aim' }); assert.notEqual(c.cover!.name, a.cover!.name, 'changed words, new names'); assert.ok(!a.cover!.data.equals((await renderVentureArt({ ...spec, theme: 'rose' })).cover!.data), 'the theme changes the colours');
  const odd = await renderVentureArt({ name: 'A very very long venture name that keeps going and going and going for ages', tagline: 'Ubwenge mu byacu, ubucuruzi bwacu & izindi serivisi nyinshi cyane zitandukanye', products: [{ name: 'Ñandú Ünïcode 日本', description: 'x '.repeat(200) }, { name: '  ' + 'W'.repeat(70) }] }); assert.ok(odd.cover!.data.length > 5000 && odd.products!['Ñandú Ünïcode 日本'].data.length > 5000, 'long and unusual words still draw');
});

test('ensureVenturePage with no pictures of its own draws them; design false leaves them out', async () => {
  const { svc } = make(); const spec = { name: 'Draw Me', slug: 'drawme', tagline: 'Aim', about: 'About', theme: 'violet', products: [{ name: 'One', description: 'First.', url: 'https://one.example.test' }, { name: 'Two' }] };
  const r = await ensureVenturePage(svc, 'a', spec, { publish: true }, SITE); assert.equal(r.pictures, 4); const biz = (await svc.list('a'))[0]; assert.ok(biz.logoId && biz.coverId); assert.ok(biz.products.every((p) => p.mediaId)); assert.ok(biz.media.every((m) => m.name.startsWith('venture-')));
  const again = await ensureVenturePage(svc, 'a', spec, { publish: true }, SITE); assert.equal((await svc.list('a'))[0].media.length, 4, 'nothing uploaded twice'); assert.equal(again.pictures, 4);
  await ensureVenturePage(svc, 'a', { ...spec, tagline: 'A new aim' }, { publish: true }, SITE); assert.equal((await svc.list('a'))[0].media.length, 4, 'the old drawings are replaced, not piled up');
  const plain = await ensureVenturePage(svc, 'b', { ...spec, slug: 'plain' }, { design: false }, SITE); assert.equal(plain.pictures, 0); assert.equal((await svc.list('b'))[0].media.length, 0);
});

test('Bwenge AI builds a page for ANOTHER account or gives the badge only for the administrator, and says plainly when it cannot', async () => {
  const { svc } = make(); const badges: Array<[string, boolean, string]> = []; const audits: string[] = [];
  const admin = (isAdmin: boolean) => ({ audit: async (_u: string, a: string) => { audits.push(a); }, admin: { isAdmin: async (id: string) => isAdmin && id === 'boss', findUserByEmail: async (e: string) => (e === 'friend@example.test' ? { id: 'friend', name: 'Friend' } : null), setVerifiedBadge: async (id: string, on: boolean, by: string) => { badges.push([id, on, by]); } } } as any);
  const input = { name: 'Friend Ventures', slug: 'friendv', aim: 'Their aim', description: 'Their description.', products: [{ name: 'Svc', description: 'A service.', link: 'https://svc.example.test' }] };
  const call = (services: any, userId: string, extra: any) => (Object.fromEntries(bizTools(() => svc, services).map((t) => [t.definition.name, t])) as any).biz_venture.execute({ ...input, ...extra }, { userId, files: {}, services: {} });
  const no = await call(admin(false), 'someone', { for_email: 'friend@example.test' }); assert.ok(no.isError && /administrator/i.test(no.text)); assert.equal((await svc.list('friend')).length, 0);
  const noBadge = await call(admin(false), 'someone', { give_badge: true }); assert.ok(noBadge.isError); assert.equal((await svc.list('someone')).length, 0, 'nothing was made'); assert.equal(badges.length, 0);
  const none = await call(undefined, 'boss', { for_email: 'friend@example.test' }); assert.ok(none.isError, 'without the admin service nobody gets this');
  const unknown = await call(admin(true), 'boss', { for_email: 'ghost@example.test' }); assert.ok(unknown.isError && /No account has the email ghost@example.test/.test(unknown.text));
  const ok = await call(admin(true), 'boss', { for_email: 'Friend@Example.test', publish: true }); assert.match(ok.text, /Created the venture page for Friend: 1 product\(s\), 3 picture\(s\)/); assert.doesNotMatch(ok.text, /badge was given/);
  assert.equal((await svc.list('friend')).length, 1); assert.equal((await svc.list('boss')).length, 0, 'it is on their account, not the administrator\'s'); assert.equal((await svc.list('friend'))[0].products[0].url, 'https://svc.example.test/'); assert.equal(badges.length, 0, 'no badge unless asked');
  const withBadge = await call(admin(true), 'boss', { for_email: 'friend@example.test', give_badge: true }); assert.match(withBadge.text, /Refreshed the venture page for Friend/); assert.match(withBadge.text, /blue verified badge was given/); assert.deepEqual(badges, [['friend', true, 'boss']]);
  assert.ok(audits.filter((a) => a === 'CHAT_VENTURE_PAGE').length >= 2, 'the actions are on the audit log');
  const mine = await call(admin(false), 'someone', { slug: 'mine-own', name: 'My Own Venture' }); assert.match(mine.text, /Created the venture page: /); assert.equal((await svc.list('someone')).length, 1, 'anyone can still build their own');
});

test('the verified check mark on the public page is a button that explains the badge; elsewhere it is just a mark', () => {
  const explain = { hint: 'Tap to see what this means', title: 'Verified by Bwenge', lead: 'X has the Bwenge verified badge.', points: ['A real person.'], link: { label: 'Get it', href: '/biz' }, close: 'Close' };
  const html = renderToString(React.createElement(VerifiedBadge, { label: 'Verified', explain })); assert.match(html, /<button/); assert.match(html, /aria-haspopup="dialog"/); assert.match(html, /aria-label="Verified\. Tap to see what this means"/); assert.doesNotMatch(html, /role="dialog"/, 'closed until tapped');
  const plain = renderToString(React.createElement(VerifiedBadge, { label: 'Verified' })); assert.doesNotMatch(plain, /<button/); assert.match(plain, /role="img"/);
});
