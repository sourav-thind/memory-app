import { getSnapStreamUrl } from './storjService';

const urlCache = new Map();

export async function resolveSnapUrl(fileKey, expiresIn = 3600) {
  if (!fileKey) return null;
  if (urlCache.has(fileKey)) return urlCache.get(fileKey);

  const url = await getSnapStreamUrl(fileKey, expiresIn);
  urlCache.set(fileKey, url);
  return url;
}

export function getThumbnailKey(snap) {
  return snap.storj_thumbnail_key || snap.storj_main_key;
}

export function getMainKey(snap) {
  return snap.storj_main_key;
}

export function getOverlayKey(snap) {
  return snap.storj_overlay_key;
}

export async function resolveSnapMedia(snap) {
  const [mainUrl, overlayUrl, thumbnailUrl] = await Promise.all([
    resolveSnapUrl(getMainKey(snap)),
    resolveSnapUrl(getOverlayKey(snap)),
    resolveSnapUrl(getThumbnailKey(snap)),
  ]);

  return { mainUrl, overlayUrl, thumbnailUrl };
}
