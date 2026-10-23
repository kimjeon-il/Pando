const overlaps = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
export const segmentBounds = row => [Math.min(row.a[0], row.b[0]), Math.min(row.a[1], row.b[1]), Math.max(row.a[0], row.b[0]), Math.max(row.a[1], row.b[1])];
export const padBoundaryBounds = (bounds, epsilon = 1e-7) => bounds.map((value, index) => value + (index < 2 ? -epsilon : epsilon));

const MAX_CELL_COVERAGE = 4096;
const PACKED_MIN_ENTRIES = 128;
// Ordinary geographic cells have a collision-free numeric key. The string
// fallback preserves out-of-range coordinates without truncation or aliasing.
const cellKey = (x, y) => x >= -32768 && x <= 32767 && y >= -32768 && y <= 32767
  ? (x + 32768) * 65536 + y + 32768 : `${x}:${y}`;
function cellRange(bounds) {
  const x0 = Math.floor(bounds[0]), x1 = Math.floor(bounds[2]);
  const y0 = Math.floor(bounds[1]), y1 = Math.floor(bounds[3]);
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > MAX_CELL_COVERAGE) return null;
  return { x0, x1, y0, y1 };
}
function forCells(bounds, visit) {
  const range = cellRange(bounds);
  if (!range) return false;
  for (let x = range.x0; x <= range.x1; x++) for (let y = range.y0; y <= range.y1; y++)
    visit(cellKey(x, y));
  return true;
}
const boxesOf = bounds => Array.isArray(bounds?.[0]) ? bounds
  : bounds?.length === 4 ? [bounds] : [];

/** Geographic broad phase only. Exact topology still uses its original tolerance.
 * Dynamic indexes keep insert/remove; immutable bulk-loaded segment indexes use
 * numeric cell postings and typed bounds, without per-edge Map/Set/key objects.
 */
