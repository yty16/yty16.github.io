// Service Worker for Watch App
var CACHE_NAME = 'watch-toolbox-v1.0.0';
var urlsToCache = [
    './',
    './index.html',
    './manifest.json',
    '../icon-192.png',
    '../icon-512.png'
];

// Install
self.addEventListener('install', function(event) {
    event.waitUntil(
        caches.open(CACHE_NAME).then(function(cache) {
            return cache.addAll(urlsToCache);
        })
    );
});

// Activate - clean old caches
self.addEventListener('activate', function(event) {
    event.waitUntil(
        caches.keys().then(function(cacheNames) {
            return Promise.all(
                cacheNames.filter(function(name) {
                    return name.startsWith('watch-toolbox-') && name !== CACHE_NAME;
                }).map(function(name) {
                    return caches.delete(name);
                })
            );
        })
    );
});

// Fetch - network first, fallback to cache
self.addEventListener('fetch', function(event) {
    if (event.request.method !== 'GET') return;
    event.respondWith(
        fetch(event.request).then(function(response) {
            if (response && response.status === 200) {
                var cloned = response.clone();
                caches.open(CACHE_NAME).then(function(cache) {
                    cache.put(event.request, cloned);
                });
            }
            return response;
        }).catch(function() {
            return caches.match(event.request).then(function(cached) {
                return cached || new Response('Offline', {status: 503});
            });
        })
    );
});
