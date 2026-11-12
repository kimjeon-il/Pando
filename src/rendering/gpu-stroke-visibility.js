// Conservative screen-space culling for GPU stroke owner ranges.
// Input/output owner order is unchanged; a missing/uncertain bound means draw.
// Each resource's owner bounds are computed once and reused for all frames.
const RADIANS = Math.PI / 180;
const FLOATS_PER_SEGMENT = 10;
const POINT_OFFSETS = [0, 2, 4, 6];
const boundsByResource = new WeakMap();

function boundsForResource(resource) {
  if (!resource || typeof resource !== 'object') return null;
  if (boundsByResource.has(resource)) return boundsByResource.get(resource);
  const instances = resource.instances;
  const ownerRanges = resource.ownerRanges;
  if (!(instances instanceof Float32Array) || !ownerRanges
    || instances.length % FLOATS_PER_SEGMENT !== 0) {
    boundsByResource.set(resource, null);
    return null;
  }
  const total = instances.length / FLOATS_PER_SEGMENT;
  const result = new Map();
  for (const [key, source] of Object.entries(ownerRanges)) {
    const first = Math.trunc(Number(source?.first));
    const count = Math.trunc(Number(source?.count));
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(count)
      || first < 0 || count < 0 || first + count > total) {
      result.set(key, null);
      continue;
    }
    if (count === 0) continue;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
    let valid = true;
    for (let i = first; i < first + count && valid; i += 1) {
      const base = i * FLOATS_PER_SEGMENT;
      // The shader projects all previous/start/end/next vertices.
      // Including all four produces conservative screen-space extrema for
      // segments, round caps, joins, and miter geometry.
      for (const offset of POINT_OFFSETS) {
        const longitude = Number(instances[base + offset]);
        const latitude = Number(instances[base + offset + 1]);
        if (!Number.isFinite(longitude) || !Number.isFinite(latitude)
          || Math.abs(latitude) > 90.00001) { valid = false; break; }
        west = Math.min(west, longitude); east = Math.max(east, longitude);
        south = Math.min(south, latitude); north = Math.max(north, latitude);
        const lon = longitude * RADIANS, lat = latitude * RADIANS;
        const c = Math.cos(lat);
        const point = [c * Math.cos(lon), c * Math.sin(lon), Math.sin(lat)];
        for (let axis = 0; axis < 3; axis += 1) {
          min[axis] = Math.min(min[axis], point[axis]);
          max[axis] = Math.max(max[axis], point[axis]);
        }
      }
    }
    result.set(key, valid ? { min, max, west, east, south, north } : null);
  }
  boundsByResource.set(resource, result);
  return result;
}

function dotExtrema(row, bounds) {
  let minimum = 0, maximum = 0;
  for (let i = 0; i < 3; i += 1) {
    if (row[i] < 0) {
      minimum += row[i] * bounds.max[i];
      maximum += row[i] * bounds.min[i];
    } else {
      minimum += row[i] * bounds.min[i];
      maximum += row[i] * bounds.max[i];
    }
  }
  return [minimum, maximum];
}

function isVisible(bounds, frame, paddingPx) {
  const width = Number(frame.viewport?.[0]), height = Number(frame.viewport?.[1]);
  const scale = Number(frame.scale), translate = frame.translate;
  if (![width, height, scale, translate?.[0], translate?.[1]].every(Number.isFinite)
    || !(width > 0 && height > 0 && scale > 0)) return true;
  if (frame.mode === 0) {
    const { rowX, rowY, rowZ } = frame;
    if (![rowX, rowY, rowZ].every(row => Array.isArray(row)
      && row.length === 3 && row.every(Number.isFinite))) return true;
    // The WebGL fragment shader discards wholly back-facing strokes.
    if (dotExtrema(rowZ, bounds)[1] < -0.01) return false;
    const x = dotExtrema(rowX, bounds), y = dotExtrema(rowY, bounds);
    return translate[0] + scale * x[1] >= -paddingPx
      && translate[0] + scale * x[0] <= width + paddingPx
      && translate[1] + scale * y[1] >= -paddingPx
      && translate[1] + scale * y[0] <= height + paddingPx;
  }
  if (frame.mode === 1) {
    const center = frame.flatCenter, offsets = frame.worldOffsets;
    if (!Array.isArray(center) || !Array.isArray(offsets) || !offsets.length) return true;
    const northPx = translate[1] - scale * (bounds.north * RADIANS - center[1]);
    const southPx = translate[1] - scale * (bounds.south * RADIANS - center[1]);
    if (southPx < -paddingPx || northPx > height + paddingPx) return false;
    return offsets.some(offset => {
      const left = translate[0] + scale * (bounds.west * RADIANS + offset - center[0]);
      const right = translate[0] + scale * (bounds.east * RADIANS + offset - center[0]);
      return right >= -paddingPx && left <= width + paddingPx;
    });
  }
  return true;
}

/**
 * Returns only owners whose segment and round-node geometry may intersect
 * the current frame. Culling is always conservative: unknown geometry,
 * metadata, coordinate system or viewport means no culling.
 */
export function visibleGpuStrokeOwners(resource, ownerIds, frame, { paddingPx = 96 } = {}) {
  if (!Array.isArray(ownerIds) || !ownerIds.length || !frame) return ownerIds;
  const bounds = boundsForResource(resource);
  if (!bounds) return ownerIds;
  const margin = Math.max(96, Number(paddingPx) || 0);
  return ownerIds.filter(id => {
    const entry = bounds.get(String(id));
    return !entry || isVisible(entry, frame, margin);
  });
}

/** Coalesces adjacent index ranges inside a single already style-grouped pass.
 * Never merges across distinct styles, resources, or owners that were hidden.
 * This runs after owner visibility and before instanced vertex attribution. */
export function mergeGpuStrokeDrawRanges(ranges = []) {
  if (ranges.length <= 1) return ranges;
  const ordered = ranges.map(range => ({ first: Number(range.first), count: Number(range.count) }))
    .filter(range => range.count > 0 && Number.isSafeInteger(range.first) && Number.isSafeInteger(range.count))
    .sort((left, right) => left.first - right.first);
  const merged = [];
  for (const range of ordered) {
    const last = merged[merged.length - 1];
    if (last && range.first <= last.first + last.count)
      last.count = Math.max(last.first + last.count, range.first + range.count) - last.first;
    else merged.push({ ...range });
  }
  return merged;
}
