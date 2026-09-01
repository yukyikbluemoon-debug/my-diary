const CACHE_NAME = "diary-shell-v11";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/app.js",
  "./js/db.js",
  "./js/crypto.js",
  "./js/markdown.js",
  "./js/theme.js",
  "./js/drive-config.js",
  "./js/drive-sync.js",
  "./manifest.json",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting())
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
      const networkFetch = fetch(event.request)
        .then((res) => {
          if (res.ok) cache.put(event.request, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});
