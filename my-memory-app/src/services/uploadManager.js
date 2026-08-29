import { uploadSnapFile } from './storjService';
import { supabase } from '../lib/supabase';

const PARALLEL_LIMIT = 5;

function getExtension(filename) {
  return filename.split('.').pop().toLowerCase();
}

function getContentType(filename) {
  const ext = getExtension(filename);
  const types = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
  };
  return types[ext] || 'application/octet-stream';
}

async function processSnap(snap, userId) {
  const baseKey = `snaps/${userId}/${snap.snap_base_id}`;

  const mainExt = getExtension(snap.mainFilename);
  const mainKey = `${baseKey}/main.${mainExt}`;
  await uploadSnapFile(mainKey, snap.mainData, getContentType(snap.mainFilename));

  let overlayKey = null;
  if (snap.overlayData) {
    overlayKey = `${baseKey}/overlay.png`;
    await uploadSnapFile(overlayKey, snap.overlayData, 'image/png');
  }

  const { error } = await supabase.from('snaps').insert({
    user_id: userId,
    snap_base_id: snap.snap_base_id,
    media_type: snap.media_type,
    original_timestamp: snap.original_timestamp || null,
    storj_main_key: mainKey,
    storj_overlay_key: overlayKey,
    has_overlay: snap.has_overlay,
    latitude: snap.latitude || null,
    longitude: snap.longitude || null,
    caption: snap.caption || '',
  });

  if (error) throw error;

  return { storj_main_key: mainKey, storj_overlay_key: overlayKey };
}

async function runBatch(tasks, limit) {
  const results = [];
  let index = 0;

  async function next() {
    while (index < tasks.length) {
      const currentIndex = index++;
      results[currentIndex] = await tasks[currentIndex]();
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => next());
  await Promise.all(workers);
  return results;
}

export async function uploadSnapsBatch(snaps, userId, onProgress) {
  let completed = 0;
  const total = snaps.length;
  const results = [];
  const errors = [];

  const tasks = snaps.map((snap, i) => {
    return async () => {
      try {
        const result = await processSnap(snap, userId);
        results[i] = { snap_base_id: snap.snap_base_id, ...result };
      } catch (err) {
        errors.push({ snap_base_id: snap.snap_base_id, error: err.message });
        results[i] = null;
      } finally {
        completed++;
        if (onProgress) onProgress(completed, total);
      }
    };
  });

  await runBatch(tasks, PARALLEL_LIMIT);

  return {
    succeeded: results.filter(Boolean),
    failed: errors,
    total,
  };
}
