const REMOTE_BASE = 'https://itarago.netlify.app/www/';

// ─── Notification permission ──────────────────────────────────────────────────
async function request_notification_permission() {
  if (typeof Notification === 'undefined' || !('Notification' in window)) {
    console.warn('Notifications not supported in this environment (likely Android WebView)');
    return false;
  }

  try {
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') {
      console.warn('Notifications blocked by user');
      return false;
    }

    // Ask user
    const permission = await Notification.requestPermission();
    return permission === 'granted';
  } catch (err) {
    console.warn('Notification permission error:', err);
    return false;
  }
}

// ─── Show notification from PAGE (when app is open) ───────────────────────────
async function show_page_notification(title, body, tag = 'sync') {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;

  try {
    if ('serviceWorker' in navigator) {
      const sw = await navigator.serviceWorker.ready;
      if (sw && sw.showNotification) {
        await sw.showNotification(title, {
          body,
          icon: './assets/icons/icon-48.webp',
          badge: './assets/icons/icon-48.webp',
          tag,                          // replaces previous notification with same tag
          renotify: true,
          vibrate: [200, 100, 200],
        });
      }
    }
  } catch (err) {
    console.warn('Silent local notification error:', err);
  }
}

// ─── Register SW ──────────────────────────────────────────────────────────────
function register_sw() {
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.register('./sw.js')
    .then(reg => {
      console.log('✅ SW registered');
      if ('sync' in reg) {
        reg.sync.register('sync-exams')
          .catch(err => console.warn('BG sync failed:', err));
      }
    })
    .catch(err => console.warn('❌ SW failed:', err));

  navigator.serviceWorker.addEventListener('message', event => {
    if (event.data?.type === 'DO_SYNC') {
      sync_newexams();
    }
  });
}

// ─── Fetch local exams ────────────────────────────────────────────────────────
async function fetch_exams() {
  const exams_l = localStorage.getItem('exams');
  if (exams_l) return JSON.parse(exams_l);

  const response = await fetch('./exam.json');
  const data = await response.json();
  localStorage.setItem('exams', JSON.stringify(data));
  return data;
}

// ─── Pre-cache images ─────────────────────────────────────────────────────────
async function precache_images(images_urls) {
  try {
    // Check if caches API exists (sometimes restricted in old/custom WebViews)
    if (!('caches' in window)) return;

    const cache = await window.caches.open('itarago-v1');

    for (const path of images_urls) {
      const fullUrl = REMOTE_BASE + path;
      const already = await cache.match(fullUrl);
      if (!already) {
        try {
          await cache.add(fullUrl);
          console.log('💾 Cached:', path);
        } catch {
          console.warn('⚠️ Could not cache:', path);
        }
      }
    }

    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'PRECACHE_IMAGES', images: images_urls });
    }
  } catch (err) {
    console.warn('Precache error silently caught:', err);
  }
}

// ─── Sync new exams ───────────────────────────────────────────────────────────
async function sync_newexams() {
  console.log('🔄 Syncing...');

  try {
    // Notify user sync is starting
    await show_page_notification('Itarago', 'Checking for new exams...', 'sync');

    const response = await fetch(REMOTE_BASE + 'exam_manifest.json');
    const remote_manifest = await response.json();
    const local_manifest_str = localStorage.getItem('manifest');

    if (!local_manifest_str) {
      // ── First time ────────────────────────────────────────────────────────
      await show_page_notification('Itarago', 'Downloading exams for first time...', 'sync');

      localStorage.setItem('manifest', JSON.stringify(remote_manifest));

      const remote_exams_resp = await fetch(REMOTE_BASE + 'exam.json');
      const remote_exams_data = await remote_exams_resp.json();
      localStorage.setItem('exams', JSON.stringify(remote_exams_data));

      await precache_images(remote_manifest.patch.images);

      await show_page_notification('Itarago', '✅ All exams downloaded!', 'sync');

    } else {
      const local_manifest = JSON.parse(local_manifest_str);

      if (local_manifest.version !== remote_manifest.version) {
        // ── Update available ─────────────────────────────────────────────────
        await show_page_notification(
          'Itarago',
          `Updating to v${remote_manifest.version}...`,
          'sync'
        );

        localStorage.setItem('manifest', JSON.stringify(remote_manifest));

        const remote_exams_resp = await fetch(REMOTE_BASE + 'exam.json');
        const remote_exams_data = await remote_exams_resp.json();
        localStorage.setItem('exams', JSON.stringify(remote_exams_data));

        await precache_images(remote_manifest.patch.images);

        await show_page_notification('Itarago', '✅ Exams updated successfully!', 'sync');

      } else {
        console.log('✅ Already up to date');
        // No notification needed — nothing changed
      }
    }

  } catch (err) {
    console.warn('📵 Sync failed:', err);
    await show_page_notification('Itarago', '❌ Update failed. Will retry when online.', 'sync');
  }
}

// ─── App Start ────────────────────────────────────────────────────────────────
register_sw();

document.addEventListener('DOMContentLoaded', async () => {
  // Ask permission first, then sync
  await request_notification_permission();
  sync_newexams();
});
