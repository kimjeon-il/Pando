const DEFAULT_CELL_SIZE = 5;
const DEFAULT_MAX_CELLS = 256;
const DEFAULT_COARSE_CELL_SIZE = 20;
const DEFAULT_MAX_COARSE_CELLS = 180;

function finiteBounds(value) {
  return Array.isArray(value) && value.length >= 4 && value.every(Number.isFinite);
}

function normalizeLongitude(value) {
  let longitude = Number(value);
  while (longitude < -180) longitude += 360;
  while (longitude > 180) longitude -= 360;
  return longitude;
}

export function splitGeographicBounds(value) {
  if (!finiteBounds(value)) return [];
  const south = Math.max(-90, Math.min(90, Number(value[1])));
  const north = Math.max(-90, Math.min(90, Number(value[3])));
  const rawWest = Number(value[0]);
  const rawEast = Number(value[2]);
  if (rawEast - rawWest >= 360) return [[-180, south, 180, north]];
  const west = normalizeLongitude(rawWest);
  const east = normalizeLongitude(rawEast);
  if (rawWest <= rawEast && west <= east) return [[west, south, east, north]];
  return [[west, south, 180, north], [-180, south, east, north]];
}

function overlaps(left, right) {
  return left[0] <= right[2] && left[2] >= right[0] && left[1] <= right[3] && left[3] >= right[1];
}

function cellRange(bounds, cellSize) {
  const minX = Math.floor((bounds[0] + 180) / cellSize);
  const maxX = Math.floor((bounds[2] + 180) / cellSize);
  const minY = Math.floor((bounds[1] + 90) / cellSize);
  const maxY = Math.floor((bounds[3] + 90) / cellSize);
  return { minX, maxX, minY, maxY, count: (maxX - minX + 1) * (maxY - minY + 1) };
}

function bucketKey(x, y) {
  return `${x}:${y}`;
}

function angularDistanceDegrees(left, right) {
  const radians = Math.PI / 180;
  const leftLat = Number(left[1]) * radians;
  const rightLat = Number(right[1]) * radians;
  const longitudeDelta = (Number(left[0]) - Number(right[0])) * radians;
  const cosine = Math.sin(leftLat) * Math.sin(rightLat)
    + Math.cos(leftLat) * Math.cos(rightLat) * Math.cos(longitudeDelta);
  return Math.acos(Math.max(-1, Math.min(1, cosine))) / radians;
}

