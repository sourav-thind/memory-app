import JSZip from 'jszip';

const MAIN_PATTERN = /^(.+)-main\.(jpg|jpeg|png|mp4|mov)$/i;
const OVERLAY_PATTERN = /^(.+)-overlay\.png$/i;

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

export async function parseSnapchatZip(fileUri) {
  const response = await fetch(fileUri);
  const blob = await response.blob();
  const arrayBuffer = await blob.arrayBuffer();
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

  const snaps = [];

  for (const baseId of Object.keys(snapsByBaseId)) {
    const snap = snapsByBaseId[baseId];
    if (!snap.mainFile) continue;

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
  }

  snaps.sort((a, b) => {
    if (!a.original_timestamp) return 1;
    if (!b.original_timestamp) return -1;
    return new Date(a.original_timestamp) - new Date(b.original_timestamp);
  });

  return snaps;
}
