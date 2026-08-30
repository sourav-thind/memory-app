import { uploadSnapFile } from './storjService';
import { supabase } from '../lib/supabase';
import { parseSnapchatZip } from '../utils/snapchatParser';

const PARALLEL_LIMIT = 5;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 800;

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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Retry an individual file upload to Storj if it fails midway through a batch.
// Uses a short backoff so transient network failures don't abort the whole run.
async function retryWithBackoff(fn, onAttempt) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      if (onAttempt) onAttempt(attempt, err);
      if (attempt < MAX_RETRIES) await sleep(RETRY_DELAY_MS * attempt);
    }
  }
  throw lastError;
}

async function processSnap(snap, userId, onFile) {
  const baseKey = `snaps/${userId}/${snap.snap_base_id}`;

  const mainExt = getExtension(snap.mainFilename);
  const mainKey = `${baseKey}/main.${mainExt}`;

  if (onFile) onFile({ currentFile: 'main', snap_base_id: snap.snap_base_id });
  await retryWithBackoff(() =>
    uploadSnapFile(mainKey, snap.mainData, getContentType(snap.mainFilename))
  );

  let overlayKey = null;
  if (snap.overlayData) {
    overlayKey = `${baseKey}/overlay.png`;
    if (onFile) onFile({ currentFile: 'overlay', snap_base_id: snap.snap_base_id });
    await retryWithBackoff(() =>
      uploadSnapFile(overlayKey, snap.overlayData, 'image/png')
    );
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

/**
 * Upload a parsed batch of snaps to Storj + Supabase.
 *
 * `onProgress` receives `{ phase, completed, total, snap_base_id, currentFile }`.
 * Each snap counts as one unit of progress (completed/total), while
 * `currentFile` distinguishes whether the 'main' or 'overlay' asset is being
 * uploaded for the in-flight snap. Individual file uploads are retried
 * `MAX_RETRIES` times before being recorded as failed.
 */
export async function uploadSnapsBatch(snaps, userId, onProgress) {
  let completed = 0;
  const total = snaps.length;
  const results = [];
  const errors = [];

  const tasks = snaps.map((snap, i) => {
    return async () => {
      try {
        const result = await processSnap(snap, userId, fileInfo => {
          if (onProgress) {
            onProgress({
              phase: 'uploading',
              completed,
              total,
              snap_base_id: snap.snap_base_id,
              currentFile: fileInfo?.currentFile || 'main',
            });
          }
        });
        results[i] = { snap_base_id: snap.snap_base_id, ...result };
      } catch (err) {
        errors.push({ snap_base_id: snap.snap_base_id, error: err.message });
        results[i] = null;
      } finally {
        completed++;
        if (onProgress) {
          onProgress({ phase: 'uploading', completed, total });
        }
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

// Revoke temporary blob/object URLs after uploads complete to avoid leaking
// browser/app memory. No-ops when the Web URL API is unavailable (native).
export function revokeObjectUrls(...urls) {
  if (typeof URL === 'undefined' || typeof URL.revokeObjectURL !== 'function') return;
  for (const url of urls) {
    if (url && url.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore invalid URLs
      }
    }
  }
}

/**
 * End-to-end ingestion of a Snapchat Memories ZIP.
 *
 * `zipInput` may be a string URI or a Blob/File (web drag-and-drop).
 * Handles: resolving the current user -> extracting (with cooperative yielding)
 * -> uploading (with per-file retries) -> cleaning up any temp blob URLs.
 *
 * `onProgress` receives unified `{ phase: 'extracting'|'uploading', ... }`
 * payloads used to drive progress UIs.
 *
 * Returns `{ snaps, result }` where `result` is the upload batch summary.
 */
export async function ingestZip(zipInput, { onProgress, blobUrlToRevoke } = {}) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not signed in. Please sign in to upload memories.');

    onProgress?.({ phase: 'extracting', completed: 0, total: 1 });
    const snaps = await parseSnapchatZip(zipInput, onProgress);

    if (!snaps.length) return { snaps: [], result: { succeeded: [], failed: [], total: 0 } };

    onProgress?.({ phase: 'uploading', completed: 0, total: snaps.length });
    const result = await uploadSnapsBatch(snaps, user.id, onProgress);
    return { snaps, result };
  } finally {
    if (blobUrlToRevoke) revokeObjectUrls(blobUrlToRevoke);
  }
}