export function createMapObjectSpatialIndex({
  cellSize = DEFAULT_CELL_SIZE,
  maxCellsPerEntry = DEFAULT_MAX_CELLS,
  coarseCellSize = DEFAULT_COARSE_CELL_SIZE,
  maxCoarseCellsPerEntry = DEFAULT_MAX_COARSE_CELLS,
} = {}) {
  const resolvedCellSize = Math.max(0.25, Number(cellSize) || DEFAULT_CELL_SIZE);
  const resolvedMaxCells = Math.max(1, Number(maxCellsPerEntry) || DEFAULT_MAX_CELLS);
  const resolvedCoarseCellSize = Math.max(resolvedCellSize, Number(coarseCellSize) || DEFAULT_COARSE_CELL_SIZE);
  const resolvedMaxCoarseCells = Math.max(1, Number(maxCoarseCellsPerEntry) || DEFAULT_MAX_COARSE_CELLS);
  const entries = new Map();
  const fineBuckets = new Map();
  const coarseBuckets = new Map();
  const globalEntries = new Set();
  let lastCandidateCount = 0;
  let lastRawCandidateCount = 0;
  let lastQueryMs = 0;

  function tierBuckets(tier) {
    return tier === 'fine' ? fineBuckets : coarseBuckets;
  }

  function detach(record) {
    for (const key of record.bucketKeys || []) {
      const values = tierBuckets(record.tier).get(key);
      values?.delete(record.key);
      if (!values?.size) tierBuckets(record.tier).delete(key);
    }
    globalEntries.delete(record.key);
  }

  function remove(key) {
    const normalizedKey = String(key || '');
    const previous = entries.get(normalizedKey);
    if (!previous) return false;
    detach(previous);
    entries.delete(normalizedKey);
    return true;
  }

  function upsert(value) {
    const key = String(value?.key || '');
    const boundsParts = splitGeographicBounds(value?.bounds);
    if (!key || !boundsParts.length) return false;
    remove(key);
    const record = Object.freeze({
      key,
      domain: String(value.domain || ''),
      type: String(value.type || ''),
      id: String(value.id || ''),
      bounds: value.bounds.map(Number),
      boundsParts,
      geometryRevision: Number(value.geometryRevision || 0),
      bucketKeys: [], tier: 'global',
    });
    const bucketKeys = [];
    const occupiedCellCount = boundsParts.reduce((sum, part) => sum + cellRange(part, resolvedCellSize).count, 0);
    const occupiedCoarseCellCount = boundsParts.reduce((sum, part) => sum + cellRange(part, resolvedCoarseCellSize).count, 0);
    const tier = occupiedCellCount <= resolvedMaxCells
      ? 'fine'
      : occupiedCoarseCellCount <= resolvedMaxCoarseCells ? 'coarse' : 'global';
    if (tier === 'global') {
      globalEntries.add(key);
    } else {
      const targetBuckets = tierBuckets(tier);
      const targetCellSize = tier === 'fine' ? resolvedCellSize : resolvedCoarseCellSize;
      for (const part of boundsParts) {
        const range = cellRange(part, targetCellSize);
        for (let x = range.minX; x <= range.maxX; x += 1) {
          for (let y = range.minY; y <= range.maxY; y += 1) {
            const cell = bucketKey(x, y);
            if (!targetBuckets.has(cell)) targetBuckets.set(cell, new Set());
            targetBuckets.get(cell).add(key);
            bucketKeys.push(cell);
          }
        }
      }
    }
    const stored = Object.freeze({ ...record, tier, bucketKeys: Object.freeze(bucketKeys) });
    entries.set(key, stored);
    return true;
  }

  function clearDomain(domain) {
    const wanted = String(domain || '');
    let removed = 0;
    for (const record of [...entries.values()]) {
      if (record.domain !== wanted) continue;
      if (remove(record.key)) removed += 1;
    }
    return removed;
  }

  function query(bounds, { domains = null } = {}) {
    const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const parts = splitGeographicBounds(bounds);
    if (!parts.length) return [];
    const allowed = domains ? new Set([...domains].map(String)) : null;
    const keys = new Set(globalEntries);
    for (const [targetBuckets, targetCellSize] of [[fineBuckets, resolvedCellSize], [coarseBuckets, resolvedCoarseCellSize]]) {
      for (const part of parts) {
        const range = cellRange(part, targetCellSize);
        for (let x = range.minX; x <= range.maxX; x += 1) {
          for (let y = range.minY; y <= range.maxY; y += 1) {
            for (const key of targetBuckets.get(bucketKey(x, y)) || []) keys.add(key);
          }
        }
      }
    }
    lastRawCandidateCount = keys.size;
    const result = [];
    for (const key of keys) {
      const record = entries.get(key);
      if (!record || (allowed && !allowed.has(record.domain))) continue;
      if (!record.boundsParts.some(recordBounds => parts.some(queryBounds => overlaps(recordBounds, queryBounds)))) continue;
      result.push(record);
    }
    lastCandidateCount = result.length;
    lastQueryMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - started;
    return result;
  }

  function querySphericalCap({ center = [0, 0], radius = 90, domains = null } = {}) {
    const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const allowed = domains ? new Set([...domains].map(String)) : null;
    const keys = new Set(globalEntries);
    const resolvedRadius = Math.max(0, Math.min(180, Number(radius) || 90));
    for (const [targetBuckets, targetCellSize] of [[fineBuckets, resolvedCellSize], [coarseBuckets, resolvedCoarseCellSize]]) {
      const cellRadius = Math.SQRT2 * targetCellSize / 2;
      for (const [key, values] of targetBuckets) {
        const [x, y] = key.split(':').map(Number);
        const cellCenter = [
          Math.max(-180, Math.min(180, x * targetCellSize - 180 + targetCellSize / 2)),
          Math.max(-90, Math.min(90, y * targetCellSize - 90 + targetCellSize / 2)),
        ];
        if (angularDistanceDegrees(center, cellCenter) > resolvedRadius + cellRadius) continue;
        for (const entryKey of values) keys.add(entryKey);
      }
    }
    lastRawCandidateCount = keys.size;
    const result = [];
    for (const key of keys) {
      const record = entries.get(key);
      if (!record || (allowed && !allowed.has(record.domain))) continue;
      result.push(record);
    }
    lastCandidateCount = result.length;
    lastQueryMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - started;
    return result;
  }

  function stats() {
    return {
      entryCount: entries.size,
      bucketCount: fineBuckets.size + coarseBuckets.size,
      fineBucketCount: fineBuckets.size,
      coarseBucketCount: coarseBuckets.size,
      fineEntryCount: [...entries.values()].filter(record => record.tier === 'fine').length,
      coarseEntryCount: [...entries.values()].filter(record => record.tier === 'coarse').length,
      globalEntryCount: globalEntries.size,
      largeEntryCount: [...entries.values()].filter(record => record.tier !== 'fine').length,
      lastCandidateCount,
      lastRawCandidateCount,
      lastQueryMs,
      cellSize: resolvedCellSize,
      coarseCellSize: resolvedCoarseCellSize,
    };
  }

  return Object.freeze({ upsert, remove, clearDomain, query, querySphericalCap, stats });
}

export const MAP_OBJECT_INDEX_DEFAULTS = Object.freeze({
  cellSize: DEFAULT_CELL_SIZE,
  maxCellsPerEntry: DEFAULT_MAX_CELLS,
  coarseCellSize: DEFAULT_COARSE_CELL_SIZE,
  maxCoarseCellsPerEntry: DEFAULT_MAX_COARSE_CELLS,
});
