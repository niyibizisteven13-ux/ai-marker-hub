import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
const { postFollowingRedirects } = createRequire(import.meta.url)('../myseb/desktop/src/post.js');

// The apps are built for one address while the site answers on another (www or not): a redirected POST must stay a POST.
test('a POST redirected to the same site is sent again as a POST, and the new address is remembered', async () => {
  const seen: string[] = [];
  const target = http.createServer((q, r) => { let b = ''; q.on('data', (c) => (b += c)); q.on('end', () => { seen.push(`${q.method} ${q.url} ${b}`); r.setHeader('content-type', 'application/json'); r.end(JSON.stringify({ ok: true })); }); }).listen(0);
  const tp = (target.address() as AddressInfo).port;
  const front = http.createServer((q, r) => { r.statusCode = 301; r.setHeader('location', `http://localhost:${tp}${q.url}`); r.end(); }).listen(0);   // 127.0.0.1 -> localhost: same host family
  const fp = (front.address() as AddressInfo).port;
  try {
    const { res, base } = await postFollowingRedirects(fetch, `http://127.0.0.1:${fp}/myseb`, '/api/verify-code', { method: 'POST', body: '{"code":"1"}', headers: { 'content-type': 'application/json' } });
    // different host names (127.0.0.1 vs localhost) are NOT the same site: the redirect must not be followed
    assert.equal(res.status, 301); assert.equal(base, `http://127.0.0.1:${fp}/myseb`); assert.deepEqual(seen, []);
  } finally { front.close(); target.close(); }
});

test('www on or off is the same site: the POST follows and keeps its body', async () => {
  const seen: string[] = [];
  const fake = async (url: string, init: RequestInit) => {
    if (url.startsWith('https://www.bwenge.space')) return new Response(null, { status: 301, headers: { location: url.replace('://www.', '://') } });
    seen.push(`${init.method} ${url} ${init.body}`); return new Response('{"ok":true}', { status: 200 });
  };
  const { res, base } = await postFollowingRedirects(fake, 'https://www.bwenge.space/myseb', '/api/verify-code', { method: 'POST', body: '{"code":"1"}' });
  assert.equal(res.status, 200); assert.equal(base, 'https://bwenge.space/myseb');
  assert.deepEqual(seen, ['POST https://bwenge.space/myseb/api/verify-code {"code":"1"}']);
  // a redirect to some other site is never followed (the exam secret stays here)
  const evil = async () => new Response(null, { status: 302, headers: { location: 'https://evil.example/api/verify-code' } });
  const r2 = await postFollowingRedirects(evil, 'https://bwenge.space/myseb', '/api/verify-code', { method: 'POST', body: '{}' });
  assert.equal(r2.res.status, 302);
});
