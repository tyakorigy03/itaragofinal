// ============================================================
// Itarago Service Worker  v2.0
// • Emits SYNC_PROGRESS / EXAMS_UPDATED / SYNC_UP_TO_DATE
//   to all open clients so the page re-renders silently
// • Handles FORCE_SYNC for a specific missing exam ID
// • OS notification shown via registration.showNotification()
//   (system tray — NOT in-page HTML)
// ============================================================

const SW_VERSION      = '2.0.0';
const CACHE_NAME      = 'itarago-cache-v1';
const IMAGE_CACHE     = 'itarago-images-v1';
const MANIFEST_URL    = 'https://itarago.netlify.app/www/exam_manifest.json';
const INTERVAL_MS     = 6 * 60 * 60 * 1000; // 6 hours

// ── Lifecycle ────────────────────────────────────────────────
self.addEventListener('install',  () => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then(keys =>
        Promise.all(
          keys.filter(k => k !== CACHE_NAME && k !== IMAGE_CACHE)
              .map(k => caches.delete(k))
        )
      )
    ])
  );
  schedulePeriodicCheck();
});

// ── Fetch — cache images, serve exam.json from IDB ──────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  if (url.pathname.includes('/question_images/')) {
    event.respondWith(cacheFirst(event.request, IMAGE_CACHE));
    return;
  }

  // exam.json — serve bundled file normally; IDB overlay done in page JS
  // (no interception needed — loadExamData() reads IDB directly)
});

// ── Background Sync ──────────────────────────────────────────
self.addEventListener('sync', event => {
  if (event.tag === 'exam-sync')
    event.waitUntil(runExamSync());
});

self.addEventListener('periodicsync', event => {
  if (event.tag === 'exam-periodic-sync')
    event.waitUntil(runExamSync());
});

// ── Push (server-sent) ───────────────────────────────────────
self.addEventListener('push', event => {
  let d = { title: 'Itarago', body: 'Ibizamini bishya byageze!' };
  try { if (event.data) d = event.data.json(); } catch (_) {}
  event.waitUntil(osNotify(d.title, d.body, 'itarago-push'));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = event.notification.data?.url || '/www/all-exams.html';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const open = list.find(c => c.url.includes('itarago'));
      return open ? open.focus() : clients.openWindow(target);
    })
  );
});

// ── Messages from page ───────────────────────────────────────
self.addEventListener('message', event => {
  const msg = event.data;
  if (!msg) return;

  if (msg.type === 'MANUAL_SYNC') {
    event.waitUntil(
      runExamSync().then(result => {
        event.ports[0]?.postMessage({ type: 'SYNC_DONE', result });
      })
    );
  }

  if (msg.type === 'FORCE_SYNC') {
    event.waitUntil(
      runExamSync({ force: true, examId: msg.examId }).then(result => {
        event.ports[0]?.postMessage({ type: 'SYNC_DONE', result });
      })
    );
  }
});

// ============================================================
// Core sync logic
// ============================================================

async function runExamSync(opts = {}) {
  try {
    // Step 1 — tell all open clients we're syncing
    await broadcast({ type: 'SYNC_PROGRESS', text: 'Itarago irimo gusuzuma amakuru mashya...' });

    // Step 2 — fetch manifest
    const manifest = await fetchJSON(MANIFEST_URL);
    if (!manifest) {
      await broadcast({ type: 'SYNC_ERROR', reason: 'manifest unavailable' });
      return { updated: false, reason: 'manifest unavailable' };
    }

    const applied  = await getAppliedPatches();
    let   pending  = manifest.patches.filter(p => !applied.includes(p.patch_id));

    // Force-sync: if a specific examId is requested and already up to date,
    // still re-apply the latest full patch to make sure we have it
    if (opts.force && opts.examId && pending.length === 0) {
      const latest = manifest.patches.slice(-1)[0];
      if (latest && latest.exam_patch?.type === 'full') pending = [latest];
    }

    if (pending.length === 0) {
      await broadcast({ type: 'SYNC_UP_TO_DATE' });
      return { updated: false, reason: 'up to date' };
    }

    // Step 3 — apply patches
    await broadcast({ type: 'SYNC_PROGRESS', text: `Itarago irimo guteranya ibizamini ${pending.length} bishya...` });

    for (const patch of pending) {
      await applyPatch(patch, manifest.base_url);
      if (!opts.force) await markPatchApplied(patch.patch_id);
      else             await markPatchApplied(patch.patch_id); // mark even forced
    }

    // Step 4 — notify all clients silently (they re-render)
    await broadcast({ type: 'EXAMS_UPDATED', patchCount: pending.length });

    // Step 5 — OS notification (system tray)
    const note = manifest.notification || {};
    await osNotify(
      note.title || 'Itarago — Ibizamini Bishya! 📚',
      note.body  || `Ibizamini ${pending.length} bishya byongewe. Fungura app kwitoza!`,
      'itarago-sync-done'
    );

    return { updated: true, patchCount: pending.length };

  } catch (err) {
    console.error('[SW] runExamSync error:', err);
    await broadcast({ type: 'SYNC_ERROR', reason: err.message });
    return { updated: false, reason: err.message };
  }
}

