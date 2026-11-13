// Field Signal service worker: keeps the app shell (and the mock data bundled in its JS)
// available offline so the demo runs without a network. Bump VERSION to drop old caches.
const VERSION = "v1";
const SHELL_CACHE = `field-signal-shell-${VERSION}`;
const RUNTIME_CACHE = `field-signal-runtime-${VERSION}`;
const TILE_CACHE = `field-signal-tiles-${VERSION}`;

const PAGES = ["/ro", "/en", "/ro/feed", "/en/feed", "/ro/about", "/en/about"];
const STATIC_FILES = [
  "/manifest.webmanifest",
  "/icon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
  "/vendor/maplibre-gl-worker.mjs",
];
const TILE_HOST = "tiles.openfreemap.org";

/** Fetches a page and also caches every /_next/static asset it references. */
async function precachePage(cache, path) {
  const response = await fetch(path, { cache: "reload" });
  if (!response.ok) return;
  const html = await response.clone().text();
  await cache.put(path, response);
  const assets = new Set(html.match(/\/_next\/static\/[^"'\s)\\]+/g) ?? []);
  await Promise.all(
    [...assets].map((url) => cache.add(url).catch(() => undefined)),
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await cache.addAll(STATIC_FILES);
      await Promise.all(PAGES.map((path) => precachePage(cache, path)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  const keep = new Set([SHELL_CACHE, RUNTIME_CACHE, TILE_CACHE]);
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => !keep.has(n)).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

async function networkFirst(request, fallbackPath) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached =
      (await caches.match(request, { ignoreSearch: true })) ??
      (fallbackPath ? await caches.match(fallbackPath) : undefined);
    if (cached) return cached;
    throw new Error("offline and not cached");
  }
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok || response.type === "opaque") {
    const cache = await caches.open(cacheName);
    cache.put(request, response.clone());
  }
  return response;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached);
  return cached ?? network;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  // Map tiles, styles and fonts: reuse what was seen online, so the map still draws offline.
  if (url.hostname === TILE_HOST) {
    event.respondWith(staleWhileRevalidate(request, TILE_CACHE));
    return;
  }
  // The API is never cached: the app falls back to its bundled mocks when it is unreachable.
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    const locale = url.pathname.startsWith("/en") ? "/en" : "/ro";
    event.respondWith(networkFirst(request, locale));
    return;
  }
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request, RUNTIME_CACHE));
    return;
  }
  event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
});
