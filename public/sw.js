/* Bwenge service worker. It only makes the site installable: it caches nothing and passes every request straight to the network,
   so an update to the site is always what people see (no stale pages, no offline surprises). */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => { /* network as usual */ });
