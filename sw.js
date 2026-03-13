/* ============================================================
   ABIDE - Service Worker
   Caching strategy + push notification handler
   ============================================================ */

const SW_VERSION = 'abide-v80';
const STATIC_CACHE = `${SW_VERSION}-static`;
const CONTENT_CACHE = `${SW_VERSION}-content`;
const BASE_PATH = self.location.pathname.replace(/\/sw\.js$/, '/');
const p = (path = '') => `${BASE_PATH}${path}`;

// Shown as an OS notification when this SW update activates on a device that
// already had a previous version installed. Keep it to one sentence — it
// appears in the system notification tray.
const SW_RELEASE_NOTES = 'New: quickly switch Bible translations from the Scripture tab — tap the book icon next to reading progress.';

const STATIC_ASSETS = [
  p(''),
  p('index.html'),
  p('offline.html'),
  p('manifest.json'),
  p('css/app.css'),
  p('css/components.css'),
  p('css/views.css'),
  p('css/animations.css'),
  p('js/date.js'),
  p('js/store.js'),
  p('js/sync.js'),
  p('js/api.js'),
  p('js/share.js'),
  p('js/router.js'),
  p('js/notifications.js'),
  p('js/app.js'),
  p('js/views/home.js'),
  p('js/views/devotion.js'),
  p('js/views/word-lookup.js'),
  p('js/views/saved.js'),
  p('js/views/scripture.js'),
  p('js/views/prayer.js'),
  p('js/views/journal.js'),
  p('js/views/plan.js'),
  p('js/views/settings.js'),
  p('js/views/settings-advanced.js'),
  p('js/views/debug.js'),
  p('privacy.html'),
  p('terms.html'),
  p('assets/fonts/playfair-display.woff2'),
  p('assets/fonts/inter.woff2'),
];

// --- Install: cache static assets ---
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(cache => {
      // Cache what we can, ignore individual failures (fonts may not exist yet)
      return Promise.allSettled(
        STATIC_ASSETS.map(url => cache.add(url).catch(() => null))
      );
    })
  );
  self.skipWaiting();
});

// --- Message: handle SKIP_WAITING from the "Check for Updates" button ---
// When the user taps "Check for Updates" and a new SW is waiting, the page
// sends this message so the update applies immediately without a full restart.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

// --- Activate: clean old caches, stamp version, notify windows, push update alert ---
self.addEventListener('activate', (event) => {
  event.waitUntil(
    // 1. Delete old caches from prior SW versions.
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== STATIC_CACHE && k !== CONTENT_CACHE)
          .map(k => caches.delete(k))
      )
    )
    .then(() => self.clients.claim())
    .then(() => {
      // 2. Read the PREVIOUS version stamp before overwriting it.
      //    This lets us skip the update notification on first install
      //    (when there is no prior stamp) and avoid a false-update
      //    notification if the SW somehow activates without a version change.
      return caches.open('abide-meta').then(async (cache) => {
        const prev = await cache.match('sw-version');
        const prevVersion = prev ? await prev.text() : null;
        await cache.put(
          'sw-version',
          new Response(SW_VERSION, { headers: { 'Content-Type': 'text/plain' } })
        );
        return prevVersion; // passed to the next .then()
      });
    })
    .then((prevVersion) => {
      // 3. Tell every currently-open window to reload.
      //    postMessage covers the foregrounded case; the cache stamp above
      //    covers the backgrounded / iOS-suspended case.
      return self.clients.matchAll({ type: 'window', includeUncontrolled: true })
        .then(clientList => {
          clientList.forEach(client =>
            client.postMessage({ type: 'SW_UPDATED', version: SW_VERSION })
          );
          return prevVersion;
        });
    })
    .then((prevVersion) => {
      // 4. Show an OS update notification — but only when:
      //    • We have release notes to show
      //    • This is a real update (prevVersion exists and differs from current)
      //    Silently swallowed if notification permission is not granted.
      if (!SW_RELEASE_NOTES || !prevVersion || prevVersion === SW_VERSION) return;
      return self.registration.showNotification('Abide Updated ✓', {
        body: SW_RELEASE_NOTES,
        icon: p('icons/icon-192.png'),
        badge: p('icons/icon-192.png'),
        tag: 'abide-update',   // replaces any previous update notification
        silent: true,          // no sound — it's an informational alert
        data: { url: p('') },
      }).catch(() => {}); // no-op if permission denied or API unavailable
    })
  );
});

// --- Fetch: routing strategy ---
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and cross-origin requests
  if (request.method !== 'GET') return;
  if (url.origin !== location.origin && !url.hostname.includes('bible-api.com')) return;

  // Bible API: network first, fallback to cache
  if (url.hostname.includes('bible-api.com')) {
    event.respondWith(networkFirst(request, CONTENT_CACHE, 7 * 24 * 60 * 60));
    return;
  }

  // Content JSON files: network first, cache fallback
  if (url.pathname.includes(p('content/'))) {
    event.respondWith(networkFirst(request, CONTENT_CACHE, 60 * 60));
    return;
  }

  // Static assets: cache first, then network
  event.respondWith(cacheFirst(request, STATIC_CACHE));
});

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    // Return offline page for navigation requests
    if (request.mode === 'navigate') {
      const cache = await caches.open(STATIC_CACHE);
      return cache.match(p('offline.html')) || new Response('Offline', { status: 503 });
    }
    throw err;
  }
}

async function networkFirst(request, cacheName, maxAgeSeconds = 3600) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    return cached || new Response('{"error":"offline"}', {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// --- Push Notifications ---
// iOS Note: 'actions' are NOT supported on iOS. Keep options minimal for compatibility.
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch {
    data = { title: 'Abide', body: event.data.text() };
  }

  const title = data.title || 'Abide';

  // iOS-compatible options — no 'actions' field (unsupported on iOS)
  const options = {
    body: data.body || 'Time to spend a moment with God.',
    icon: p('icons/icon-192.png'),
    badge: p('icons/icon-192.png'),
    tag: data.tag || 'abide-reminder',
    renotify: true,
    silent: false,
    data: { url: data.url || p('') },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const url = event.notification.data?.url || p('');
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      const existingClient = clientList.find(c => c.url.includes(BASE_PATH));
      if (existingClient) {
        return existingClient.focus();
      }
      return clients.openWindow(url);
    })
  );
});
