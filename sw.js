/* 湯守者 Service Worker：安裝時把整個遊戲下載到 iPad，之後完全離線運作 */
// build: 9027247669
importScripts('precache.js');

const CACHE = 'yushou-' + self.PRECACHE_VERSION;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // 分批下載，任何一個失敗就整批重來（避免只下載一半）
    const files = ['precache.js', ...self.PRECACHE_FILES];
    for (let i = 0; i < files.length; i += 8) {
      await cache.addAll(files.slice(i, i + 8).map((f) => new Request(f, { cache: 'reload' })));
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('yushou-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (req.mode === 'navigate') {
      return (await cache.match('./')) || (await cache.match('index.html')) || fetch(req);
    }
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      return await fetch(req);
    } catch (e) {
      return new Response('', { status: 504, statusText: 'offline' });
    }
  })());
});
