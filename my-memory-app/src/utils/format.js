let geocodeCache = new Map();

export function formatSnapDateTime(date) {
  if (!date) return '';
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export function formatSnapTime(date) {
  if (!date) return '';
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export function formatCoordinate(value, positive, negative) {
  if (value == null || Number.isNaN(value)) return null;
  return `${Math.abs(value).toFixed(4)}°${value >= 0 ? positive : negative}`;
}

export function formatCoordinates(latitude, longitude) {
  const lat = formatCoordinate(latitude, 'N', 'S');
  const lng = formatCoordinate(longitude, 'E', 'W');
  if (!lat && !lng) return null;
  if (lat && lng) return `${lat}, ${lng}`;
  return lat || lng;
}

export async function reverseGeocode(latitude, longitude) {
  if (latitude == null || longitude == null) return null;

  const cacheKey = `${latitude},${longitude}`;
  if (geocodeCache.has(cacheKey)) return geocodeCache.get(cacheKey);

  try {
    const url =
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&` +
      `lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}&zoom=14`;

    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error('Geocode request failed');

    const data = await response.json();
    const place =
      data.name ||
      data.address?.neighbourhood ||
      data.address?.suburb ||
      data.address?.city_district ||
      data.address?.town ||
      data.address?.city ||
      data.address?.county ||
      data.display_name;

    const normalized = typeof place === 'string' ? place : null;
    geocodeCache.set(cacheKey, normalized);
    return normalized;
  } catch (err) {
    geocodeCache.set(cacheKey, null);
    return null;
  }
}
