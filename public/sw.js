/*
 * Offline cache for the installed web app, and the receiving end of Web Push.
 *
 * Pages: network first, so a new deploy shows up on the next open; the
 * cached copy serves when offline. Everything else the site serves —
 * hashed bundles, fonts, icons, the 4 MB database and the SQLite wasm —
 * is immutable by name, so cache first. Bump VERSION to drop old caches.
 */
const VERSION = 'tezkija-v2';
const PRECACHE = ['/', '/manifest.json', '/quran.db', '/sql-wasm-browser.wasm'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // The reminder sender reads this one fresh; never pin it.
  if (url.pathname === '/push-data.json') return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy));
          return res;
        })
        .catch(() => caches.match(request).then((hit) => hit || caches.match('/'))),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ||
        fetch(request).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy));
          }
          return res;
        }),
    ),
  );
});

/*
 * A reminder arrives as JSON: { title, body, url, tag }. It is shown as-is;
 * the tag makes a repeat of the same slot replace rather than stack.
 */
self.addEventListener('push', (event) => {
  let data = { title: 'Tezkija', body: '', url: '/', tag: 'tezkija' };
  try {
    data = { ...data, ...event.data.json() };
  } catch {
    // Not JSON: show what there is.
    if (event.data) data.body = event.data.text();
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.tag,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: data.url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Reuse the open app if there is one, so the user lands in it, not in a
      // second browser tab.
      const open = clients.find((c) => 'focus' in c);
      if (open) return open.focus().then((c) => (c && 'navigate' in c ? c.navigate(url) : c));
      return self.clients.openWindow(url);
    }),
  );
});