// ── Apply one patch ──────────────────────────────────────────
async function applyPatch(patch, baseUrl) {
  const ep   = patch.exam_patch;
  const base = baseUrl || 'https://itarago.netlify.app/www/';

  if (ep.type === 'full') {
    const url  = ep.url.startsWith('http') ? ep.url : base + ep.url;
    const data = await fetchJSON(url);
    if (data) await storeExamData(data);

  } else if (ep.type === 'partial') {
    const current = (await loadExamData()) || {};
    for (const entry of (ep.entries || [])) {
      const url     = entry.url.startsWith('http') ? entry.url : base + entry.url;
      const partial = await fetchJSON(url);
      if (partial) Object.assign(current, partial);
    }
    await storeExamData(current);
  }

  // Cache images
  if (patch.images?.length) {
    const cache = await caches.open(IMAGE_CACHE);
    for (const img of patch.images) {
      const url = img.startsWith('http') ? img : base + img;
      try {
        const res = await fetch(url);
        if (res.ok) {
          const key = new Request('question_images/' + img.split('/').pop());
          await cache.put(key, res.clone());
        }
      } catch (_) {}
    }
  }
}

// ============================================================
// IndexedDB helpers
// ============================================================

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('ItaragoSW', 1);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('exam_data')) db.createObjectStore('exam_data');
      if (!db.objectStoreNames.contains('metadata'))  db.createObjectStore('metadata');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function storeExamData(data) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction('exam_data', 'readwrite');
    tx.objectStore('exam_data').put(data, 'exam_json');
    tx.oncomplete = res;
    tx.onerror    = () => rej(tx.error);
  });
}

async function loadExamData() {
  const db = await openDB();
  return new Promise((res, rej) => {
    const r = db.transaction('exam_data', 'readonly')
               .objectStore('exam_data').get('exam_json');
    r.onsuccess = () => res(r.result || null);
    r.onerror   = () => rej(r.error);
  });
}

async function getAppliedPatches() {
  const db = await openDB();
  return new Promise((res, rej) => {
    const r = db.transaction('metadata', 'readonly')
               .objectStore('metadata').get('applied_patches');
    r.onsuccess = () => res(r.result || []);
    r.onerror   = () => rej(r.error);
  });
}

async function markPatchApplied(patchId) {
  const current = await getAppliedPatches();
  if (current.includes(patchId)) return;
  current.push(patchId);
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction('metadata', 'readwrite');
    tx.objectStore('metadata').put(current, 'applied_patches');
    tx.oncomplete = res;
    tx.onerror    = () => rej(tx.error);
  });
}

// ============================================================
// Utilities
// ============================================================

async function fetchJSON(url) {
  try {
    const res = await fetch(url + (url.includes('?') ? '&' : '?') + '_t=' + Date.now(), {
      cache: 'no-store'
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } catch (e) {
    console.warn('[SW] fetchJSON failed:', url, e.message);
    return null;
  }
}

async function cacheFirst(request, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (_) {
    return new Response('', { status: 503 });
  }
}

// OS system tray notification
async function osNotify(title, body, tag) {
  if (!self.registration?.showNotification) return;
  try {
    await self.registration.showNotification(title, {
      body,
      icon:  '/www/assets/logo.png',
      badge: '/www/assets/logo.png',
      tag,
      renotify: true,
      data: { url: '/www/all-exams.html' },
      actions: [
        { action: 'open',    title: 'Fungura' },
        { action: 'dismiss', title: 'Funga'   }
      ]
    });
  } catch (_) {}
}

// Send message to all open windows/tabs
async function broadcast(message) {
  const list = await clients.matchAll({ includeUncontrolled: true });
  list.forEach(c => c.postMessage(message));
}

// Periodic check fallback (setTimeout loop)
function schedulePeriodicCheck() {
  setTimeout(async () => {
    await runExamSync();
    schedulePeriodicCheck();
  }, INTERVAL_MS);
}
