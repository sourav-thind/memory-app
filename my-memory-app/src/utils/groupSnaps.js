const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function getMonthYearLabel(date) {
  return `${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

export function toGroupKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function parseOriginalTimestamp(snap) {
  if (!snap.original_timestamp) return null;
  const date = new Date(snap.original_timestamp);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function groupSnapsByMonthYear(snaps) {
  const groups = [];
  const map = new Map();

  for (const snap of snaps) {
    const date = parseOriginalTimestamp(snap);
    const label = date ? getMonthYearLabel(date) : 'Unknown';
    const key = date ? toGroupKey(date) : 'unknown';

    let group = map.get(key);
    if (!group) {
      group = { key, label, snaps: [] };
      map.set(key, group);
      groups.push(group);
    }
    group.snaps.push({ ...snap, _timestamp: date });
  }

  return groups;
}
