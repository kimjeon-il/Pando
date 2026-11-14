import {createHash} from 'node:crypto';

// Emit a byte-for-byte JSON.stringify-compatible GeoJSON collection without
// allocating a single string proportional to the whole world (or a huge ring).
// Source geometries are read-only. No simplification or topology edits occur.
export function streamCurrentWorldJson({metadata, bbox, visitFeatures}, emit) {
  if (!metadata || typeof metadata !== 'object' || typeof visitFeatures !== 'function'
    || typeof emit !== 'function') throw new TypeError('Current world stream requires metadata, visitor and sink');
  const geometryOwners = new Map();
  const duplicates = [];
  const largestFeatures = [];
  let bytes = 0, maxChunkBytes = 0, featureCount = 0;
  const put = part => {
    const text = String(part);
    const size = Buffer.byteLength(text);
    bytes += size;
    maxChunkBytes = Math.max(maxChunkBytes, size);
    emit(text);
  };
  put('{');
  let hasHeader = false;
  for (const [key, value] of Object.entries(metadata)) {
    if (key === 'features' || key === 'bbox' || value === undefined) continue;
    if (hasHeader) put(',');
    put(JSON.stringify(key)); put(':'); put(JSON.stringify(value));
    hasHeader = true;
  }
  if (hasHeader) put(',');
  put('"features":[');
  visitFeatures(feature => {
    if (featureCount) put(',');
    const startBytes = bytes;
    put('{"type":'); put(JSON.stringify(feature.type));
    put(',"id":'); put(JSON.stringify(feature.id));
    put(',"properties":'); put(JSON.stringify(feature.properties));
    put(',"geometry":');
    const geometryHash = createHash('sha256');
    const geometryStart = bytes;
    streamJsonValue(feature.geometry, part => {
      geometryHash.update(part, 'utf8');
      put(part);
    });
    const digest = geometryHash.digest('hex');
    const prior = geometryOwners.get(digest);
    if (prior !== undefined) duplicates.push({first: prior, duplicate: feature.id, sha256: digest});
    else geometryOwners.set(digest, feature.id);
    put('}');
    const featureBytes = bytes - startBytes;
    largestFeatures.push({id: feature.id, bytes: featureBytes, geometryBytes: bytes - geometryStart - 1});
    largestFeatures.sort((a, b) => b.bytes - a.bytes);
    if (largestFeatures.length > 8) largestFeatures.pop();
    featureCount++;
  });
  put(']');
  if (bbox !== undefined) { put(',"bbox":'); put(JSON.stringify(bbox)); }
  put('}\n');
  return {
    featureCount, bytes, uniqueGeometryCount: geometryOwners.size,
    duplicateGeometryCount: duplicates.length, duplicateGeometries: duplicates.slice(0, 16),
    largestFeatures, maxChunkBytes,
  };
}

export function streamJsonValue(value, emit) {
  if (Array.isArray(value)) {
    // A complete numeric point or a short coordinate ring is a safe bounded
    // JSON.stringify unit. Avoid millions of tiny stringify calls for islands.
    const coordinateLeaf = typeof value[0] === 'number'
      || Array.isArray(value[0]) && !Array.isArray(value[0][0]);
    if (coordinateLeaf && value.length <= 1024) {
      emit(JSON.stringify(value)); return;
    }
    emit('[');
    // Rings longer than 1024 pairs never become a single V8 string.
    if (coordinateLeaf) {
      for (let i = 0; i < value.length; i += 1024) {
        if (i) emit(',');
        const segment = JSON.stringify(value.slice(i, i + 1024));
        emit(segment.slice(1, -1));
      }
    } else {
      for (let i = 0; i < value.length; i++) {
        if (i) emit(',');
        streamJsonValue(value[i], emit);
      }
    }
    emit(']');
    return;
  }
  if (value && typeof value === 'object') {
    emit('{');
    let written = false;
    for (const key of Object.keys(value)) {
      const item = value[key];
      if (item === undefined || typeof item === 'function' || typeof item === 'symbol') continue;
      if (written) emit(',');
      emit(JSON.stringify(key)); emit(':');
      streamJsonValue(item, emit);
      written = true;
    }
    emit('}');
    return;
  }
  // JSON.stringify writes null for undefined/non-finite array members.
  emit(JSON.stringify(value) ?? 'null');
}
