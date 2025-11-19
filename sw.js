const CACHE_NAME = 'lingualive-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        // We don't strict check failures here to allow rapid dev
        return cache.addAll(urlsToCache).catch(err => console.log("Cache add failed", err));
      })
  );
});

self.addEventListener('fetch', event => {
  // Basic network-first strategy
  event.respondWith(
    fetch(event.request)
      .catch(() => {
        return caches.match(event.request);
      })
  );
});