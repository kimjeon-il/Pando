/** Builtin places share label identity but not project storage. */
export const PLACE_LIMITS = Object.freeze({ candidates: 1500, layoutCandidates: 2048, tileRecords: 512, queryTiles: 96, shardBytes: 512 * 1024, cacheBytes: 24 * 1024 * 1024, searchResults: 50, retainedRecords: 256 });
export const PLACE_KINDS = Object.freeze(['capital', 'city', 'region', 'town', 'mountain', 'water', 'custom']);
export const PLACE_LANGUAGES = Object.freeze(['ko', 'en', 'native']);
export const isBuiltinPlaceId = id => /^builtin:place:[a-z0-9-]+:.+$/u.test(String(id || ''));
export const normalizePlaceQuery = value => String(value || '').normalize('NFKC').trim().toLocaleLowerCase('ko').replace(/\s+/gu, ' ');
const EMPTY_TIMELINE = Object.freeze([]);

function text(value, name, maximum, required = false) {
  const result = String(value ?? '').trim();
  if ((required && !result) || [...result].length > maximum || result.includes('\0')) throw new TypeError('Invalid place ' + name);
  return result;
}

function normalizeNameTimeline(value) {
  if (value == null) return EMPTY_TIMELINE;
  if (!Array.isArray(value) || value.length > 16) throw new TypeError('Invalid place name timeline');
  let previous = '';
  return Object.freeze(value.map(entry => {
    if (!entry || typeof entry !== 'object' || !/^\d{4}-\d{2}-\d{2}$/u.test(entry.date || '')) throw new TypeError('Invalid place name timeline date');
    const date = entry.date;
    const parsed = new Date(date + 'T00:00:00Z');
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date || date <= previous) throw new TypeError('Unordered or invalid place name timeline date');
    previous = date;
    const names = {};
    for (const language of PLACE_LANGUAGES) if (entry[language] != null) names[language] = text(entry[language], 'historical ' + language, 256, true);
    if (!Object.keys(names).length) throw new TypeError('Empty place name transition');
    return Object.freeze({ date, ...names });
  }));
}

export function normalizePlace(raw) {
  const source = text(raw?.source, 'source', 32, true);
  if (!/^[a-z0-9-]+$/u.test(source)) throw new TypeError('Invalid place source');
  const sourceId = text(raw.sourceId, 'sourceId', 128, true);
  const coordinates = [Number(raw.coordinates?.[0]), Number(raw.coordinates?.[1])];
  if (!coordinates.every(Number.isFinite) || Math.abs(coordinates[0]) > 180 || Math.abs(coordinates[1]) > 90) throw new TypeError('Invalid place coordinates');
  const population = Number(raw.population ?? 0), priority = Number(raw.priority ?? 40), minZoom = Number(raw.minZoom ?? 0);
  if (!Number.isFinite(population) || population < 0 || !Number.isFinite(Math.fround(priority)) || !Number.isFinite(Math.fround(minZoom)) || minZoom < 0) throw new TypeError('Invalid place ranking');
  const kind = text(raw.kind || 'custom', 'kind', 32);
  if (!PLACE_KINDS.includes(kind)) throw new TypeError('Invalid place kind');
  return Object.freeze({
    id: 'builtin:place:' + source + ':' + sourceId, source, sourceId,
    name: text(raw.name, 'name', 256, true),
    nameEn: text(raw.nameEn, 'nameEn', 256),
    nameNative: text(raw.nameNative, 'nameNative', 256),
    nameTimeline: normalizeNameTimeline(raw.nameTimeline),
    kind, coordinates: Object.freeze(coordinates),
    countryCode: text(raw.countryCode, 'countryCode', 8), population,
    priority: Math.fround(priority), minZoom: Math.fround(minZoom),
    featureCode: text(raw.featureCode, 'featureCode', 32), notes: '',
  });
}

/** A name is chosen per language at the requested map date, not from modern sovereignty. */
export function resolvePlaceLabelRows(place, languages = { ko: true, en: false, native: false }, mapDate = null) {
  const names = { ko: place.name, en: place.nameEn, native: place.nameNative };
  if (mapDate != null) {
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(mapDate)) throw new TypeError('Invalid map label date');
    for (const transition of place.nameTimeline || []) {
      if (transition.date > mapDate) break;
      for (const language of PLACE_LANGUAGES) if (transition[language] != null) names[language] = transition[language];
    }
  }
  const rows = [], seen = new Set();
  for (const language of PLACE_LANGUAGES) {
    if (languages?.[language] !== true) continue;
    const value = String(names[language] || '').trim();
    const key = value.normalize('NFKC').toLocaleLowerCase();
    if (value && !seen.has(key)) { seen.add(key); rows.push(Object.freeze({ language, text: value })); }
  }
  return rows;
}
export function comparePlaces(a, b) {
  return b.priority - a.priority || b.population - a.population || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
