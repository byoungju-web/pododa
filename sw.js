const CACHE_NAME = 'pododa-v61';
const URLS = ['/', '/index.html', '/manifest.json', '/pd-ui-lang.js', '/pd-trans.js?v=42', '/pd-pay.js?v=48'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(URLS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

// v53 빠르게: 
//  · 화면(HTML)은 인터넷 먼저 — 3초 안에 안 오면 저장해 둔 화면을 바로 보여 줌
//  · pododa 파일(js · 아이콘 등)은 저장해 둔 것을 바로 쓰고, 뒤에서 새 것으로 바꿔 둠 (새 버전을 올리면 캐시 이름이 바뀌어 통째로 새로 받음)
//  · 다른 곳(서버 API · 사진 · 지도 · 글꼴)은 손대지 않음 — 브라우저가 알아서 저장 (사진은 1년 저장 설정)
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const net = fetch(req).then(res => { if (res.ok) cache.put('/index.html', res.clone()); return res; });
      const timeout = new Promise(r => setTimeout(r, 3000));
      try {
        const res = await Promise.race([net, timeout]);
        if (res) return res;
        const hit = await cache.match('/index.html');
        return hit || await net;
      } catch (err) {
        return (await cache.match('/index.html')) || (await cache.match('/')) || Response.error();
      }
    })());
    return;
  }
  e.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(req);
    const net = fetch(req).then(res => { if (res.ok) cache.put(req, res.clone()); return res; });
    if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
    return net;
  })());
});

// v24: 휴대폰 알림창의 pododa 알림을 누르면 열려 있는 pododa 로 돌아가거나 새로 연다
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) { if ('focus' in c) return c.focus(); }
    return self.clients.openWindow((e.notification.data && e.notification.data.url) || '/');
  }));
});
