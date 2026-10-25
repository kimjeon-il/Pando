import {
  buildReferenceImageAutoGeoref,
  REFERENCE_IMAGE_WARP_MODES,
} from './georef.mjs';

const EARTH_RADIUS_METERS = 6371008.8;
const DEFAULT_MAX_DETECTIONS = 64;
const DEFAULT_MAX_PLACES = 4096;

const finiteNumber = value => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function finitePair(value, { geographic = false } = {}) {
  if (!Array.isArray(value) || value.length < 2) return null;
  const first = finiteNumber(value[0]);
  const second = finiteNumber(value[1]);
  if (first === null || second === null) return null;
  if (geographic && (first < -180 || first > 180 || second < -90 || second > 90)) return null;
  return [first, second];
}

function foldSpecialLatin(value) {
  return value
    .replace(/\u00df/g, 'ss')
    .replace(/\u00e6/g, 'ae')
    .replace(/\u0153/g, 'oe')
    .replace(/\u00f8/g, 'o')
    .replace(/\u0142/g, 'l')
    .replace(/\u0111/g, 'd')
    .replace(/\u00f0/g, 'd')
    .replace(/\u00fe/g, 'th');
}

export function normalizeReferenceImagePlaceText(value) {
  let text = String(value ?? '').normalize('NFKD').toLocaleLowerCase();
  text = text.replace(/[\u0300-\u036f]/g, '');
  text = text.replace(/[\u064b-\u065f\u0670\u06d6-\u06ed\u0640]/g, '')
    .replace(/\u06cc/g, '\u064a').replace(/\u06a9/g, '\u0643').replace(/\u03c2/g, '\u03c3')
    .replace(/[\u0660-\u0669\u06f0-\u06f9]/g, digit => String(digit.charCodeAt(0) % 16));
  text = foldSpecialLatin(text);
  text = text
    .replace(/[\s.,;:!?()[\]{}'"\u201c\u201d\u2018\u2019/\\|_+=*~<>\u2014\u2013-]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
  return text;
}

function compactText(value) {
  return normalizeReferenceImagePlaceText(value).replace(/\s+/g, '');
}

function damerauLevenshtein(a, b, maximum = Number.POSITIVE_INFINITY) {
  const left = [...a];
  const right = [...b];
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  if (Math.abs(left.length - right.length) > maximum) return maximum + 1;
  let previousPrevious = null;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    let rowMinimum = i;
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      let value = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost,
      );
      if (
        previousPrevious
        && i > 1
        && j > 1
        && left[i - 1] === right[j - 2]
        && left[i - 2] === right[j - 1]
      ) {
        value = Math.min(value, previousPrevious[j - 2] + 1);
      }
      current[j] = value;
      rowMinimum = Math.min(rowMinimum, value);
    }
    if (rowMinimum > maximum) return maximum + 1;
    previousPrevious = previous;
    previous = current;
  }
  return previous[right.length];
}

export function referenceImagePlaceNameSimilarity(leftValue, rightValue) {
  const left = normalizeReferenceImagePlaceText(leftValue);
  const right = normalizeReferenceImagePlaceText(rightValue);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const leftCompact = compactText(left);
  const rightCompact = compactText(right);
  if (leftCompact === rightCompact) return 0.995;

  const maximumLength = Math.max([...leftCompact].length, [...rightCompact].length);
  const minimumLength = Math.min([...leftCompact].length, [...rightCompact].length);
  if (maximumLength <= 3) return 0;

  let prefixScore = 0;
  if (
    minimumLength >= 4
    && (leftCompact.startsWith(rightCompact) || rightCompact.startsWith(leftCompact))
  ) {
    prefixScore = 0.86 + 0.12 * (minimumLength / maximumLength);
  }

  const maximumEdits = Math.max(1, Math.floor(maximumLength * 0.34));
  const distance = damerauLevenshtein(leftCompact, rightCompact, maximumEdits);
  const editScore = distance > maximumEdits ? 0 : 1 - distance / maximumLength;

  const leftTokens = new Set(left.split(' ').filter(Boolean));
  const rightTokens = new Set(right.split(' ').filter(Boolean));
  let tokenScore = 0;
  if (leftTokens.size > 1 || rightTokens.size > 1) {
    let intersection = 0;
    for (const token of leftTokens) if (rightTokens.has(token)) intersection += 1;
    tokenScore = intersection / Math.max(leftTokens.size, rightTokens.size);
  }

  return clamp(Math.max(editScore, prefixScore, tokenScore * 0.92), 0, 1);
}

function timelineBoundary(entry) {
  if (typeof entry?.fromDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entry.fromDate)) return entry.fromDate;
  if (Number.isInteger(entry?.fromYear)) return String(entry.fromYear).padStart(4, '0') + '-01-01';
  return null;
}

