// Service Worker — Escola Nova Geração PWA
const CACHE_NAME = 'ng-pwa-v3';
const RECURSOS_PRECACHE = [
  '/',
  '/login',
  '/manifest.json',
  '/favicon.ico',
  '/favicon-128.png',
  '/icon-192.png',
  '/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(RECURSOS_PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Não intercepta chamadas de API mutativas, websockets ou balloons.js
  if (req.method !== 'GET' || url.pathname.startsWith('/api/') || url.pathname.startsWith('/ds/') || url.pathname === '/balloons.js') {
    return;
  }

  // Requisição de navegação / páginas HTML: Network First com fallback de Cache
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((response) => {
          if (response && response.status === 200) {
            const copia = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copia));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(req);
          if (cached) return cached;
          return caches.match('/login') || caches.match('/');
        })
    );
    return;
  }

  // Recursos estáticos (imagens, fontes, favicons): Stale While Revalidate
  event.respondWith(
    caches.match(req).then((cachedResponse) => {
      const fetchPromise = fetch(req)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const copia = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copia));
          }
          return networkResponse;
        })
        .catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});
