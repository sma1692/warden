const CACHE_NAME = 'dynamocommando-pwa-v1';
const APP_SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Bypass API, WebSocket, and media routes
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/ws') || url.pathname.startsWith('/media')) {
    return;
  }

  event.respondWith(
    fetch(event.request).catch(() =>
      caches.match(event.request).then((cached) => cached || caches.match('/index.html'))
    )
  );
});

// Handle Web Push / Telegram Companion Deep-Link Notifications
self.addEventListener('push', (event) => {
  let payload = {
    title: 'DynamoCommando Alert',
    body: 'An AI agent needs your attention in the Command Center.',
    threadId: '',
    gateId: '',
    url: '/?tab=chat',
  };

  if (event.data) {
    try {
      payload = { ...payload, ...event.data.json() };
    } catch {
      payload.body = event.data.text();
    }
  }

  const targetUrl =
    payload.threadId || payload.gateId
      ? `/?tab=chat&thread=${encodeURIComponent(payload.threadId || '')}&gate=${encodeURIComponent(payload.gateId || '')}`
      : payload.url || '/';

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/icon.svg',
      badge: '/icon.svg',
      data: { url: targetUrl, threadId: payload.threadId, gateId: payload.gateId },
      vibrate: [150, 80, 150],
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/?tab=chat';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ('focus' in client) {
          client.postMessage({
            type: 'DEEP_LINK_NAVIGATION',
            url: targetUrl,
            threadId: event.notification.data?.threadId,
            gateId: event.notification.data?.gateId,
          });
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
