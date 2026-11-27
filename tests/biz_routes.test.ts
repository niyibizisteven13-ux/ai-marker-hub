import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import type { AddressInfo } from 'node:net';
import { prisma } from '../server/db.js';
import { getJwtSecret } from '../server/auth/secrets.js';
import { createBizService, type Kv } from '../server/services/biz/service.js';
import { memoryMediaStore } from '../server/services/biz/media.js';
import { setBizServiceForTests } from '../server/services/biz/runtime.js';
import { createBizRouter } from '../server/routes/bizRoutes.js';
import { renderShell } from '../server/services/biz/shell.js';
import { publicView } from '../server/services/biz/model.js';

// bwenge4biz over HTTP: what a visitor can reach, what only the owner can, and video that can be played and sought.
const data = new Map<string, unknown>();
const kv: Kv = { async get<T>(k: string) { return (data.has(k) ? JSON.parse(JSON.stringify(data.get(k))) : null) as T | null; }, async put(k, v) { data.set(k, JSON.parse(JSON.stringify(v))); }, async del(k) { data.delete(k); } };
setBizServiceForTests(createBizService({ kv, media: memoryMediaStore(), isPaid: async () => true }));
const db = prisma as any;
const mkUser = async (id: string) => { await db.user.create({ data: { id, email: `${id}@t.rw`, name: id, passwordHash: 'x', role: 'INSTRUCTOR' } }).catch(() => undefined); return jwt.sign({ userId: id, email: `${id}@t.rw`, role: 'user' }, getJwtSecret(), { algorithm: 'HS256', issuer: 'bwenge', audience: 'bwenge-web', expiresIn: '10m' }); };
const app = express(); app.use(express.json()); app.use('/api/biz', createBizRouter());
const srv = app.listen(0); const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/api/biz`; test.after(() => srv.close());
const call = (path: string, o: { method?: string; token?: string; body?: unknown; headers?: Record<string, string> } = {}) => fetch(base + path, { method: o.method ?? (o.body ? 'POST' : 'GET'), headers: { ...(o.body !== undefined && !(o.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...(o.token ? { Authorization: `Bearer ${o.token}` } : {}), ...o.headers }, body: o.body instanceof FormData ? o.body : o.body !== undefined ? JSON.stringify(o.body) : undefined });
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(50, 1)]);
const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42'), Buffer.from(Array.from({ length: 200 }, (_, i) => i % 256))]);
const upload = (name: string, data: Buffer, type: string) => { const f = new FormData(); f.append('file', new Blob([data], { type }), name); return f; };

test('owner routes are closed without a sign-in; public routes work without one', async () => {
  for (const [m, p] of [['GET', '/mine'], ['POST', '/'], ['GET', '/abc'], ['PATCH', '/abc'], ['DELETE', '/abc'], ['GET', '/abc/enquiries'], ['GET', '/abc/stats'], ['GET', '/abc/media-urls'], ['GET', '/abc/preview']] as const) assert.equal((await call(p, { method: m, body: m === 'GET' || m === 'DELETE' ? undefined : {} })).status, 401, `${m} ${p}`);
  assert.equal((await call('/public/nothing-here')).status, 404);
});

test('the whole story: create, fill, add a photo and a video, publish, visit, send a message, read it as the owner', async () => {
  const owner = await mkUser('biz-owner-1'), other = await mkUser('biz-owner-2');
  const created = await (await call('/', { token: owner, body: { name: 'Mama Grace Cafe', category: 'restaurant' } })).json(); const id = created.business.id, slug = created.business.slug; assert.equal(slug, 'mama-grace-cafe');
  assert.equal((await call(`/${id}`, { token: other })).status, 404, 'another owner cannot open it');
  for (const route of ['/members', '/ledger', '/programs']) {
    assert.equal((await call(`/${id}${route}`)).status, 401, route);
    assert.equal((await call(`/${id}${route}`, { token: other })).status, 404, route);
    assert.equal((await call(`/${id}${route}`, { token: owner })).status, 200, route);
  }
  assert.equal((await call(`/${id}`, { method: 'PATCH', token: other, body: { name: 'x' } })).status, 404);
  await call(`/${id}`, { method: 'PATCH', token: owner, body: { tagline: 'Fresh every day', about: 'Rice, beans and juice.', whatsapp: '+250788123456', notes: 'PRIVATE-NOTE', momoCode: '123456', showPay: true } });
  await call(`/${id}/products`, { token: owner, body: { name: 'Rice and beans', price: 1500 } }); await call(`/${id}/products`, { token: owner, body: { name: 'Secret special', price: 1, hidden: true } });
  const photo = await (await call(`/${id}/media`, { token: owner, body: upload('front.png', png, 'image/png') })).json(); assert.equal(photo.media.kind, 'image');
  const video = await (await call(`/${id}/media`, { token: owner, body: upload('tour.mp4', mp4, 'video/mp4') })).json(); assert.equal(video.media.kind, 'video');
  assert.equal((await call(`/${id}/media`, { token: owner, body: upload('evil.png', Buffer.from('<svg><script>1</script></svg>'), 'image/png') })).status, 415);

  assert.equal((await call(`/public/${slug}`)).status, 404, 'not public until published');
  assert.equal((await call(`/${id}/publish`, { token: owner, body: { on: true } })).status, 200);
  const page = await (await call(`/public/${slug}`)).json(); const text = JSON.stringify(page);
  assert.equal(page.business.name, 'Mama Grace Cafe'); assert.equal(page.business.products.length, 1); assert.deepEqual(page.business.pay, { momoCode: '123456' });
  for (const secret of ['PRIVATE-NOTE', 'Secret special', 'ownerId', 'biz-owner-1', 'notes']) assert.ok(!text.includes(secret), `public answer leaked ${secret}`);

  const v = page.business.gallery.find((g: any) => g.kind === 'video'); const whole = await call(`/public/${slug}/media/${v.id}`);
  assert.equal(whole.status, 200); assert.equal(whole.headers.get('content-type'), 'video/mp4'); assert.equal(whole.headers.get('x-content-type-options'), 'nosniff'); assert.match(whole.headers.get('content-security-policy') ?? '', /sandbox/); assert.equal(whole.headers.get('accept-ranges'), 'bytes');
  assert.equal(Buffer.from(await whole.arrayBuffer()).length, mp4.length);
  const part = await call(`/public/${slug}/media/${v.id}`, { headers: { Range: 'bytes=10-19' } }); assert.equal(part.status, 206); assert.equal(part.headers.get('content-range'), `bytes 10-19/${mp4.length}`); assert.equal(Buffer.from(await part.arrayBuffer()).length, 10);
  assert.equal((await call(`/public/${slug}/media/${v.id}`, { headers: { Range: 'bytes=9999-' } })).status, 416);

  assert.equal((await call(`/public/${slug}/track`, { body: { kind: 'whatsapp' } })).status, 200); assert.equal((await call(`/public/${slug}/track`, { body: { kind: 'hack' } })).status, 400);
  assert.equal((await call(`/public/${slug}/enquiry`, { body: { name: 'Jean', contact: '0788111222', message: 'Open on Sunday?' } })).status, 201);
  assert.equal((await call(`/public/${slug}/enquiry`, { body: { contact: 'x', message: 'hi' } })).status, 400);
  const msgs = await (await call(`/${id}/enquiries`, { token: owner })).json(); assert.equal(msgs.enquiries[0].message, 'Open on Sunday?'); assert.equal((await call(`/${id}/enquiries`, { token: other })).status, 404);
  const stats = await (await call(`/${id}/stats`, { token: owner })).json(); assert.ok(stats.last30.views >= 1 && stats.last30.whatsapp === 1 && stats.newMessages === 1);
  const urls = (await (await call(`/${id}/media-urls`, { token: owner })).json()).urls as Record<string, string>; assert.equal((await fetch(`http://127.0.0.1:${(srv.address() as AddressInfo).port}${urls[photo.media.id]}`)).status, 200, 'the owner can preview their files by a signed link');
  assert.equal((await call(`/${id}/media-urls`, { token: other })).status, 404); const bad = urls[photo.media.id].replace(/sig=.{4}/, 'sig=AAAA'); assert.equal((await fetch(`http://127.0.0.1:${(srv.address() as AddressInfo).port}${bad}`)).status, 403, 'a changed link does not work');
  assert.equal((await fetch(`http://127.0.0.1:${(srv.address() as AddressInfo).port}${urls[photo.media.id].replace(/exp=\d+/, 'exp=1')}`)).status, 403, 'an old link does not work');
  const pv = await (await call(`/${id}/preview`, { token: owner })).json(); assert.equal(pv.business.name, 'Mama Grace Cafe'); assert.ok(!JSON.stringify(pv).includes('PRIVATE-NOTE'), 'the owner preview is the public view, not the private one');
  assert.equal((await call(`/${id}`, { method: 'DELETE', token: owner })).status, 204); assert.equal((await call(`/public/${slug}`)).status, 404);
});

