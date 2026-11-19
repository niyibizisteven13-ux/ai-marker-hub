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
