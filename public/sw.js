importScripts("/version.js");

const CACHE_NAME = "saldocerto-ui-" + self.APP_VERSION;

const APP_SHELL = [
  "/manifest.json",
  "/version.js",
  "/logo.png",
  "/favicon.ico",
  "/favicon-32.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
  "/icons/mark.png"
];

// Rede primeiro para HTML, JS, CSS e JSON (sempre pega a versao nova); cache so como fallback offline.
function shouldBypassHttpCache(request, url) {
  if (request.mode === "navigate") return true;
  return /\.(?:js|css|html|json)$/i.test(url.pathname);
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.protocol !== "http:" && url.protocol !== "https:") return;
  // Nunca interceptar nem cachear a API (dados do usuario, sessao e cobranca).
  if (url.origin === self.location.origin && url.pathname.startsWith("/api/")) return;
  if (url.origin !== self.location.origin) return;

  const fetchOptions = shouldBypassHttpCache(request, url) ? { cache: "no-store" } : undefined;

  event.respondWith(
    fetch(request, fetchOptions)
      .then((response) => {
        if (response && response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode === "navigate") {
          const home = await caches.match("/");
          if (home) return home;
        }
        return Response.error();
      })
  );
});
