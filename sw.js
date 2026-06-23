// Service Worker - 工具箱 Pro
// 策略: network-first (在线时获取最新内容，离线时用缓存)
const CACHE_NAME = 'toolbox-v1.0.0';
const PRECACHE_URLS = [
    '/',
    '/index.html',
    '/manifest.json',
    '/icon-192.png',
    '/icon-512.png',
    '/encrypt/',
    '/morse/',
    '/password/',
    '/check/',
    '/url/',
    '/minesweeper/',
    '/tictactoe/',
    '/snake/',
    '/reaction/',
    '/countdown/',
    '/guessblock/',
    '/typing/',
    '/colorchallenge/',
    '/dailyquote/',
    '/canvas/',
    '/robot/',
    '/cool/',
    '/checkbox/',
    '/bv/',
    '/music/',
    '/watermelon/',
    '/main/',
    '/image/'
];

// 安装: 预缓存核心页面
self.addEventListener('install', function(event) {
    event.waitUntil(
        caches.open(CACHE_NAME).then(function(cache) {
            return cache.addAll(PRECACHE_URLS).catch(function(err) {
                console.log('[SW] 预缓存部分失败(正常):', err.message);
            });
        })
    );
    self.skipWaiting();
});

// 激活: 清理旧缓存
self.addEventListener('activate', function(event) {
    event.waitUntil(
        caches.keys().then(function(names) {
            return Promise.all(
                names.map(function(name) {
                    if (name !== CACHE_NAME) {
                        console.log('[SW] 删除旧缓存:', name);
                        return caches.delete(name);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

// 请求拦截: network-first 策略
self.addEventListener('fetch', function(event) {
    // 只处理 GET 请求
    if (event.request.method !== 'GET') return;

    // 跳过跨域请求
    const url = new URL(event.request.url);
    if (url.origin !== self.location.origin) return;

    event.respondWith(
        fetch(event.request)
            .then(function(response) {
                // 请求成功: 缓存副本并返回
                if (response && response.status === 200) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(function(cache) {
                        cache.put(event.request, clone);
                    });
                }
                return response;
            })
            .catch(function() {
                // 网络失败: 尝试从缓存读取
                return caches.match(event.request).then(function(cached) {
                    if (cached) return cached;
                    // 如果是导航请求且缓存中没有, 返回首页
                    if (event.request.mode === 'navigate') {
                        return caches.match('/');
                    }
                    return new Response('离线且无缓存', {
                        status: 503,
                        statusText: 'Offline',
                        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
                    });
                });
            })
    );
});

// 接收消息: 手动更新
self.addEventListener('message', function(event) {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
