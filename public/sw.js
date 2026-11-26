/* Public offline pages and versioned assets. Private API requests use the network. */
const PAGE_CACHE = 'bwenge-biz-offline-v1';
const ASSET_CACHE = 'bwenge-static-v1';
const MAX_AGE = 24 * 60 * 60 * 1000;
const slugPattern = '[a-z0-9][a-z0-9-]{0,63}';
const businessPage = new RegExp('^/b/(' + slugPattern + ')/?$');
const businessData = new RegExp('^/api/biz/public/' + slugPattern + '$');
const businessIcon = new RegExp('^/api/biz/public/' + slugPattern + '/icon-(192|512)\\.png$');
const asset = /^\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.(js|css|woff2)$/;
const publicShell = path => !self.location.hostname.startsWith('myseb.') &&
  (businessPage.test(path) || path === '/' || path === '/research' || path === '/get-app');

const assetLoads = new Map();
const writes = new Map();

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const key of await caches.keys()) {
    if ((key.startsWith('bwenge-biz-offline-') || key.startsWith('bwenge-static-')) && key !== PAGE_CACHE && key !== ASSET_CACHE) {
      await caches.delete(key);
    }
  }
  await self.clients.claim();
})()));

async function putBounded(name, key, response, limit) {
  const previous = writes.get(name);
  const write = (previous ?? Promise.resolve()).catch(() => {}).then(async () => {
    const cache = await caches.open(name);
    await cache.put(key, response);
    const keys = await cache.keys();
    await Promise.all(keys.slice(0, Math.max(0, keys.length - limit)).map(entry => cache.delete(entry)));
  });
  writes.set(name, write);
  try { await write; } finally {
    if (writes.get(name) === write) writes.delete(name);
  }
}

function isCacheable(response, type) {
  return response.status === 200 && !response.redirected && new URL(response.url).origin === self.location.origin &&
    (response.headers.get('content-type') || '').includes(type) &&
    !/\b(?:private|no-store)\b/i.test(response.headers.get('cache-control') || '') &&
    !/(?:^|,)\s*(?:cookie|authorization|\*)\s*(?:,|$)/i.test(response.headers.get('vary') || '');
}

async function savePublic(key, response, expected) {
  const maxBytes = 1024 * 1024;
  if (!isCacheable(response, expected) || Number(response.headers.get('content-length')) > maxBytes) return;
  const copy = response.clone();
  const data = await copy.blob();
  if (data.size > maxBytes) return;
  const headers = new Headers(copy.headers);
  headers.delete('Content-Encoding');
  headers.delete('Content-Length');
  headers.set('X-Bwenge-Offline-Saved', String(Date.now()));
  await putBounded(PAGE_CACHE, key, new Response(data, { headers }), 64);
}

async function savedPublic(key) {
  try {
    const previous = await (await caches.open(PAGE_CACHE)).match(key);
    const timestamp = Number(previous?.headers.get('X-Bwenge-Offline-Saved'));
    if (previous && Date.now() - timestamp < MAX_AGE) return previous;
  } catch { /* The network error remains authoritative when storage fails. */ }
}

async function networkFirst(request, key, expected, save = true) {
  let response;
  try { response = await fetch(request); } catch (error) {
    const previous = await savedPublic(key);
    if (previous) return previous;
    throw error;
  }
  try {
    if (response.status === 404 || response.status === 410) {
      await (await caches.open(PAGE_CACHE)).delete(key);
    } else if (save) {
      await savePublic(key, response, expected);
    }
  } catch { /* A storage failure must not interrupt an online request. */ }
  return response;
}

async function staticAsset(url) {
  try {
    const cached = await (await caches.open(ASSET_CACHE)).match(url);
    if (cached) return cached;
  } catch { /* Fall back to the network if browser storage is unavailable. */ }

  let load = assetLoads.get(url);
  if (!load) {
    load = (async () => {
      const response = await fetch(url, { credentials: 'omit' });
      const expected = url.endsWith('.js') ? 'javascript' : url.endsWith('.css') ? 'text/css' : 'font/woff2';
      const size = Number(response.headers.get('content-length'));
      if (size > 0 && size <= 2 * 1024 * 1024 && isCacheable(response, expected)) {
        try { await putBounded(ASSET_CACHE, url, response.clone(), 128); } catch { /* Storage unavailable. */ }
      }
      return response;
    })();
    assetLoads.set(url, load);
    const clean = () => { if (assetLoads.get(url) === load) assetLoads.delete(url); };
    void load.then(clean, clean);
  }
  return (await load).clone();
}

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || req.headers.has('authorization') || req.headers.has('range')) return;
  const path = url.pathname;
  if (req.mode === 'navigate' && publicShell(path)) {
    const canonical = url.origin + (businessPage.test(path) ? path.replace(/\/$/, '') : path);
    event.respondWith(networkFirst(req, canonical, 'text/html', !url.search));
  } else if ((businessData.test(path) && !url.search) || businessIcon.test(path)) {
    event.respondWith(networkFirst(req, url.href, businessData.test(path) ? 'application/json' : 'image/png'));
  } else if (asset.test(path) && !url.search && event.clientId) {
    event.respondWith(staticAsset(url.href));
  }
});

self.addEventListener('message', event => {
  if (!['WARM_BIZ_OFFLINE', 'WARM_PUBLIC_OFFLINE'].includes(event.data?.type) || !event.source?.url) return;
  const page = new URL(event.source.url);
  if (page.origin !== self.location.origin || !publicShell(page.pathname)) return;
  const biz = page.pathname.match(businessPage);
  const shell = page.origin + (biz ? '/b/' + biz[1] : page.pathname);
  const assets = Array.isArray(event.data.assets) ? event.data.assets.slice(0, 128) : [];
  const requests = [...new Set(assets)].filter(path => typeof path === 'string' && asset.test(path))
    .map(path => staticAsset(page.origin + path));
  requests.push(networkFirst(new Request(shell, { credentials: 'omit' }), shell, 'text/html'));
  if (biz) {
    const details = page.origin + '/api/biz/public/' + biz[1];
    requests.push(networkFirst(new Request(details, { credentials: 'omit' }), details, 'application/json'));
  }
  event.waitUntil(Promise.allSettled(requests));
});
