self.addEventListener('fetch', (event) => {
    // Basic Service Worker Fetch Bypass
    event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
