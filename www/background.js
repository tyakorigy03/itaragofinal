// ============================================================
// Itarago Background Runner Script
// Runs via @capacitor/background-runner even when app is closed.
// Checks exam_manifest.json, downloads patches, shows notification.
// ============================================================

addEventListener('examSyncCheck', async (resolve, reject, args) => {
  const MANIFEST_URL = 'https://itarago.netlify.app/www/exam_manifest.json';
  const APPLIED_KEY  = 'itarago_applied_patches';
  const EXAM_KEY     = 'itarago_exam_data';

  try {
    // 1. Fetch manifest
    const manifestRes = await fetch(MANIFEST_URL + '?t=' + Date.now());
    if (!manifestRes.ok) throw new Error('Manifest fetch failed: ' + manifestRes.status);
    const manifest = await manifestRes.json();

    // 2. Check which patches are new
    const appliedRaw = await CapacitorKV.get(APPLIED_KEY);
    const applied = appliedRaw ? JSON.parse(appliedRaw) : [];
    const pending = (manifest.patches || []).filter(p => !applied.includes(p.patch_id));

    if (pending.length === 0) {
      console.log('[BG] No new patches');
      resolve();
      return;
    }

    // 3. Apply patches
    let examDataRaw = await CapacitorKV.get(EXAM_KEY);
    let examData = examDataRaw ? JSON.parse(examDataRaw) : null;

    for (const patch of pending) {
      const ep = patch.exam_patch;
      const base = manifest.base_url || 'https://itarago.netlify.app/www/';

      if (ep.type === 'full') {
        const url = ep.url.startsWith('http') ? ep.url : base + ep.url;
        const res = await fetch(url + '?t=' + Date.now());
        if (res.ok) examData = await res.json();
      } else if (ep.type === 'partial') {
        if (!examData) examData = {};
        for (const entry of ep.entries || []) {
          const url = entry.url.startsWith('http') ? entry.url : base + entry.url;
          const res = await fetch(url + '?t=' + Date.now());
          if (res.ok) {
            const partial = await res.json();
            Object.assign(examData, partial);
          }
        }
      }

      // Mark applied
      applied.push(patch.patch_id);
    }

    // 4. Save updated exam data
    if (examData) await CapacitorKV.set(EXAM_KEY, JSON.stringify(examData));
    await CapacitorKV.set(APPLIED_KEY, JSON.stringify(applied));

    // 5. Show notification
    const note = manifest.notification || {};
    await CapacitorNotifications.schedule([{
      id: 1001,
      title: note.title || 'Itarago — Ibizamini Bishya!',
      body:  note.body  || `Ibizamini bishya ${pending.length} byongewe. Fungura app kwitoza!`,
      smallIcon: 'ic_notification',
      sound: 'default',
      extra: { action: 'open_all_exams' }
    }]);

    console.log(`[BG] Applied ${pending.length} patch(es) successfully`);
    resolve();
  } catch (err) {
    console.error('[BG] examSyncCheck error:', err);
    reject(err);
  }
});
