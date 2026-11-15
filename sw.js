// Offline cache for the app shell. Bump VERSION after changing any app file.
const VERSION = 'kk-prompter-v2';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// network first (so updates arrive), cache as offline fallback
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then((r) => {
      const copy = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)).catch(() => {});
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((m) => m || caches.match('index.html')))
  );
});
