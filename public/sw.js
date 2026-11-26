/* Offline support for the public Bwenge4Biz shell. Authenticated API traffic goes directly to the server. */
const CACHE = 'bwenge-biz-offline-v1';
const MAX_AGE = 24 * 60 * 60 * 1000;
const slugPattern = '[a-z0-9][a-z0-9-]{0,63}';
const businessPage = new RegExp('^/b/(' + slugPattern + ')/?$');
const businessData = new RegExp('^/api/biz/public/' + slugPattern + '$');
const businessIcon = new RegExp('^/api/biz/public/' + slugPattern + '/icon-(192|512)\\.png$');
const asset = /^\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.(js|css|woff2)$/;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const key of await caches.keys()) {
    if (key.startsWith('bwenge-biz-offline-') && key !== CACHE) await caches.delete(key);
  }
  await self.clients.claim();
})()));

async function networkFirst(request, key) {
  try {
    const response = await fetch(request);
    const type = response.headers.get('content-type') || '';
    const path = new URL(key).pathname;
    const expected = businessPage.test(path) ? 'text/html' : businessData.test(path) ? 'application/json' : 'image/png';
    if (response.ok && type.includes(expected) && new URL(response.url).origin === self.location.origin) {
      try {
        const cache = await caches.open(CACHE);
        const copy = response.clone();
        const headers = new Headers(copy.headers);
        headers.delete('Content-Encoding');
        headers.delete('Content-Length');
        headers.set('X-Bwenge-Offline-Saved', String(Date.now()));
        await cache.put(key, new Response(await copy.blob(), { headers }));
      } catch { /* Storage limits should not interrupt the live page. */ }
    } else if (response.status === 404 || response.status === 410) {
      try { await (await caches.open(CACHE)).delete(key); } catch { /* Cache unavailable. */ }
    }
    return response;
  } catch (error) {
    const previous = await (await caches.open(CACHE)).match(key);
    const savedAt = Number(previous?.headers.get('X-Bwenge-Offline-Saved'));
    if (previous && Date.now() - savedAt < MAX_AGE) return previous;
    throw error;
  }
}

async function staticAsset(url) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(url);
  if (cached) return cached;
  const response = await fetch(url, { credentials: 'omit' });
  if (response.ok && new URL(response.url).origin === self.location.origin) {
    try { await cache.put(url, response.clone()); } catch { /* Storage unavailable. */ }
  }
  return response;
}

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || req.headers.has('authorization')) return;
  const page = url.pathname.match(businessPage);
  if (req.mode === 'navigate' && page) {
    const shell = new URL('/b/' + page[1], url.origin).href;
    if (url.searchParams.has('tick') || url.searchParams.has('pass')) {
      event.respondWith(fetch(req).catch(async error => {
        const cached = await (await caches.open(CACHE)).match(shell);
        if (cached && Date.now() - Number(cached.headers.get('X-Bwenge-Offline-Saved')) < MAX_AGE) return cached;
        throw error;
      }));
    } else {
      event.respondWith(networkFirst(req, shell));
    }
  } else if (businessData.test(url.pathname) || businessIcon.test(url.pathname)) {
    event.respondWith(networkFirst(req, url.origin + url.pathname));
  } else if (asset.test(url.pathname) && event.clientId) {
    event.respondWith((async () => {
      const client = await self.clients.get(event.clientId);
      if (client && businessPage.test(new URL(client.url).pathname)) {
        try { return await staticAsset(url.href); } catch { /* Fall back to the normal fetch. */ }
      }
      return fetch(req);
    })());
  }
});

self.addEventListener('message', event => {
  if (event.data?.type !== 'WARM_BIZ_OFFLINE' || !event.source?.url) return;
  const page = new URL(event.source.url);
  if (page.origin !== self.location.origin || !businessPage.test(page.pathname)) return;
  const url = page.origin + page.pathname.replace(/\/$/, '');
  const assets = Array.isArray(event.data.assets) ? event.data.assets.slice(0, 200) : [];
  const slug = page.pathname.match(businessPage)[1];
  const details = page.origin + '/api/biz/public/' + slug;
  event.waitUntil(Promise.allSettled([
    networkFirst(new Request(details, { credentials: 'omit' }), details),
    networkFirst(new Request(url, { credentials: 'omit' }), url),
    ...assets.filter(path => typeof path === 'string' && asset.test(path)).map(path => staticAsset(page.origin + path)),
  ]));
});
