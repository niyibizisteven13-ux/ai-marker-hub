import test from 'node:test';
import assert from 'node:assert/strict';
import { contentSecurityPolicy } from '../server/utils/csp.ts';

test('CSP: enforced in production, strict scripts for the app, sandbox policy for AI-generated HTML', () => {
  const prod = { NODE_ENV: 'production' } as NodeJS.ProcessEnv;
  const app = contentSecurityPolicy('/', prod)!;
  assert.equal(app.header, 'Content-Security-Policy');
  assert.match(app.value, /script-src 'self'/);
  assert.doesNotMatch(app.value, /script-src[^;]*'unsafe-inline'/);
  assert.match(app.value, /object-src 'none'/);
  const sb = contentSecurityPolicy('/sandbox.html', prod)!;
  assert.match(sb.value, /^sandbox allow-scripts/);
  assert.match(sb.value, /connect-src 'none'/);
  assert.equal(contentSecurityPolicy('/scanner.html', prod), null, 'the Telegram scanner keeps its own rules');
  assert.equal(contentSecurityPolicy('/api/health', prod), null);
  assert.equal(contentSecurityPolicy('/', { NODE_ENV: 'production', CSP_MODE: 'report' } as any)!.header, 'Content-Security-Policy-Report-Only');
  assert.equal(contentSecurityPolicy('/', { NODE_ENV: 'development' } as any), null);
});

test('cluster roles: one primary runs the site-wide schedules; other servers are web nodes', async () => {
  const { nodeRole, isPrimary } = await import('../server/utils/cluster.ts');
  const prev = process.env.NODE_ROLE;
  try {
    delete process.env.NODE_ROLE;
    assert.equal(nodeRole(), 'primary', 'a single server keeps doing everything');
    process.env.NODE_ROLE = 'web';
    assert.equal(isPrimary(), false);
  } finally { if (prev === undefined) delete process.env.NODE_ROLE; else process.env.NODE_ROLE = prev; }
});

test('shared rate limits fall back to local memory when Redis is not configured', async () => {
  const prev = process.env.REDIS_URL;
  delete process.env.REDIS_URL;
  try {
    const { SharedRateLimitStore, cached } = await import('../server/services/cache/redis.ts');
    const store = new SharedRateLimitStore('t');
    store.init({ windowMs: 60_000 } as any);
    assert.equal((await store.increment('ip')).totalHits, 1);
    assert.equal((await store.increment('ip')).totalHits, 2);
    await store.resetKey('ip');
    assert.equal((await store.increment('ip')).totalHits, 1);
    let calls = 0;
    const f = () => cached('k', 10_000, async () => ++calls);
    assert.equal(await f(), 1);
    assert.equal(await f(), 1, 'computed once, then served from the cache');
  } finally { if (prev !== undefined) process.env.REDIS_URL = prev; }
});
