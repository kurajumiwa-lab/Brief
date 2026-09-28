/* WAIRO SERVICE WORKER — the offline shell.
 *
 * Rules, honestly stated:
 *   1. Hashed build assets (/assets/*): cache-first. The filenames change on
 *      every build, so a cached copy is always the exact version the HTML asked
 *      for. This is what makes a dead-signal reload still paint the app.
 *   2. Navigations (the HTML): network-first, falling back to the cached
 *      shell. The freshest HTML wins when there is signal.
 *   3. The API (/ingest/*): NEVER cached. A cached API response that pretends
 *      to be live is a lie; writes go through the offline queue instead
 *      (src/api/offlineQueue.ts) with server-side idempotency keys.
 *   4. Cross-origin (fonts, Telegram SDK): pass through untouched.
 */
const SHELL_CACHE = 'wairo-shell-v3';
const ASSET_CACHE = 'wairo-assets-v3';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((c) => c.addAll(['/', '/manifest.webmanifest']).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => ![SHELL_CACHE, ASSET_CACHE].includes(k)).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // rule 4
  if (url.pathname.startsWith('/ingest') || url.pathname.startsWith('/api/')) return;  // rule 3: never the API

  if (req.method !== 'GET') return; // writes are the queue's job, not ours

  if (url.pathname.startsWith('/assets/')) {
    // Rule 1: cache-first for immutable, hashed assets.
    event.respondWith(
      caches.open(ASSET_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      })
    );
    return;
  }

  if (req.mode === 'navigate') {
    // Rule 2: network-first, cached shell as the honest fallback.
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          const cache = await caches.open(SHELL_CACHE);
          cache.put('/', res.clone());
          return res;
        } catch {
          const cached = await caches.match('/');
          return cached ?? Response.error();
        }
      })()
    );
  }
});
