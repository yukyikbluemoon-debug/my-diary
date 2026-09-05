const CACHE_NAME = "diary-shell-v83";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/app.js",
  "./js/db.js",
  "./js/crypto.js",
  "./js/markdown.js",
  "./js/theme.js",
  "./js/exchange.js",
  "./js/finance.js",
  "./js/assets.js",
  "./js/banking.js",
  "./js/gallery.js",
  "./js/telegram.js",
  "./js/statement.js",
  "./js/nettrend.js",
  "./js/bank-logos.js",
  "./js/drive-config.js",
  "./js/drive-sync.js",
  "./manifest.json",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Fetch each shell file bypassing the browser's own HTTP cache —
      // "reload" forces a real round-trip to the server/CDN instead of
      // possibly reusing a stale response the browser cached on its own,
      // which is a second, separate layer of caching from our Cache
      // Storage below and was letting updates get stuck even after
      // bumping CACHE_NAME and reloading.
      await Promise.all(SHELL_FILES.map(async (url) => {
        try {
          const res = await fetch(url, { cache: "reload" });
          if (res.ok) await cache.put(url, res);
        } catch (e) { /* offline on first install — best effort */ }
      }));
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// App shell: stale-while-revalidate. Serve from cache immediately for
// speed/offline, but always also fetch fresh in the background and update
// the cache — so edited files (like drive-config.js) show up after at
// most one reload, instead of staying stuck on whatever was cached first.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  if (!event.request.url.startsWith(self.location.origin)) return;
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(event.request);
      const networkFetch = fetch(event.request, { cache: "reload" })
        .then((res) => {
          if (res.ok) cache.put(event.request, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});
