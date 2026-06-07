// Pronet service worker — app-shell + smart runtime caching.
// Strategy:
//   • /api/ and SSE  -> never handled here (always live network; auth + realtime)
//   • navigations    -> network-first, fall back to cached page, then offline.html
//   • static assets  -> stale-while-revalidate (instant load, refresh in bg)
//   • cross-origin   -> passthrough (CDNs, Gemini, Supabase handle themselves)
const VERSION = 'pronet-v3';
const SHELL_CACHE = `${VERSION}-shell`;
const RUNTIME_CACHE = `${VERSION}-runtime`;

const SHELL_ASSETS = [
  '/offline.html',
  '/css/style.css',
  '/js/app.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(c => c.addAll(SHELL_ASSETS).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => !k.startsWith(VERSION)).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

function isStaticAsset(url) {
  return /\.(?:css|js|png|jpe?g|gif|webp|svg|ico|woff2?)$/i.test(url.pathname);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;                 // never cache mutations
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;  // let cross-origin pass through
  if (url.pathname.startsWith('/api/')) return;     // live data / auth / SSE — never cache

  // Navigations: network-first so updates flow; fall back to cache then offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(RUNTIME_CACHE).then(c => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then(hit => hit || caches.match('/offline.html')))
    );
    return;
  }

  // Static assets: stale-while-revalidate.
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        const network = fetch(req).then(res => {
          if (res && res.status === 200) cache.put(req, res.clone());
          return res;
        }).catch(() => cached);
        return cached || network;
      })
    );
  }
});

// Allow the page to trigger an immediate activation after an update.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

// ---- Web Push: show OS notifications even when the app is closed ----
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { body: event.data && event.data.text() }; }
  const isCall = data.type === 'call';
  const title = data.title || 'Pronet';
  const options = {
    body: data.body || '',
    icon: data.icon || '/icons/icon-192.png',
    badge: data.badge || '/icons/icon-192.png',
    tag: data.tag || 'pronet',
    renotify: true,
    requireInteraction: isCall ? true : !!data.requireInteraction,
    data: { url: data.url || '/notifications.html', type: data.type, callId: data.callId },
    // A long, repeating buzz for calls so the phone "rings"; a short tap otherwise.
    vibrate: isCall ? [400, 200, 400, 200, 400, 200, 400] : [80, 40, 80],
  };
  // Answer / Decline buttons on incoming-call notifications.
  if (isCall) {
    options.actions = [
      { action: 'answer', title: '✅ Answer' },
      { action: 'decline', title: '❌ Decline' },
    ];
  }
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  const d = event.notification.data || {};
  const url = d.url || '/notifications.html';
  event.notification.close();

  // Decline an incoming call straight from the notification.
  if (event.action === 'decline' && d.callId) {
    event.waitUntil(
      fetch('/api/calls/' + d.callId + '/reject', { method: 'POST', credentials: 'include' }).catch(() => {})
    );
    return;
  }

  // Answer / tap → focus an existing window or open the call/target URL.
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.focus();
          if ('navigate' in client) client.navigate(url).catch(() => {});
          return;
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