function addNameCandidate(result, seen, text, weight, source) {
  const normalized = normalizeReferenceImagePlaceText(text);
  if (!normalized || seen.has(normalized)) return;
  seen.add(normalized);
  result.push(Object.freeze({
    text: String(text).trim(),
    normalized,
    weight: clamp(weight, 0, 1),
    source,
  }));
}

export function referenceImagePlaceNames(place, { mapDate = null } = {}) {
  if (!place || typeof place !== 'object') return Object.freeze([]);
  const result = [];
  const seen = new Set();
  addNameCandidate(result, seen, place.name, 1, 'name');
  addNameCandidate(result, seen, place.nameEn, 0.995, 'nameEn');
  addNameCandidate(result, seen, place.nameNative, 1, 'nameNative');
  for (const value of Array.isArray(place.nameNativeExtras) ? place.nameNativeExtras : []) {
    addNameCandidate(result, seen, value, 0.995, 'nameNativeExtra');
  }

  const date = typeof mapDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(mapDate) ? mapDate : null;
  for (const entry of Array.isArray(place.nameTimeline) ? place.nameTimeline : []) {
    const boundary = timelineBoundary(entry);
    const weight = !date || !boundary ? 0.97 : boundary <= date ? 1 : 0.82;
    addNameCandidate(result, seen, entry.ko, weight, 'historical-ko');
    addNameCandidate(result, seen, entry.en, weight, 'historical-en');
    addNameCandidate(result, seen, entry.native, weight, 'historical-native');
    for (const value of Array.isArray(entry.nativeExtras) ? entry.nativeExtras : []) {
      addNameCandidate(result, seen, value, weight * 0.995, 'historical-native-extra');
    }
  }
  return Object.freeze(result);
}

function haversineMeters(a, b) {
  const first = finitePair(a, { geographic: true });
  const second = finitePair(b, { geographic: true });
  if (!first || !second) return Number.POSITIVE_INFINITY;
  const toRadians = Math.PI / 180;
  const lat1 = first[1] * toRadians;
  const lat2 = second[1] * toRadians;
  const deltaLat = (second[1] - first[1]) * toRadians;
  let deltaLonDegrees = second[0] - first[0];
  while (deltaLonDegrees > 180) deltaLonDegrees -= 360;
  while (deltaLonDegrees < -180) deltaLonDegrees += 360;
  const deltaLon = deltaLonDegrees * toRadians;
  const sinLat = Math.sin(deltaLat / 2);
  const sinLon = Math.sin(deltaLon / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(Math.max(0, h))));
}

function placeRank(place) {
  const kind = String(place?.kind || '').toLowerCase();
  const kindRank = kind === 'capital' ? 1 : kind === 'city' ? 0.82 : kind === 'town' ? 0.58 : 0.4;
  const priority = clamp((finiteNumber(place?.priority) ?? 40) / 100, 0, 1);
  const population = Math.max(0, finiteNumber(place?.population) ?? 0);
  const populationRank = clamp(Math.log10(population + 1) / 7, 0, 1);
  return clamp(kindRank * 0.5 + priority * 0.3 + populationRank * 0.2, 0, 1);
}

function normalizeDetections(values, maximum) {
  if (!Array.isArray(values)) return [];
  const result = [];
  const ids = new Set();
  for (let index = 0; index < values.length && result.length < maximum; index += 1) {
    const value = values[index];
    const text = String(value?.text ?? value?.label ?? '').trim();
    const normalizedText = normalizeReferenceImagePlaceText(text);
    const image = finitePair(value?.image || value?.uv);
    if (!normalizedText || !image || image.some(component => component < 0 || component > 1)) continue;
    const id = String(value?.id || 'ocr-' + (index + 1)).trim() || 'ocr-' + (index + 1);
    if (ids.has(id)) continue;
    ids.add(id);
    result.push(Object.freeze({
      id,
      text,
      normalizedText,
      image: Object.freeze(image),
      confidence: clamp(finiteNumber(value?.confidence) ?? 1, 0, 1),
    }));
  }
  return result;
}

function normalizePlaces(values, maximum) {
  if (!Array.isArray(values)) return [];
  const result = [];
  const ids = new Set();
  for (const value of values) {
    if (result.length >= maximum) break;
    const coordinates = finitePair(value?.coordinates || value?.coordinate, { geographic: true });
    const id = String(value?.id || '').trim();
    if (!coordinates || !id || ids.has(id)) continue;
    ids.add(id);
    result.push(Object.freeze({ ...value, id, coordinates: Object.freeze(coordinates) }));
  }
  return result;
}

