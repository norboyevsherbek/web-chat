const CACHE_NAME = 'uzchat-pro-v4';
const ASSETS = ['/', '/index.html', '/style.css', '/app.js', '/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/') || url.pathname.startsWith('/uploads/')) {
    return;
  }
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
