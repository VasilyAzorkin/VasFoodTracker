// Service Worker: офлайн-кэш всех файлов приложения и CDN-библиотек.
// При изменении файлов приложения увеличьте VERSION — клиенты получат обновление.
const VERSION = 'v1.0.2';
const APP_CACHE = `kbzhu-app-${VERSION}`;
const CDN_CACHE = 'kbzhu-cdn-v1';

const APP_FILES = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/app.js',
  './js/db.js',
  './js/calc.js',
  './js/voice.js',
  './js/sync.js',
  './js/remote.js',
  './js/seed.js',
  './js/ui/common.js',
  './js/ui/diary.js',
  './js/ui/products.js',
  './js/ui/dishes.js',
  './js/ui/search.js',
  './js/ui/settings.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

const CDN_FILES = [
  'https://cdn.jsdelivr.net/npm/dexie@4.0.8/dist/dexie.mjs',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js',
];

const CDN_HOSTS = ['cdn.jsdelivr.net'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const app = await caches.open(APP_CACHE);
    await app.addAll(APP_FILES.map((u) => new Request(u, { cache: 'reload' })));
    // CDN — по возможности: ошибка не должна ломать установку.
    const cdn = await caches.open(CDN_CACHE);
    await Promise.all(CDN_FILES.map(async (url) => {
      if (await cdn.match(url)) return;
      try {
        const res = await fetch(url, { mode: 'cors' });
        if (res.ok) await cdn.put(url, res);
      } catch { /* офлайн при установке — закэшируем позже */ }
    }));
    // Первая установка активируется сразу; обновления ждут подтверждения пользователя.
    if (!self.registration.active) self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('kbzhu-app-') && k !== APP_CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Библиотеки с CDN: cache-first (версии зафиксированы, файлы неизменны).
  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(req, CDN_CACHE));
    return;
  }

  // Чужие домены (Supabase API, удалённые источники) — только сеть, не трогаем.
  if (url.origin !== self.location.origin) return;

  // Навигация: оболочка приложения из кэша, при отсутствии — сеть.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(APP_CACHE);
      const cached = await cache.match('./index.html');
      if (cached && url.pathname.endsWith('/') || cached && url.pathname.endsWith('/index.html')) return cached;
      try {
        return await fetch(req);
      } catch {
        return cached || Response.error();
      }
    })());
    return;
  }

  // Данные (например, data/*.json для удалённых источников): сначала сеть.
  if (url.pathname.includes('/data/')) {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) (await caches.open(CDN_CACHE)).put(req, res.clone());
        return res;
      } catch {
        return (await caches.match(req)) || Response.error();
      }
    })());
    return;
  }

  // Файлы приложения: cache-first; прочие свои файлы (например, tests/) — сеть.
  event.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: true });
    if (cached) return cached;
    try {
      return await fetch(req);
    } catch {
      return Response.error();
    }
  })());
});

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req, { ignoreVary: true });
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
    return res;
  } catch {
    return Response.error();
  }
}