function bestNameScore(detection, place, options) {
  let best = null;
  for (const candidate of referenceImagePlaceNames(place, options)) {
    const similarity = referenceImagePlaceNameSimilarity(detection.normalizedText, candidate.normalized);
    const weighted = similarity * candidate.weight;
    if (!best || weighted > best.weighted) best = { similarity, weighted, candidate };
  }
  return best;
}

function matchEdge(detection, place, options) {
  const name = bestNameScore(detection, place, options);
  if (!name || name.similarity < options.minimumNameScore) return null;

  let distanceMeters = null;
  let geographicScore = 0.5;
  if (options.anchorCoordinate) {
    distanceMeters = haversineMeters(options.anchorCoordinate, place.coordinates);
    if (!Number.isFinite(distanceMeters) || distanceMeters > options.maxAnchorDistanceMeters) return null;
    geographicScore = 1 - 0.7 * clamp(distanceMeters / options.maxAnchorDistanceMeters, 0, 1);
  }

  const rank = placeRank(place);
  const score = clamp(
    name.weighted * 0.78
      + detection.confidence * 0.07
      + rank * 0.07
      + geographicScore * 0.08,
    0,
    1,
  );
  return {
    detection,
    place,
    name,
    rank,
    distanceMeters,
    geographicScore,
    score,
  };
}

export function matchReferenceImagePlaceDetections(detectionValues = [], placeValues = [], {
  anchor = null,
  mapDate = null,
  minimumNameScore = 0.72,
  minimumMatchScore = 0.72,
  ambiguityMargin = 0.025,
  maxAnchorDistanceMeters = 2500000,
  maxDetections = DEFAULT_MAX_DETECTIONS,
  maxPlaces = DEFAULT_MAX_PLACES,
  allowAmbiguous = false,
  maximumCandidatesPerDetection = 5,
} = {}) {
  const detections = normalizeDetections(detectionValues, Math.max(1, Math.min(256, Math.round(maxDetections) || DEFAULT_MAX_DETECTIONS)));
  const places = normalizePlaces(placeValues, Math.max(1, Math.min(20000, Math.round(maxPlaces) || DEFAULT_MAX_PLACES)));
  const anchorCoordinate = finitePair(anchor?.coordinate || anchor, { geographic: true });
  const options = {
    anchorCoordinate,
    mapDate,
    minimumNameScore: clamp(finiteNumber(minimumNameScore) ?? 0.72, 0, 1),
    minimumMatchScore: clamp(finiteNumber(minimumMatchScore) ?? 0.72, 0, 1),
    ambiguityMargin: clamp(finiteNumber(ambiguityMargin) ?? 0.025, 0, 1),
    maxAnchorDistanceMeters: Math.max(1000, finiteNumber(maxAnchorDistanceMeters) ?? 2500000),
  };

  const proposals = [];
  const rejected = [];
  for (const detection of detections) {
    const edges = places
      .map(place => matchEdge(detection, place, options))
      .filter(Boolean)
      .sort((left, right) => right.score - left.score || right.name.weighted - left.name.weighted || (left.place.id < right.place.id ? -1 : 1));

    const best = edges[0];
    const second = edges[1];
    if (!best || best.score < options.minimumMatchScore) {
      rejected.push(Object.freeze({ detectionId: detection.id, text: detection.text, reason: 'no-place-match' }));
      continue;
    }
    if (!allowAmbiguous && second && best.score - second.score < options.ambiguityMargin) {
      rejected.push(Object.freeze({
        detectionId: detection.id,
        text: detection.text,
        reason: 'ambiguous-place-match',
        bestPlaceId: best.place.id,
        secondPlaceId: second.place.id,
        margin: best.score - second.score,
      }));
      continue;
    }
    proposals.push(...(allowAmbiguous ? edges.filter(edge => edge.score >= options.minimumMatchScore).slice(0, maximumCandidatesPerDetection) : [best]));
  }

  proposals.sort((left, right) => right.score - left.score || right.detection.confidence - left.detection.confidence);
  const usedDetections = new Set();
  const usedPlaces = new Set();
  const matches = [];
  for (const proposal of proposals) {
    if (!allowAmbiguous && usedDetections.has(proposal.detection.id)) continue;
    if (!allowAmbiguous && usedPlaces.has(proposal.place.id)) {
      rejected.push(Object.freeze({
        detectionId: proposal.detection.id,
        text: proposal.detection.text,
        reason: 'duplicate-place-assignment',
        placeId: proposal.place.id,
      }));
      continue;
    }
    usedDetections.add(proposal.detection.id);
    usedPlaces.add(proposal.place.id);
    matches.push(Object.freeze({
      id: 'auto-place:' + proposal.detection.id + ':' + proposal.place.id,
      detectionId: proposal.detection.id,
      text: proposal.detection.text,
      image: proposal.detection.image,
      coordinate: proposal.place.coordinates,
      placeId: proposal.place.id,
      placeName: String(proposal.place.name || proposal.name.candidate.text || ''),
      matchedName: proposal.name.candidate.text,
      matchedNameSource: proposal.name.candidate.source,
      nameSimilarity: proposal.name.similarity,
      score: proposal.score,
      confidence: clamp(proposal.score * proposal.detection.confidence, 0, 1),
      distanceFromAnchorMeters: proposal.distanceMeters,
      origin: 'place-ocr',
    }));
  }

  return Object.freeze({
    detectionCount: detections.length,
    placeCount: places.length,
    matchCount: matches.length,
    rejectedCount: rejected.length,
    matches: Object.freeze(matches),
    rejected: Object.freeze(rejected),
  });
}

