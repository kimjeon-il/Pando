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

// Prepared per-owner spatial blocks for the shared-country stroke packet.
// Indexes are derived in the boundary Worker and never change source geometry.
const RAD = Math.PI / 180;
const BLOCK_INSTANCES = 128;
export const STROKE_CULL_PADDING_PX = 64;

function combineBounds(blocks) {
  if (blocks.some(block => !block.bounds)) return null;
  const values = [Infinity, Infinity, -Infinity, -Infinity];
  const sphere = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const { bounds } of blocks) {
    for (let index = 0; index < 2; index++) values[index] = Math.min(values[index], bounds.geo[index]);
    for (let index = 2; index < 4; index++) values[index] = Math.max(values[index], bounds.geo[index]);
    for (let index = 0; index < 3; index++) {
      sphere[index] = Math.min(sphere[index], bounds.sphere[index]);
      sphere[index + 3] = Math.max(sphere[index + 3], bounds.sphere[index + 3]);
    }
  }
  return { geo: values, sphere };
}

function boundsFor(data, first, count, stride, node) {
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  const sphere = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  const add = (lon, lat) => {
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lat) > 90) return false;
    west = Math.min(west, lon); east = Math.max(east, lon);
    south = Math.min(south, lat); north = Math.max(north, lat);
    const longitude = lon * RAD, latitude = lat * RAD, cosLat = Math.cos(latitude);
    const point = [cosLat * Math.cos(longitude), cosLat * Math.sin(longitude), Math.sin(latitude)];
    for (let k = 0; k < 3; k++) {
      sphere[k] = Math.min(sphere[k], point[k]);
      sphere[k + 3] = Math.max(sphere[k + 3], point[k]);
    }
    return true;
  };
  for (let index = first; index < first + count; index++) {
    const offset = index * stride;
    // GPU segment vertices are projected at start/end; joins/caps are
    // projected at their node center. The shader expands only in screen pixels.
    if (!add(data[offset + 2], data[offset + 3])) return null;
    if (!node && !add(data[offset + 4], data[offset + 5])) return null;
  }
  return { geo: [west, south, east, north], sphere };
}

function blocksFor(data, ranges, stride, node, size) {
  const owners = Object.create(null);
  let blockCount = 0;
  for (const [id, source] of Object.entries(ranges || {})) {
    const first = Number(source?.first), count = Number(source?.count);
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(count)
      || first < 0 || count <= 0 || first + count > data.length / stride) continue;
    const blocks = [];
    for (let start = first; start < first + count; start += size) {
      const length = Math.min(size, first + count - start);
      blocks.push({ first: start, count: length,
        bounds: boundsFor(data, start, length, stride, node) });
      blockCount++;
    }
    owners[id] = { first, count, bounds: combineBounds(blocks), blocks };
  }
  return { owners, blockCount };
}

export function prepareGpuStrokeVisibilityBlocks(geometry, { blockSize = BLOCK_INSTANCES } = {}) {
  if (!geometry?.instances?.length || !geometry?.ownerRanges
    || !Number.isSafeInteger(blockSize) || blockSize <= 0) return null;
  const segments = blocksFor(geometry.instances, geometry.ownerRanges, 10, false, blockSize);
  const nodes = blocksFor(geometry.nodes, geometry.ownerNodeRanges, 8, true, blockSize);
  // Conservative JS object + number storage estimate for the existing Worker LRU.
  const estimatedBytes = (segments.blockCount + nodes.blockCount) * 224
    + (Object.keys(segments.owners).length + Object.keys(nodes.owners).length) * 160;
  return { version: 1, segments: segments.owners, nodes: nodes.owners,
    blockSize, blockCount: segments.blockCount + nodes.blockCount, estimatedBytes };
}

function interval(bounds, row) {
  if (!Array.isArray(row) || row.length !== 3 || row.some(v => !Number.isFinite(v))) return null;
  let low = 0, high = 0;
  for (let axis = 0; axis < 3; axis++) {
    const a = bounds[axis] * row[axis], b = bounds[axis + 3] * row[axis];
    low += Math.min(a, b);
    high += Math.max(a, b);
  }
  return [low, high];
}

/** Only a provably invisible block may be rejected; unknown projections admit it. */
export function strokeVisibilityBlockIntersectsFrame(bounds, frame, paddingPx = STROKE_CULL_PADDING_PX) {
  if (!bounds || !frame || !Array.isArray(bounds.geo) || !Array.isArray(bounds.sphere)) return true;
  const [width, height] = frame.cssViewport || [];
  const [tx, ty] = frame.cssTranslate || [];
  const scale = Number(frame.cssScale);
  const padding = Math.max(STROKE_CULL_PADDING_PX, Number(paddingPx) || 0);
  if (![width, height, tx, ty, scale, padding].every(Number.isFinite)
    || width <= 0 || height <= 0 || scale <= 0) return true;
  if (frame.mode === 0) {
    const x = interval(bounds.sphere, frame.rowX);
    const y = interval(bounds.sphere, frame.rowY);
    const z = interval(bounds.sphere, frame.rowZ);
    if (!x || !y || !z) return true;
    // A segment's GPU vertices interpolate between projected endpoints.
    if (z[1] < -padding / scale) return false;
    return tx + scale * x[1] >= -padding && tx + scale * x[0] <= width + padding
      && ty + scale * y[1] >= -padding && ty + scale * y[0] <= height + padding;
  }
  if (frame.mode !== 1) return true;
  const [west, south, east, north] = bounds.geo;
  const center = frame.flatCenter;
  const offsets = frame.worldOffsets;
  // Ambiguous seam-spanning geometry stays visible to prevent clipped islands.
  if (![west, south, east, north].every(Number.isFinite) || east - west > 180
    || !Array.isArray(center) || center.length !== 2
    || !Array.isArray(offsets) || !offsets.length) return true;
  const top = ty - scale * (north * RAD - center[1]);
  const bottom = ty - scale * (south * RAD - center[1]);
  if (bottom < -padding || top > height + padding) return false;
  return offsets.some(offset => {
    if (!Number.isFinite(offset)) return true;
    const left = tx + scale * (west * RAD + offset - center[0]);
    const right = tx + scale * (east * RAD + offset - center[0]);
    return right >= -padding && left <= width + padding;
  });
}


// Keep both published range-merge names on one authoritative implementation.
export const mergeAdjacentStrokeRanges = mergeGpuStrokeDrawRanges;