test('the share preview carries the business’s own words, escaped, and its cover photo', () => {
  const b: any = { slug: 'mama-grace', name: 'Mama <Grace> & "Sons"', category: 'restaurant', tagline: 'Fresh </title><script>alert(1)</script>', about: '', theme: 'gold', contact: {}, hours: [], products: [], gallery: [], cover: { id: 'c1', kind: 'image' }, updatedAt: 'x' };
  const html = renderShell('<html><head><title>Bwenge</title><meta name="description" content="old" /></head><body></body></html>', b, 'https://www.bwenge.space/');
  assert.match(html, /<title>Mama &lt;Grace&gt; &amp; &quot;Sons&quot; · Restaurant \| Bwenge4Biz<\/title>/); assert.ok(!html.includes('<script>alert(1)'), 'no markup from a business gets through');
  assert.ok(html.includes('property="og:image" content="https://www.bwenge.space/api/biz/public/mama-grace/media/c1"')); assert.ok(html.includes('rel="canonical" href="https://www.bwenge.space/b/mama-grace"')); assert.equal((html.match(/name="description"/g) ?? []).length, 1, 'the old description is replaced');
  void publicView;
});

test('a feed video of about a minute (tens of MB) uploads over HTTP, and an oversized one is refused straight away with a clear message', async () => {
  const owner = await mkUser('biz-owner-video'); const created = await (await call('/', { token: owner, body: { name: 'Video Cafe', category: 'restaurant' } })).json(); const id = created.business.id;
  const minute = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42'), Buffer.alloc(40 * 1024 * 1024, 7)]);
  const ok = await call(`/${id}/media`, { token: owner, body: (() => { const f = upload('minute.mp4', minute, 'video/mp4'); f.append('scope', 'feed'); return f; })() }); assert.equal(ok.status, 201); const j = await ok.json(); assert.equal(j.media.kind, 'video'); assert.equal(j.media.size, minute.length);
  // the declared size is checked before any of the file is read
  const huge = await fetch(`${base}/${id}/media`, { method: 'POST', headers: { Authorization: `Bearer ${owner}`, 'Content-Type': 'multipart/form-data; boundary=x', 'Content-Length': String(300 * 1024 * 1024) }, body: '--x--\r\n' }).catch(() => null);
  if (huge) { assert.equal(huge.status, 413); assert.match((await huge.json()).error, /up to 200 MB/); }
});

