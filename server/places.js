// Nearest official help, from OpenStreetMap via the public Overpass API.
// Free, no key, no billing — the same data the map tiles come from.
//
// Overpass is a shared community service, so this caches aggressively and
// fails soft: an emergency screen must never hang waiting for a third party.

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const CACHE_TTL_MS = 60 * 60 * 1000;   // an hour; police stations do not move
const REQUEST_TIMEOUT_MS = 12000;
const MAX_RESULTS = 6;

const AMENITIES = {
  police: 'police',
  hospital: 'hospital',
};

const cache = new Map();

function cacheKey(lat, lon, radius, kinds) {
  // ~1 km grid: nearby users share a cache entry.
  return `${lat.toFixed(2)}:${lon.toFixed(2)}:${radius}:${kinds.join(',')}`;
}

function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function buildQuery(lat, lon, radiusMeters, kinds) {
  const clauses = kinds.flatMap((kind) => {
    const amenity = AMENITIES[kind];
    return ['node', 'way', 'relation'].map(
      (type) => `${type}["amenity"="${amenity}"](around:${radiusMeters},${lat},${lon});`
    );
  });

  return `[out:json][timeout:20];(${clauses.join('')});out center ${MAX_RESULTS * kinds.length};`;
}

async function askOverpass(query) {
  let lastError = null;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'RESQORA/1.0 (community emergency response app)',
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      // Overpass answers a rate-limit or an outage with plain text, not JSON.
      // Parsing that blindly throws "Unexpected character: T" ("Too many
      // requests..."), which says nothing useful in a log.
      const body = await res.text();

      if (!res.ok) {
        lastError = new Error(
          res.status === 429
            ? 'Overpass is rate-limiting us right now'
            : `Overpass responded ${res.status}`
        );
        continue;
      }

      try {
        return JSON.parse(body);
      } catch {
        lastError = new Error(
          `Overpass sent a non-JSON reply: ${body.slice(0, 80).replace(/\s+/g, ' ').trim()}`
        );
        continue;
      }
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error('Overpass unreachable');
}

function toPlace(element, lat, lon) {
  const point = element.center || element;
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon)) return null;

  const tags = element.tags || {};
  const kind = tags.amenity === 'hospital' ? 'hospital' : 'police';

  return {
    id: `${element.type}/${element.id}`,
    kind,
    name: tags.name || tags['name:en'] || (kind === 'police' ? 'Police station' : 'Hospital'),
    phone: tags.phone || tags['contact:phone'] || tags['emergency:phone'] || null,
    address: [tags['addr:street'], tags['addr:suburb'], tags['addr:city']]
      .filter(Boolean).join(', ') || null,
    lat: point.lat,
    lon: point.lon,
    distance: distanceKm(lat, lon, point.lat, point.lon),
  };
}

/**
 * Nearest police stations and hospitals around a point.
 * Returns { places, cached, failed } — never throws.
 */
async function findNearestHelp(lat, lon, { radiusMeters = 5000, kinds = ['police', 'hospital'] } = {}) {
  const wanted = kinds.filter((k) => AMENITIES[k]);
  if (!wanted.length) return { places: [], cached: false, failed: false };

  const key = cacheKey(lat, lon, radiusMeters, wanted);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    // Distances are recomputed from the caller's exact position.
    const places = hit.places
      .map((place) => ({ ...place, distance: distanceKm(lat, lon, place.lat, place.lon) }))
      .sort(byUsefulness);
    return { places, cached: true, failed: false };
  }

  try {
    const data = await askOverpass(buildQuery(lat, lon, radiusMeters, wanted));
    const places = (data.elements || [])
      .map((element) => toPlace(element, lat, lon))
      .filter(Boolean)
      .sort(byUsefulness)
      .slice(0, MAX_RESULTS);

    cache.set(key, { at: Date.now(), places });
    return { places, cached: false, failed: false };
  } catch (err) {
    console.warn('Overpass lookup failed:', err.message);
    // Serve a stale answer rather than nothing at all.
    if (hit) {
      return { places: hit.places, cached: true, failed: false, stale: true };
    }
    return { places: [], cached: false, failed: true };
  }
}

/** Police first, then by distance — in trouble you want the police station. */
function byUsefulness(a, b) {
  if (a.kind !== b.kind) return a.kind === 'police' ? -1 : 1;
  return a.distance - b.distance;
}

// India's emergency lines. 112 is the single number that routes them all.
const EMERGENCY_HOTLINES = [
  { label: 'Emergency (all services)', number: '112', primary: true },
  { label: 'Police', number: '100' },
  { label: 'Ambulance', number: '108' },
  { label: 'Women helpline', number: '1091' },
];

module.exports = { findNearestHelp, distanceKm, EMERGENCY_HOTLINES };