function rawSearchText(value) {
  return String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/g, ' ');
}

export function referenceImagePlaceSearchQueries(value) {
  const raw = rawSearchText(value);
  const folded = normalizeReferenceImagePlaceText(value);
  const result = [];
  const add = query => {
    const text = String(query || '').trim();
    if ([...text].length >= 2 && !result.includes(text)) result.push(text);
  };
  add(raw);
  add([...raw].slice(0, 2).join(''));
  add(folded);
  add([...folded].slice(0, 2).join(''));
  return Object.freeze(result);
}

async function runSearches(queries, search, concurrency) {
  const result = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, queries.length || 1)) }, async () => {
    while (cursor < queries.length) {
      const index = cursor;
      cursor += 1;
      const response = await search(queries[index]);
      const records = Array.isArray(response) ? response : response?.records;
      if (Array.isArray(records)) result.push(...records);
    }
  });
  await Promise.all(workers);
  return result;
}

export async function resolveReferenceImagePlaceDetections(detectionValues = [], {
  search,
  searchConcurrency = 4,
  maxSearchQueries = 96,
  ...matchOptions
} = {}) {
  if (typeof search !== 'function') throw new TypeError('Place search function is required');
  const detections = normalizeDetections(detectionValues, Math.max(1, Math.min(256, Math.round(matchOptions.maxDetections) || DEFAULT_MAX_DETECTIONS)));
  const queries = [];
  const passes = detections.map(detection => referenceImagePlaceSearchQueries(detection.text));
  for (let pass = 0; pass < 4 && queries.length < maxSearchQueries; pass++) {
    for (const alternatives of passes) {
      const query = alternatives[pass];
      if (!query) continue;
      if (!queries.includes(query)) queries.push(query);
      if (queries.length >= maxSearchQueries) break;
    }
  }
  const places = await runSearches(
    queries,
    search,
    Math.max(1, Math.min(8, Math.round(searchConcurrency) || 4)),
  );
  return Object.freeze({
    queries: Object.freeze([...queries]),
    ...matchReferenceImagePlaceDetections(detections, places, matchOptions),
  });
}

export function buildReferenceImagePlaceAutoGeoref({
  detections = [],
  places = [],
  anchor = null,
  mapDate = null,
  mode = REFERENCE_IMAGE_WARP_MODES.AUTO,
  matching = {},
  georef = {},
} = {}) {
  const matched = matchReferenceImagePlaceDetections(detections, places, {
    ...matching,
    anchor,
    mapDate,
  });
  const candidates = matched.matches.map(match => ({
    id: match.id,
    image: match.image,
    coordinate: match.coordinate,
    confidence: match.confidence,
    origin: match.origin,
  }));
  const result = buildReferenceImageAutoGeoref(candidates, {
    ...georef,
    anchor,
    mode,
  });
  return Object.freeze({
    ok: result.ok,
    reason: result.reason || '',
    matching: matched,
    georef: result,
  });
}

export async function resolveReferenceImagePlaceAutoGeoref(detections = [], {
  search,
  anchor = null,
  mapDate = null,
  mode = REFERENCE_IMAGE_WARP_MODES.AUTO,
  matching = {},
  georef = {},
  searchConcurrency = 4,
  maxSearchQueries = 96,
} = {}) {
  const matched = await resolveReferenceImagePlaceDetections(detections, {
    search,
    anchor,
    mapDate,
    ...matching,
    searchConcurrency,
    maxSearchQueries,
  });
  const candidates = matched.matches.map(match => ({
    id: match.id,
    image: match.image,
    coordinate: match.coordinate,
    confidence: match.confidence,
    origin: match.origin,
  }));
  const result = buildReferenceImageAutoGeoref(candidates, {
    ...georef,
    anchor,
    mode,
  });
  return Object.freeze({
    ok: result.ok,
    reason: result.reason || '',
    matching: matched,
    georef: result,
  });
}