test('video delivery is steady: pieces on request, a validator (304) so a repeat costs nothing, a year of caching for an address that names its revision, and an abandoned download does not hurt the server', async () => {
  const owner = await mkUser('biz-owner-stream'); const created = await (await call('/', { token: owner, body: { name: 'Stream Cafe', category: 'restaurant' } })).json(); const id = created.business.id, slug = created.business.slug;
  await call(`/${id}`, { method: 'PATCH', token: owner, body: { about: 'Streaming test' } });
  const big = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42'), Buffer.alloc(3 * 1024 * 1024, 5)]);
  const up = await (await call(`/${id}/media`, { token: owner, body: upload('long.mp4', big, 'video/mp4') })).json(); await call(`/${id}/publish`, { token: owner, body: { on: true } });
  const url = `/public/${slug}/media/${up.media.id}`;
  const first = await call(url); assert.equal(first.status, 200); const etag = first.headers.get('etag'); assert.match(etag ?? '', /^W\/"/); assert.equal(first.headers.get('cache-control'), 'public, max-age=3600'); await first.arrayBuffer();
  const again = await call(url, { headers: { 'If-None-Match': etag! } }); assert.equal(again.status, 304, 'unchanged: nothing is sent again'); assert.equal((await again.arrayBuffer()).byteLength, 0);
  const keep = await call(`${url}?r=1700000000000`); assert.equal(keep.headers.get('cache-control'), 'public, max-age=31536000, immutable', 'the revision in the address makes it safe to keep for a year'); await keep.arrayBuffer();
  const piece = await call(url, { headers: { Range: 'bytes=1048576-2097151', 'If-None-Match': etag! } }); assert.equal(piece.status, 206, 'a player asking for a piece always gets the piece'); assert.equal(piece.headers.get('content-range'), `bytes 1048576-2097151/${big.length}`); assert.equal(Buffer.from(await piece.arrayBuffer()).length, 1048576);
  const tail = await call(url, { headers: { Range: 'bytes=-100' } }); assert.equal(tail.status, 206); assert.equal(Buffer.from(await tail.arrayBuffer()).length, 100, 'the last 100 bytes: players read the end of a file to find its index');
  assert.equal((await call(`${url}?q=lq`)).status, 404, 'no light version exists for this upload'); assert.equal((await call(`${url}/poster`)).status, 404, 'and no poster');
  // a player abandons a download (a seek): the server carries on
  const ac = new AbortController(); const r = await fetch(base + url, { signal: ac.signal }); const reader = r.body!.getReader(); await reader.read(); ac.abort(); await reader.cancel().catch(() => undefined);
  const after = await call(url, { headers: { Range: 'bytes=0-9' } }); assert.equal(after.status, 206, 'still serving'); await after.arrayBuffer();
  assert.equal((await call(`/public/${slug}/media/not-a-real-id`)).status, 404);
});