export function createBoundarySpatialIndex() {
  const cells = new Map();
  const entries = new Map();
  const large = new Set();
  let packed = null;
  function keys(bounds) {
    const result = [];
    return forCells(bounds, key => result.push(key)) ? result : null;
  }
  function remove(id) {
    if (packed) throw new Error('Packed boundary indexes are immutable; replace the index after geometry edits');
    const entry = entries.get(id);
    if (!entry) return;
    for (const key of entry.keys || []) {
      const bucket = cells.get(key);
      bucket.delete(id);
      if (!bucket.size) cells.delete(key);
    }
    large.delete(id); entries.delete(id);
  }
  function insert(id, value, bounds) {
    if (packed) throw new Error('Packed boundary indexes are immutable; replace the index after geometry edits');
    remove(id);
    const boxes = boxesOf(bounds);
    const groups = boxes.map(keys);
    const locations = groups.some(group => group === null) ? null : [...new Set(groups.flat())];
    entries.set(id, { value, boxes, keys: locations });
    if (!locations) large.add(id);
    else for (const key of locations) {
      if (!cells.has(key)) cells.set(key, new Set());
      cells.get(key).add(id);
    }
  }
  function loadPacked(values, boundsByIndex) {
    if (packed || entries.size) throw new Error('Bulk loading requires a fresh boundary spatial index');
    if (!Array.isArray(values) || !Array.isArray(boundsByIndex) || values.length !== boundsByIndex.length)
      throw new TypeError('Packed boundary values and bounds must have the same length');
    // Tiny interactive indexes are cheaper to maintain with the normal mutable path.
    if (values.length < PACKED_MIN_ENTRIES) {
      values.forEach((value, index) => insert(index, value, boundsByIndex[index]));
      return false;
    }
    if (values.length > 0xffffffff) throw new RangeError('Packed boundary index exceeds 32-bit source references');
    const boxOffsets = new Uint32Array(values.length + 1);
    let totalBoxes = 0;
    for (let i = 0; i < values.length; i++) {
      boxOffsets[i] = totalBoxes;
      totalBoxes += boxesOf(boundsByIndex[i]).length;
    }
    if (totalBoxes > 0xffffffff) throw new RangeError('Packed boundary index exceeds 32-bit box references');
    boxOffsets[values.length] = totalBoxes;
    const flatBounds = new Float64Array(totalBoxes * 4);
    const postingLists = new Map(), largeRows = [];
    let boxIndex = 0;
    for (let id = 0; id < values.length; id++) {
      const boxes = boxesOf(boundsByIndex[id]);
      for (const box of boxes) {
        for (let j = 0; j < 4; j++) flatBounds[boxIndex * 4 + j] = box[j];
        boxIndex++;
      }
      // A large longitude/polar footprint uses the same whole-index fallback
      // as the mutable implementation. Do not insert partial postings.
      if (boxes.some(box => cellRange(box) === null)) {
        largeRows.push(id);
        continue;
      }
      const seen = boxes.length > 1 ? new Set() : null;
      for (const box of boxes) forCells(box, key => {
        if (seen) {
          if (seen.has(key)) return;
          seen.add(key);
        }
        let bucket = postingLists.get(key);
        if (!bucket) { bucket = []; postingLists.set(key, bucket); }
        bucket.push(id);
      });
    }
    const cellOffsets = new Map();
    let totalPostings = 0;
    for (const [key, bucket] of postingLists) {
      cellOffsets.set(key, [totalPostings, totalPostings + bucket.length]);
      totalPostings += bucket.length;
    }
    const postings = new Uint32Array(totalPostings);
    for (const [key, bucket] of postingLists) postings.set(bucket, cellOffsets.get(key)[0]);
    // The temporary JS posting arrays are not retained after this call.
    packed = { values, boxOffsets, flatBounds, postings, cellOffsets,
      largeRows: Uint32Array.from(largeRows), visited: new Uint32Array(values.length), stamp: 0 };
    return true;
  }
  function queryPacked(bounds) {
    const locations = keys(bounds);
    const { values, boxOffsets, flatBounds, postings, cellOffsets, largeRows, visited } = packed;
    let stamp = (packed.stamp + 1) >>> 0;
    if (!stamp) { visited.fill(0); stamp = 1; }
    packed.stamp = stamp;
    const result = [];
    const accept = id => {
      if (visited[id] === stamp) return;
      visited[id] = stamp;
      for (let offset = boxOffsets[id]; offset < boxOffsets[id + 1]; offset++) {
        const at = offset * 4;
        if (flatBounds[at] <= bounds[2] && flatBounds[at + 2] >= bounds[0]
          && flatBounds[at + 1] <= bounds[3] && flatBounds[at + 3] >= bounds[1]) {
          result.push(values[id]);
          return;
        }
      }
    };
    if (!locations) {
      // Whole-index queries use source insertion order (not large-first).
      for (let id = 0; id < values.length; id++) accept(id);
    } else {
      for (const id of largeRows) accept(id);
      for (const key of locations) {
        const range = cellOffsets.get(key);
        if (!range) continue;
        for (let at = range[0]; at < range[1]; at++) accept(postings[at]);
      }
    }
    return result;
  }
  function query(bounds) {
    if (Array.isArray(bounds[0])) return [...new Set(bounds.flatMap(query))];
    if (bounds[0] > bounds[2]) return [...new Set([
      ...query([bounds[0], bounds[1], 180, bounds[3]]), ...query([-180, bounds[1], bounds[2], bounds[3]]),
    ])];
    if (packed) return queryPacked(bounds);
    const locations = keys(bounds);
    const ids = locations ? new Set(large) : new Set(entries.keys());
    if (locations) for (const key of locations) for (const id of cells.get(key) || []) ids.add(id);
    return [...ids].map(id => entries.get(id)).filter(entry => entry.boxes.some(box => overlaps(box, bounds))).map(entry => entry.value);
  }
  function stats() {
    if (!packed) return { packed: false, entries: entries.size };
    const { values, boxOffsets, flatBounds, postings, cellOffsets, largeRows, visited } = packed;
    return { packed: true, entries: values.length, boxes: flatBounds.length / 4,
      cells: cellOffsets.size, postings: postings.length, large: largeRows.length,
      typedBytes: boxOffsets.byteLength + flatBounds.byteLength + postings.byteLength
        + largeRows.byteLength + visited.byteLength };
  }
  return { insert, remove, loadPacked, query,
    values: () => packed ? [...packed.values] : [...entries.values()].map(entry => entry.value), stats };
}
