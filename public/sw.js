/* 锦少灵签 service worker. Hand-written; never blocks a deploy:
 * - navigations: network-first, cached copy only when offline;
 * - hashed /assets/* (JS, CSS, font slices): cache-first, filled at runtime;
 * - other same-origin GETs (icon, manifest): network-first with cache fallback.
 * The cache name carries the build id from the registration URL (?v=BUILD_ID). */
const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const PREFIX = 'jinshao-';
const CACHE = PREFIX + VERSION;
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => Promise.all(SHELL.map((u) => cache.add(new Request(u, { cache: 'reload' })).catch(() => undefined))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(request, fallbackKey) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(request);
    if (res && res.ok && res.type === 'basic') cache.put(fallbackKey || request, res.clone());
    return res;
  } catch (err) {
    const hit = (await cache.match(fallbackKey || request)) || (await cache.match('/index.html'));
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res && res.ok && res.type === 'basic') cache.put(request, res.clone());
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/sw.js') return;
  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req, '/'));
    return;
  }
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(req));
    return;
  }
  event.respondWith(networkFirst(req));
});
