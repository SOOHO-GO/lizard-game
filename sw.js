// 네트워크 우선: 인터넷이 되면 항상 최신 버전, 안 되면 저장해둔 버전으로 실행
const CACHE = 'lizard-v3';
const ASSETS = ['./', './index.html', './help.html', './style.css', './game.js', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    // no-cache: 브라우저 HTTP 캐시(GitHub Pages는 10분)를 쓰지 않고 항상 서버에 최신인지 확인
    fetch(e.request, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html')))
  );
});
