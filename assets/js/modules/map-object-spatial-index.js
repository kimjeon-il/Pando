const DEFAULT_CELL_SIZE = 5;
const DEFAULT_MAX_CELLS = 256;

function finiteBounds(value) {
  return Array.isArray(value) && value.length >= 4 && value.every(Number.isFinite);
}

function normalizeLongitude(value) {
  let longitude = Number(value);
  while (longitude < -180) longitude += 360;
  while (longitude > 180) longitude -= 360;
  return longitude;
}

function splitBounds(value) {
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

export function createMapObjectSpatialIndex({
  cellSize = DEFAULT_CELL_SIZE,
  maxCellsPerEntry = DEFAULT_MAX_CELLS,
} = {}) {
  const resolvedCellSize = Math.max(0.25, Number(cellSize) || DEFAULT_CELL_SIZE);
  const resolvedMaxCells = Math.max(1, Number(maxCellsPerEntry) || DEFAULT_MAX_CELLS);
  const entries = new Map();
  const buckets = new Map();
  const largeEntries = new Set();
  let lastCandidateCount = 0;

  function detach(record) {
    for (const key of record.bucketKeys || []) {
      const values = buckets.get(key);
      values?.delete(record.key);
      if (!values?.size) buckets.delete(key);
    }
    largeEntries.delete(record.key);
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
    const boundsParts = splitBounds(value?.bounds);
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
      bucketKeys: [],
    });
    const bucketKeys = [];
    let occupiedCellCount = 0;
    for (const part of boundsParts) occupiedCellCount += cellRange(part, resolvedCellSize).count;
    if (occupiedCellCount > resolvedMaxCells) {
      largeEntries.add(key);
    } else {
      for (const part of boundsParts) {
        const range = cellRange(part, resolvedCellSize);
        for (let x = range.minX; x <= range.maxX; x += 1) {
          for (let y = range.minY; y <= range.maxY; y += 1) {
            const cell = bucketKey(x, y);
            if (!buckets.has(cell)) buckets.set(cell, new Set());
            buckets.get(cell).add(key);
            bucketKeys.push(cell);
          }
        }
      }
    }
    const stored = Object.freeze({ ...record, bucketKeys: Object.freeze(bucketKeys) });
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
    const parts = splitBounds(bounds);
    if (!parts.length) return [];
    const allowed = domains ? new Set([...domains].map(String)) : null;
    const keys = new Set(largeEntries);
    for (const part of parts) {
      const range = cellRange(part, resolvedCellSize);
      for (let x = range.minX; x <= range.maxX; x += 1) {
        for (let y = range.minY; y <= range.maxY; y += 1) {
          for (const key of buckets.get(bucketKey(x, y)) || []) keys.add(key);
        }
      }
    }
    const result = [];
    for (const key of keys) {
      const record = entries.get(key);
      if (!record || (allowed && !allowed.has(record.domain))) continue;
      if (!record.boundsParts.some(recordBounds => parts.some(queryBounds => overlaps(recordBounds, queryBounds)))) continue;
      result.push(record);
    }
    lastCandidateCount = result.length;
    return result;
  }

  function stats() {
    return {
      entryCount: entries.size,
      bucketCount: buckets.size,
      largeEntryCount: largeEntries.size,
      lastCandidateCount,
      cellSize: resolvedCellSize,
    };
  }

  return Object.freeze({ upsert, remove, clearDomain, query, stats });
}

export const MAP_OBJECT_INDEX_DEFAULTS = Object.freeze({
  cellSize: DEFAULT_CELL_SIZE,
  maxCellsPerEntry: DEFAULT_MAX_CELLS,
});
