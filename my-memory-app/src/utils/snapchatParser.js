import JSZip from 'jszip';

const MAIN_PATTERN = /^(.+)-main\.(jpg|jpeg|png|mp4|mov)$/i;
const OVERLAY_PATTERN = /^(.+)-overlay\.png$/i;
const YIELD_EVERY = 4;

function extractBaseId(filename) {
  const mainMatch = filename.match(MAIN_PATTERN);
  if (mainMatch) return mainMatch[1];

  const overlayMatch = filename.match(OVERLAY_PATTERN);
  if (overlayMatch) return overlayMatch[1];

  return null;
}

function parseMediaType(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  if (['mp4', 'mov'].includes(ext)) return 'video';
  return 'image';
}

function isBlobLike(value) {
  return typeof Blob !== 'undefined' && value instanceof Blob;
}

// Cooperative yield to the event loop so heavy ZIP processing (multi-GB archives)
// never blocks the UI thread on Web/Desktop. This gives the browser time to
// repaint and handle user input between chunks.
function yieldToMain() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

function isObjectUrl(value) {
  return typeof value === 'string' && value.startsWith('blob:');
}

function revokeUrl(url) {
  if (typeof URL === 'undefined' || !url) return;
  if (isObjectUrl(url)) URL.revokeObjectURL(url);
}

async function readInputAsArrayBuffer(input) {
  // Web/Desktop drag-and-drop passes a real Blob/File directly. Reading it
  // directly avoids creating an object URL that would need cleanup.
  if (isBlobLike(input)) {
    return await input.arrayBuffer();
  }

  if (typeof input === 'string') {
    const response = await fetch(input);
    const blob = await response.blob();
    try {
      return await blob.arrayBuffer();
    } finally {
      revokeUrl(input);
    }
  }

  throw new Error('Unsupported ZIP input. Provide a URI or a File/Blob.');
}

async function parseMemoriesHistory(zip) {
  const historyEntry = zip.file('memories_history.json');
  if (!historyEntry) return {};

  const raw = await historyEntry.async('text');
  const history = JSON.parse(raw);

  const lookup = {};
  for (const entry of history) {
    const mediaId = entry['Media ID'] || entry['Snap ID'];
    if (mediaId) {
      lookup[mediaId] = {
        timestamp: entry['Timestamp'] || entry['Created'],
        latitude: entry['Latitude'] ? parseFloat(entry['Latitude']) : null,
        longitude: entry['Longitude'] ? parseFloat(entry['Longitude']) : null,
        caption: entry['Caption'] || entry['Description'] || '',
      };
    }
  }
  return lookup;
}

/**
 * Parse a Snapchat Memories ZIP into a batch of snaps.
 *
 * `input` may be either:
 *   - a string URI (native: file:// or content://; web: http(s) or blob: URL), or
 *   - a Blob/File (web/desktop drag-and-drop).
 *
 * Extraction processes ZIP entries sequentially with cooperative yielding to
 * avoid freezing the UI thread on large archives. `onProgress` is invoked with
 * `{ phase: 'extracting', completed, total }`.
 */
export async function parseSnapchatZip(input, onProgress) {
  const arrayBuffer = await readInputAsArrayBuffer(input);

  // loadAsync parses the central directory; cannot be easily chunked by JSZip,
  // but for typical archives this is far cheaper than decompressing every entry.
  const zip = await JSZip.loadAsync(arrayBuffer);

  const history = await parseMemoriesHistory(zip);

  const snapsByBaseId = {};

  zip.forEach((relativePath, zipEntry) => {
    if (zipEntry.dir) return;

    const filename = relativePath.split('/').pop();
    const baseId = extractBaseId(filename);
    if (!baseId) return;

    if (!snapsByBaseId[baseId]) {
      snapsByBaseId[baseId] = {
        snap_base_id: baseId,
        mainFile: null,
        mainFilename: null,
        overlayFile: null,
        media_type: null,
      };
    }

    const isMain = MAIN_PATTERN.test(filename);
    const isOverlay = OVERLAY_PATTERN.test(filename);

    if (isMain) {
      snapsByBaseId[baseId].mainFile = zipEntry;
      snapsByBaseId[baseId].mainFilename = filename;
      snapsByBaseId[baseId].media_type = parseMediaType(filename);
    } else if (isOverlay) {
      snapsByBaseId[baseId].overlayFile = zipEntry;
    }
  });

  const baseIds = Object.keys(snapsByBaseId);
  const snaps = [];

  // Decompress each snap's files one at a time, yielding to the event loop
  // between batches so the UI thread stays responsive during multi-GB unzips.
  for (let i = 0; i < baseIds.length; i++) {
    const baseId = baseIds[i];
    const snap = snapsByBaseId[baseId];
    if (!snap.mainFile) continue;

    if (i % YIELD_EVERY === 0) await yieldToMain();

    const mainBlob = await snap.mainFile.async('blob');
    const mainArrayBuffer = await mainBlob.arrayBuffer();
    const mainUint8 = new Uint8Array(mainArrayBuffer);

    let overlayUint8 = null;
    if (snap.overlayFile) {
      const overlayBlob = await snap.overlayFile.async('blob');
      const overlayArrayBuffer = await overlayBlob.arrayBuffer();
      overlayUint8 = new Uint8Array(overlayArrayBuffer);
    }

    const historyEntry = history[baseId] || {};

    snaps.push({
      snap_base_id: baseId,
      media_type: snap.media_type,
      mainData: mainUint8,
      mainFilename: snap.mainFilename,
      overlayData: overlayUint8,
      has_overlay: !!overlayUint8,
      original_timestamp: historyEntry.timestamp || null,
      latitude: historyEntry.latitude || null,
      longitude: historyEntry.longitude || null,
      caption: historyEntry.caption || '',
    });

    if (onProgress) onProgress({ phase: 'extracting', completed: i + 1, total: baseIds.length });
  }

  snaps.sort((a, b) => {
    if (!a.original_timestamp) return 1;
    if (!b.original_timestamp) return -1;
    return new Date(a.original_timestamp) - new Date(b.original_timestamp);
  });

  return snaps;
}
