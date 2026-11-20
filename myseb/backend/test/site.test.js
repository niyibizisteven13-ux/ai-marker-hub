// The public product page and the baseline security headers.
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.TEACHER_KEY = 'tkey'; process.env.PEPPER = 'testpepper'; process.env.PUBLIC_URL = 'http://127.0.0.1:0/myseb';
const { app } = await import('../src/server.js');
const { migrate, pool } = await import('../src/db.js');
await migrate();
const server = app.listen(0); const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => { server.close(); pool.end(); });

test('"/about" is the product page, links carry the public prefix, and it is locked down; "/" still opens the dashboard', async () => {
  const root = await fetch(base + '/', { redirect: 'manual' });
  assert.equal(root.headers.get('location'), '/myseb/dashboard/');
  const r = await fetch(base + '/about');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /html/);
  assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  const html = await r.text();
  assert.match(html, /MySEB/); assert.ok(!html.includes('__BASE__'));
  assert.ok(html.includes('href="/myseb/dashboard/"'));
  assert.ok(html.includes('/myseb/download?platform=windows'));
});

test('site assets are served and every response carries the baseline headers', async () => {
  const css = await fetch(base + '/site/site.css');
  assert.equal(css.status, 200);
  assert.equal(css.headers.get('x-content-type-options'), 'nosniff');
  assert.match(css.headers.get('permissions-policy'), /geolocation=\(\)/);
  assert.equal((await fetch(base + '/dashboard/')).status, 200);
});
