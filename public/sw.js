// Brick Tracker service worker. Makes the web app installable (Android,
// ChromeOS, Googlebook, desktop Chrome) and quick to open, without ever
// serving stale data:
// - the page itself is fetched from the network first, so a new deploy shows
//   at once; the cached copy is only for opening while offline;
// - /assets/ files have content hashes in their names and never change, so
//   they are served from the cache once fetched;
// - /api/ and every other origin (Firebase, Google sign-in, shop images) are
//   left alone: live data is never cached here.
// Registered by src/lib/pwa.ts on the website only, not in the desktop app.

const CACHE = 'brick-tracker-v1';
const MAX_ASSETS = 80;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Every deploy adds new hashed assets; keep the cache from growing for ever.
async function trim(cache) {
  const keys = await cache.keys();
  const assets = keys.filter((r) => new URL(r.url).pathname.startsWith('/assets/'));
  await Promise.all(assets.slice(0, Math.max(0, assets.length - MAX_ASSETS)).map((r) => cache.delete(r)));
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            event.waitUntil(caches.open(CACHE).then((c) => c.put('/', copy)));
          }
          return response;
        })
        // Offline: the app shell, which routes by path itself (registry links too).
        .catch(() => caches.match('/').then((hit) => hit || Response.error()))
    );
    return;
  }

  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              event.waitUntil(caches.open(CACHE).then((c) => c.put(request, copy).then(() => trim(c))));
            }
            return response;
          })
      )
    );
  }
});
