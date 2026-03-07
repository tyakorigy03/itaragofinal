const CACHE_NAME = 'itarago-v1';
const REMOTE_BASE = 'https://itarago.netlify.app/www/';

// ─── Install ──────────────────────────────────────────────────────────────────
self.addEventListener('install', event => {
  console.log('[SW] Installing...');
  self.skipWaiting();
});

// ─── Activate ─────────────────────────────────────────────────────────────────
self.addEventListener('activate', event => {
  console.log('[SW] Activating...');
  event.waitUntil(
    Promise.all([
      caches.keys().then(keys =>
        Promise.all(
          keys
            .filter(key => key !== CACHE_NAME)
            .map(key => caches.delete(key))
        )
      ),
      clients.claim().then(async () => {
        const allClients = await clients.matchAll({ type: 'window' });
        allClients.forEach(client => client.postMessage({ type: 'DO_SYNC' }));
      })
    ])
  );
});

// ─── Fetch Intercept ──────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = event.request.url;
  if (url.startsWith(REMOTE_BASE)) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async cache => {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        try {
          const networkResp = await fetch(event.request);
          if (networkResp.ok) cache.put(event.request, networkResp.clone());
          return networkResp;
        } catch {
          return new Response('Offline', { status: 503 });
        }
      })
    );
  }
});

// ─── Background Sync ──────────────────────────────────────────────────────────
self.addEventListener('sync', event => {
  if (event.tag === 'sync-exams') {
    event.waitUntil(do_sync_from_sw());
  }
});

// ─── Message from page ────────────────────────────────────────────────────────
self.addEventListener('message', event => {
  if (event.data?.type === 'PRECACHE_IMAGES') {
    event.waitUntil(precache_images_in_sw(event.data.images));
  }
});

// ─── Notification click ───────────────────────────────────────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();

  // Open or focus the app when user taps notification
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(allClients => {
      if (allClients.length > 0) {
        return allClients[0].focus();
      }
      return clients.openWindow('/');
    })
  );
});

// ─── Notification helper ──────────────────────────────────────────────────────
function show_notification(title, body, tag = 'sync') {
  return self.registration.showNotification(title, {
    body,
    icon: '/assets/icons/icon-192.webp',   // update to your app icon path
    badge: '/assets/icons/icon-72.webp',  // small icon for Android status bar
    tag,                           // same tag = replaces previous notification
    renotify: true,
    vibrate: [200, 100, 200],
  });
}

// ─── SW Sync Logic ────────────────────────────────────────────────────────────
async function do_sync_from_sw() {
  try {
    const allClients = await clients.matchAll({ type: 'window' });

    if (allClients.length > 0) {
      // Page is open — let page handle localStorage part
      allClients.forEach(c => c.postMessage({ type: 'DO_SYNC' }));
    } else {
      // Page is closed — do everything here + show notifications
      await show_notification('Itarago', 'Checking for new exams...', 'sync');

      const resp = await fetch(REMOTE_BASE + 'exam_manifest.json');
      const manifest = await resp.json();

      await show_notification('Itarago', 'Downloading new content...', 'sync');
      await precache_images_in_sw(manifest.patch.images);

      await show_notification('Itarago', '✅ Ibizamini byongewe!', 'sync');
    }
  } catch (err) {
    await show_notification('Itarago', '❌ Update failed, will retry later.', 'sync');
    console.warn('[SW] Sync failed:', err);
  }
}

// ─── Pre-cache images ─────────────────────────────────────────────────────────
async function precache_images_in_sw(images_urls) {
  const cache = await caches.open(CACHE_NAME);
  let cached_count = 0;

  for (const path of images_urls) {
    const fullUrl = REMOTE_BASE + path;
    const already = await cache.match(fullUrl);
    if (!already) {
      try {
        await cache.add(fullUrl);
        cached_count++;
      } catch {
        console.warn('[SW] Failed to cache:', path);
      }
    }
  }

  return cached_count;
}