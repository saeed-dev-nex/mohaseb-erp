const CACHE_NAME = 'mohaseb-pro-shell-v3.1.1-static-only';
const APP_SHELL = ['/', '/index.html', '/manifest.webmanifest', '/favicon.svg', '/fonts/vazirmatn-1.woff2', '/fonts/vazirmatn-2.woff2', '/fonts/vazirmatn-3.woff2'];
const SHELL_ROUTE = /^\/(?:login|customers(?:\/\d+)?|services|invoices(?:\/(?:new|\d+(?:\/edit)?))?|reports|expenses|cheques|staff|users|chat|settings)?\/?$/;

function cacheTarget(request) {
  const url = new URL(request.url);
  // Fail closed: API, media, other origins and credential-bearing URLs never enter Cache Storage.
  if (request.method !== 'GET' || url.origin !== self.location.origin ||
      request.headers.has('authorization') || url.search || url.username || url.password) return null;
  if (request.mode === 'navigate' && SHELL_ROUTE.test(url.pathname)) return '/index.html';
  if (APP_SHELL.includes(url.pathname)) return url.pathname;
  if (/^\/assets\/[\w.-]+\.(?:js|css|woff2?|png|svg|ico)$/.test(url.pathname)) return url.pathname;
  return null;
}

function safeResponse(response, target) {
  if (!response.ok || response.redirected || response.type === 'opaque') return false;
  if (/no-store|private/i.test(response.headers.get('cache-control') || '') ||
      /authorization|cookie/i.test(response.headers.get('vary') || '') || response.headers.has('set-cookie')) return false;
  const type = response.headers.get('content-type') || '';
  if (target === '/' || target === '/index.html') return type.includes('text/html');
  if (target.endsWith('.js')) return /(?:application|text)\/javascript/.test(type);
  if (target.endsWith('.css')) return type.includes('text/css');
  // Missing static files can be served as the SPA HTML fallback: never cache that.
  return !type.includes('text/html');
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('mohaseb-pro-') && key !== CACHE_NAME).map((key) => caches.delete(key)))));
  self.clients.claim();
});
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const target = cacheTarget(request);
  if (!target) return;
  const isNavigation = request.mode === 'navigate';
  const isBuildAsset = new URL(request.url).pathname.startsWith('/assets/');
  event.respondWith(fetch(request).then(async (response) => {
    const contentType = response.headers.get('content-type') || '';
    // Vite's SPA fallback may return index.html with HTTP 200 for a missing JS chunk.
    // Never cache or serve that HTML as a module or stylesheet.
    if (isBuildAsset && contentType.includes('text/html')) {
      return new Response('Build asset not found', { status: 404, statusText: 'Not Found' });
    }
    if (safeResponse(response, target)) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(target, response.clone());
    }
    return response;
  }).catch(async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(target);
    if (cached) return cached;
    if (isNavigation) return (await cache.match('/index.html')) || Response.error();
    return new Response('', { status: 503, statusText: 'Service Unavailable' });
  }));
});
