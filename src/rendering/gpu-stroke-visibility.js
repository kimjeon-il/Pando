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

/** Merge only touching/overlapping GPU ranges inside one style batch.
 * Deliberately never bridge a gap: doing so would paint a hidden owner. */
export function mergeAdjacentStrokeRanges(ranges = []) {
  if (ranges.length < 2) return ranges;
  const ordered = [...ranges].sort((a, b) => a.first - b.first || a.count - b.count);
  const merged = [];
  for (const range of ordered) {
    if (!Number.isSafeInteger(range?.first) || !Number.isSafeInteger(range?.count)
      || range.first < 0 || range.count <= 0) continue;
    const previous = merged.at(-1);
    if (previous && range.first <= previous.first + previous.count)
      previous.count = Math.max(previous.first + previous.count, range.first + range.count) - previous.first;
    else merged.push({ first: range.first, count: range.count });
  }
  return merged;
}
