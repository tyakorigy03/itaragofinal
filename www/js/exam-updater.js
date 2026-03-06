// ============================================================
// Itarago Exam Updater  v2.0
// • Syncs on every app launch (no reload needed)
// • Syncs in background every 6 hours
// • Shows OS-level progress notification (not in-app)
// • Auto-applies patches silently — pages re-render themselves
// • Force-sync API for exam.html when exam ID is missing
// • Deep-link routing: /koraexam/:id → exam.html?id=:id
// ============================================================

(function (global) {
  'use strict';

  const MANIFEST_URL       = 'https://itarago.netlify.app/www/exam_manifest.json';
  const SW_PATH            = '/www/sw.js';
  const DB_NAME            = 'ItaragoSW';
  const NOTIF_TAG_PROGRESS = 'itarago-sync-progress';
  const NOTIF_TAG_DONE     = 'itarago-sync-done';

  // ── Deep-link routing ─────────────────────────────────────
  // Clean public URLs (no .html, no ?id= visible to users):
  //   https://itarago.netlify.app/exam/E05   → navigateToExam('E05')
  //   https://itarago.netlify.app/exams      → all-exams.html
  //   https://itarago.netlify.app/profile    → profile.html
  //   https://itarago.netlify.app/stats      → stats.html
  //   itarago://exam/E05                     → navigateToExam('E05')
  //
  // Netlify rewrites /exam/:id → /www/exam.html?id=:id server-side,
  // so the browser/app never sees .html paths or query strings.
  function handleDeepLink(url) {
    if (!url) return;
    try {
      const parsed = new URL(url);

      // ── Custom URI scheme: itarago://exam/E05 ──────────
      if (parsed.protocol === 'itarago:') {
        const section = (parsed.hostname || '').toLowerCase();
        const param   = parsed.pathname.replace(/^\//, '');
        if (section === 'exam' && param) {
          navigateToExam(param.toUpperCase());
        } else if (section === 'exams') {
          window.location.href = 'all-exams.html';
        } else if (section === 'profile') {
          window.location.href = 'profile.html';
        } else if (section === 'stats') {
          window.location.href = 'stats.html';
        } else {
          window.location.href = 'index.html';
        }
        return;
      }

      // ── HTTPS clean URLs from Netlify ──────────────────
      // By the time Capacitor receives the URL it's still the
      // original clean URL before Netlify rewrites it.
      const path = parsed.pathname; // e.g. /exam/E05

      // /exam/:id
      const examMatch = path.match(/^\/exam\/([^/?#]+)/i);
      if (examMatch) {
        navigateToExam(examMatch[1].toUpperCase());
        return;
      }

      // /exams
      if (path === '/exams' || path === '/exams/') {
        window.location.href = 'all-exams.html';
        return;
      }

      // /profile
      if (path === '/profile' || path === '/profile/') {
        window.location.href = 'profile.html';
        return;
      }

      // /stats
      if (path === '/stats' || path === '/stats/') {
        window.location.href = 'stats.html';
        return;
      }

      // /review
      if (path === '/review' || path === '/review/') {
        window.location.href = 'review.html';
        return;
      }

      // /welcome
      if (path === '/welcome' || path === '/welcome/') {
        window.location.href = 'welcome.html';
        return;
      }

      // Root / home
      window.location.href = 'index.html';

    } catch (e) {
      console.warn('[Updater] Deep link parse error:', e);
    }
  }

  // navigateToExam uses the internal exam.html path since we're
  // already inside the app's webview — no need for the clean URL here
  function navigateToExam(examId) {
    const onExamPage = window.location.pathname.endsWith('exam.html');
    if (onExamPage) {
      const sp = new URLSearchParams(window.location.search);
      sp.set('id', examId);
      window.history.replaceState({}, '', '?' + sp.toString());
      global.dispatchEvent(new CustomEvent('itarago:navigate-exam', { detail: { examId } }));
    } else {
      window.location.href = 'exam.html?id=' + examId;
    }
  }

  // ── Register Service Worker ───────────────────────────────
  async function registerSW() {
    if (!('serviceWorker' in navigator)) return null;
    try {
      const reg = await navigator.serviceWorker.register(SW_PATH, { scope: '/www/' });

      // Periodic background sync (Android Chrome)
      if ('periodicSync' in reg) {
        try {
          const perm = await navigator.permissions.query({ name: 'periodic-background-sync' });
          if (perm.state === 'granted') {
            await reg.periodicSync.register('exam-periodic-sync', {
              minInterval: 6 * 60 * 60 * 1000
            });
          }
        } catch (_) {}
      }

      navigator.serviceWorker.addEventListener('message', handleSWMessage);
      return reg;
    } catch (e) {
      console.error('[Updater] SW register failed:', e);
      return null;
    }
  }

  // ── Handle messages from SW ───────────────────────────────
  function handleSWMessage(event) {
    const msg = event.data;
    if (!msg) return;

    switch (msg.type) {
      case 'SYNC_PROGRESS':
        // SW started downloading — show OS progress notification
        showProgressNotification(msg.text || 'Itarago irimo gusuzuma amakuru mashya...');
        break;

      case 'EXAMS_UPDATED':
        // Patch silently applied — update notification, fire DOM event
        dismissProgressNotification();
        showDoneNotification(msg.patchCount);
        // Pages listen to this event and re-render without reload
        global.dispatchEvent(new CustomEvent('itarago:exams-updated', {
          detail: { patchCount: msg.patchCount }
        }));
        break;

      case 'SYNC_UP_TO_DATE':
      case 'SYNC_ERROR':
        dismissProgressNotification();
        break;
    }
  }

  // ── OS-level notifications (system tray — NOT in-app) ────
  async function requestNotificationPermission() {
    if (!('Notification' in global)) return 'denied';
    if (Notification.permission !== 'default') return Notification.permission;
    return await Notification.requestPermission();
  }

  async function showProgressNotification(text) {
    const reg = await getSWReg();
    if (!reg) return;
    try {
      await reg.showNotification('Itarago — Kuvugurura', {
        body: text,
        icon: '/www/assets/logo.png',
        badge: '/www/assets/logo.png',
        tag: NOTIF_TAG_PROGRESS,
        renotify: false,
        silent: true,               // no sound while progress
        requireInteraction: false
      });
    } catch (_) {}
  }

  async function dismissProgressNotification() {
    const reg = await getSWReg();
    if (!reg) return;
    try {
      const notifs = await reg.getNotifications({ tag: NOTIF_TAG_PROGRESS });
      notifs.forEach(n => n.close());
    } catch (_) {}
  }

  async function showDoneNotification(patchCount) {
    const reg = await getSWReg();
    if (!reg) return;
    try {
      await reg.showNotification('Itarago — Ibizamini Bishya! 📚', {
        body: `Ibizamini bishya byongewe${patchCount > 1 ? ` (${patchCount} amakuru)` : ''}. Fungura app kwitoza!`,
        icon: '/www/assets/logo.png',
        badge: '/www/assets/logo.png',
        tag: NOTIF_TAG_DONE,
        renotify: true,
        data: { url: '/www/all-exams.html' },
        actions: [
          { action: 'open',    title: 'Fungura' },
          { action: 'dismiss', title: 'Funga'   }
        ]
      });
    } catch (_) {}
  }

  async function getSWReg() {
    try { return await navigator.serviceWorker?.ready; } catch (_) { return null; }
  }

  // ── Trigger sync via SW ───────────────────────────────────
  async function triggerSync(opts = {}) {
    const reg = await getSWReg();
    if (!reg) return { updated: false };

    // Background Sync API preferred (deferred if offline, runs when online)
    if (!opts.force && 'sync' in reg) {
      try {
        await reg.sync.register('exam-sync');
        return { queued: true };
      } catch (_) {}
    }

    // Direct message to SW (force-sync or fallback)
    return new Promise(resolve => {
      const ch = new MessageChannel();
      ch.port1.onmessage = e => resolve(e.data?.result || {});
      reg.active?.postMessage(
        { type: opts.force ? 'FORCE_SYNC' : 'MANUAL_SYNC', examId: opts.examId },
        [ch.port2]
      );
      setTimeout(() => resolve({ timeout: true }), 20000);
    });
  }

  // ── Force-sync a specific exam ID (called by exam.html) ──
  // Shows progress notification, waits for result, returns updated data
  async function forceSyncForExam(examId) {
    console.log('[Updater] Force sync for missing exam:', examId);
    showProgressNotification(`Itarago irimo gukurura ikizamini ${examId}...`);
    const result = await triggerSync({ force: true, examId });
    dismissProgressNotification();
    if (result?.updated || result?.timeout) {
      return await loadExamData();
    }
    return null;
  }

  // ── Load exam data (IDB first → bundled JSON fallback) ───
  async function loadExamData() {
    try {
      const d = await readFromIDB();
      if (d) return d;
    } catch (_) {}
    try {
      return await fetch('exam.json').then(r => r.json());
    } catch (e) {
      console.error('[Updater] Cannot load exam data:', e);
      return {};
    }
  }

  // ── IDB reader (same DB the SW writes to) ────────────────
  function readFromIDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('exam_data')) db.createObjectStore('exam_data');
        if (!db.objectStoreNames.contains('metadata'))  db.createObjectStore('metadata');
      };
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('exam_data')) { resolve(null); return; }
        const r = db.transaction('exam_data', 'readonly')
                    .objectStore('exam_data').get('exam_json');
        r.onsuccess = () => resolve(r.result || null);
        r.onerror   = () => reject(r.error);
      };
      req.onerror = () => reject(req.error);
    });
  }

  // ── Capacitor native bridge ───────────────────────────────
  function initCapacitorBridge() {
    if (typeof Capacitor === 'undefined') return;

    const App = Capacitor?.Plugins?.App || window.CapacitorApp;
    if (App) {
      // Deep links from native side
      App.addListener('appUrlOpen', ({ url }) => handleDeepLink(url));

      // Re-sync every time app comes to foreground (resume)
      App.addListener('appStateChange', ({ isActive }) => {
        if (isActive) triggerSync();
      });
    }

    // iOS background task — keeps sync alive when app is closed
    const BG = Capacitor?.Plugins?.BackgroundRunner || Capacitor?.Plugins?.BackgroundTask;
    if (BG?.beforeExit && App) {
      App.addListener('appStateChange', async ({ isActive }) => {
        if (!isActive) {
          const taskId = await BG.beforeExit(async () => {
            await triggerSync();
            await BG.finish({ taskId });
          });
        }
      });
    }
  }

  // ── Init ─────────────────────────────────────────────────
  async function init() {
    await registerSW();
    await requestNotificationPermission();

    // Sync immediately on every launch — fire and forget
    triggerSync();

    // Capacitor native deep links + background
    initCapacitorBridge();

    // Handle deep link if launched from a URL while on web
    // (Capacitor handles this via appUrlOpen; this covers the web browser case)
    const launchPath = window.location.pathname;
    if (launchPath.includes('exam.html') && new URLSearchParams(window.location.search).get('id')) {
      // Already on the right page with the right ID — nothing to do
    }

    console.log('[Updater] v2.0 ready ✓');
  }

  // ── Public API ────────────────────────────────────────────
  global.ItaragoUpdater = {
    init,
    triggerSync,
    forceSyncForExam,
    loadExamData,
    handleDeepLink,
    navigateToExam
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})(window);
