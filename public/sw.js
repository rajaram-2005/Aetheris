// Aetheris service worker: app-shell cache so the UI opens instantly / offline; API always network.
const CACHE = "aetheris-shell-v1";
self.addEventListener("install", (e) => { self.skipWaiting(); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))); self.clients.claim(); });
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.pathname.startsWith("/api/") || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/_next/static/") || /\.(svg|png|ico|webmanifest|woff2?)$/.test(url.pathname)) {
    e.respondWith(caches.open(CACHE).then(async (c) => (await c.match(e.request)) ?? fetch(e.request).then((r) => { c.put(e.request, r.clone()); return r; })));
  }
});
