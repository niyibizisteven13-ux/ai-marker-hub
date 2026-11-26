import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { cached, invalidate } from '../server/services/cache/redis.js';

test('cache shares concurrent fills and retries a failure only on a new request', async () => {
  let calls = 0;
  const compute = async () => ++calls;
  assert.deepEqual(await Promise.all(Array.from({ length: 12 }, () => cached('test:shared', 30_000, compute))), Array(12).fill(1));
  const failure = new Error('load failed');
  const fail = async () => { calls++; throw failure; };
  const results = await Promise.allSettled([cached('test:failure', 30_000, fail), cached('test:failure', 30_000, fail)]);
  assert.ok(results.every(result => result.status === 'rejected' && result.reason === failure));
  assert.equal(calls, 2);
  assert.equal(await cached('test:failure', 30_000, compute), 3);
});

test('an invalidated in-flight fill cannot overwrite a newer fill', async () => {
  const old = Promise.withResolvers<number>();
  const started = Promise.withResolvers<void>();
  const first = cached('test:invalidate', 30_000, () => { started.resolve(); return old.promise; });
  await started.promise;
  await invalidate('test:invalidate');
  assert.equal(await cached('test:invalidate', 30_000, async () => 2), 2);
  old.resolve(1);
  assert.equal(await first, 1);
  assert.equal(await cached('test:invalidate', 30_000, async () => 3), 2);
});

test('offline worker restores public pages and excludes authenticated and unlisted requests', async () => {
  const origin = 'https://bwenge.example';
  const caches = new Map<string, Map<string, Response>>();
  let online = true;
  let status = 200;
  let requests = 0;
  let handler!: (event: object) => void;
  runInNewContext(readFileSync('public/sw.js', 'utf8'), {
    URL, Headers, Response, Request,
    self: { location: new URL(origin), addEventListener(name: string, callback: typeof handler) { if (name === 'fetch') handler = callback; } },
    caches: {
      async open(name: string) {
        if (!caches.has(name)) caches.set(name, new Map());
        const cache = caches.get(name)!;
        return {
          async match(key: string) { return cache.get(key)?.clone(); },
          async put(key: string, response: Response) { cache.set(key, response.clone()); },
          async keys() { return [...cache.keys()]; },
          async delete(key: string) { return cache.delete(key); },
        };
      },
    },
    async fetch(input: string | Request) {
      requests++;
      if (!online) throw new Error('offline');
      const url = typeof input === 'string' ? input : input.url;
      const response = new Response('fixture', { status, headers: {
        'content-type': url.endsWith('.js') ? 'text/javascript' : 'text/html', 'content-length': '7',
      } });
      Object.defineProperty(response, 'url', { value: url });
      return response;
    },
  });
  function request(path: string, mode = 'navigate', headers = new Headers()) {
    let result: Promise<Response> | undefined;
    handler({ clientId: 'test', request: { url: origin + path, mode, method: 'GET', headers },
      respondWith(response: Promise<Response>) { result = response; } });
    return result;
  }

  assert.equal(request('/api/biz/public/demo/me/card', 'cors'), undefined);
  assert.equal(request('/research', 'navigate', new Headers({ authorization: 'test' })), undefined);
  assert.equal(await (await request('/research'))?.text(), 'fixture');
  const before = requests;
  const assets = await Promise.all(Array.from({ length: 5 }, () => request('/assets/main-abcdefgh.js', 'cors')));
  assert.equal(requests - before, 1);
  assert.deepEqual(await Promise.all(assets.map(response => response?.text())), Array(5).fill('fixture'));
  online = false;
  assert.equal(await (await request('/research'))?.text(), 'fixture');
  assert.equal(await (await request('/assets/main-abcdefgh.js', 'cors'))?.text(), 'fixture');
  online = true;
  status = 404;
  assert.equal((await request('/research'))?.status, 404);
  online = false;
  await assert.rejects(request('/research')!, /offline/);
});
