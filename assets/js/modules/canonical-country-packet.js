export const CANONICAL_COUNTRY_PACKET_MAGIC = 0x31474350; // PCG1
const CANONICAL_COUNTRY_PACKET_VERSION = 1;
const CANONICAL_COUNTRY_PACKET_HEADER_WORDS = 20;

const HEADER = Object.freeze({
  MAGIC: 0,
  VERSION: 1,
  FEATURE_COUNT: 2,
  POLYGON_COUNT: 3,
  RING_COUNT: 4,
  POSITION_COUNT: 5,
  METADATA_BYTES: 6,
  FEATURE_TYPES_BYTES: 7,
  FEATURE_POLYGON_OFFSET_COUNT: 8,
  POLYGON_RING_OFFSET_COUNT: 9,
  RING_POSITION_OFFSET_COUNT: 10,
  FINGERPRINT_WORD_COUNT: 11,
  METADATA_OFFSET: 12,
  FEATURE_TYPES_OFFSET: 13,
  FEATURE_POLYGON_OFFSETS_OFFSET: 14,
  POLYGON_RING_OFFSETS_OFFSET: 15,
  RING_POSITION_OFFSETS_OFFSET: 16,
  FINGERPRINTS_OFFSET: 17,
  POSITIONS_OFFSET: 18,
  TOTAL_BYTES: 19,
});

const align = (value, alignment) => Math.ceil(value / alignment) * alignment;
const isPosition = value => Array.isArray(value)
  && value.length >= 2
  && Number.isFinite(Number(value[0]))
  && Number.isFinite(Number(value[1]));
const featurePolygons = feature => feature?.geometry?.type === 'Polygon'
  ? [feature.geometry.coordinates || []]
  : feature?.geometry?.type === 'MultiPolygon'
    ? feature.geometry.coordinates || []
    : [];

function runtimeMetadata(feature) {
  const properties = feature?.properties || {};
  return {
    id: String(feature?.id || ''),
    properties: {
      name: String(properties.name || '이름 없는 국가'),
      ...(properties.validFrom ? { validFrom: String(properties.validFrom) } : {}),
      ...(properties.validTo ? { validTo: String(properties.validTo) } : {}),
    },
  };
}

function hashGeometryWords(geometry) {
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  const scratch = new DataView(new ArrayBuffer(8));
  const feed = word => {
    const value = Number(word) >>> 0;
    left = Math.imul(left ^ value, 0x01000193) >>> 0;
    right = Math.imul(right ^ value, 0x85ebca6b) >>> 0;
  };
  const polygons = geometry?.type === 'Polygon'
    ? [geometry.coordinates || []]
    : geometry?.type === 'MultiPolygon'
      ? geometry.coordinates || []
      : [];
  feed(geometry?.type === 'MultiPolygon' ? 2 : 1);
  feed(polygons.length);
  for (const polygon of polygons) {
    feed(polygon.length);
    for (const ring of polygon) {
      feed(ring.length);
      for (const coordinate of ring) {
        scratch.setFloat64(0, Number(coordinate[0]), true);
        feed(scratch.getUint32(0, true));
        feed(scratch.getUint32(4, true));
        scratch.setFloat64(0, Number(coordinate[1]), true);
        feed(scratch.getUint32(0, true));
        feed(scratch.getUint32(4, true));
      }
    }
  }
  return [left, right];
}

export function encodeCanonicalCountryPacket(collection) {
  const features = collection?.type === 'FeatureCollection' ? collection.features || [] : [];
  if (!features.length) throw new TypeError('canonical country collection is empty');
  const metadata = features.map(runtimeMetadata);
  if (metadata.some(entry => !entry.id)) throw new TypeError('canonical country packet requires stable feature ids');
  if (new Set(metadata.map(entry => entry.id)).size !== metadata.length) throw new TypeError('canonical country packet feature ids must be unique');

  let polygonCount = 0;
  let ringCount = 0;
  let positionCount = 0;
  for (const feature of features) {
    if (!['Polygon', 'MultiPolygon'].includes(feature?.geometry?.type)) throw new TypeError(`unsupported canonical geometry: ${feature?.geometry?.type || 'missing'}`);
    const polygons = featurePolygons(feature);
    polygonCount += polygons.length;
    for (const polygon of polygons) {
      ringCount += polygon.length;
      for (const ring of polygon) {
        if (!Array.isArray(ring) || ring.some(coordinate => !isPosition(coordinate))) throw new TypeError(`invalid canonical coordinate: ${feature.id}`);
        positionCount += ring.length;
      }
    }
  }

  const metadataBytes = new TextEncoder().encode(JSON.stringify(metadata));
  const headerBytes = CANONICAL_COUNTRY_PACKET_HEADER_WORDS * Uint32Array.BYTES_PER_ELEMENT;
  const metadataOffset = headerBytes;
  const featureTypesOffset = metadataOffset + metadataBytes.byteLength;
  const featurePolygonOffsetsOffset = align(featureTypesOffset + features.length, 4);
  const polygonRingOffsetsOffset = featurePolygonOffsetsOffset + (features.length + 1) * 4;
  const ringPositionOffsetsOffset = polygonRingOffsetsOffset + (polygonCount + 1) * 4;
  const fingerprintsOffset = ringPositionOffsetsOffset + (ringCount + 1) * 4;
  const positionsOffset = align(fingerprintsOffset + features.length * 2 * 4, 8);
  const totalBytes = positionsOffset + positionCount * 2 * 8;
  const buffer = new ArrayBuffer(totalBytes);
  const header = new Uint32Array(buffer, 0, CANONICAL_COUNTRY_PACKET_HEADER_WORDS);
  header.set([
    CANONICAL_COUNTRY_PACKET_MAGIC,
    CANONICAL_COUNTRY_PACKET_VERSION,
    features.length,
    polygonCount,
    ringCount,
    positionCount,
    metadataBytes.byteLength,
    features.length,
    features.length + 1,
    polygonCount + 1,
    ringCount + 1,
    features.length * 2,
    metadataOffset,
    featureTypesOffset,
    featurePolygonOffsetsOffset,
    polygonRingOffsetsOffset,
    ringPositionOffsetsOffset,
    fingerprintsOffset,
    positionsOffset,
    totalBytes,
  ]);
  new Uint8Array(buffer, metadataOffset, metadataBytes.byteLength).set(metadataBytes);
  const featureTypes = new Uint8Array(buffer, featureTypesOffset, features.length);
  const featurePolygonOffsets = new Uint32Array(buffer, featurePolygonOffsetsOffset, features.length + 1);
  const polygonRingOffsets = new Uint32Array(buffer, polygonRingOffsetsOffset, polygonCount + 1);
  const ringPositionOffsets = new Uint32Array(buffer, ringPositionOffsetsOffset, ringCount + 1);
  const fingerprints = new Uint32Array(buffer, fingerprintsOffset, features.length * 2);
  const positions = new Float64Array(buffer, positionsOffset, positionCount * 2);
  let polygonIndex = 0;
  let ringIndex = 0;
  let positionIndex = 0;
  features.forEach((feature, featureIndex) => {
    featureTypes[featureIndex] = feature.geometry.type === 'MultiPolygon' ? 2 : 1;
    featurePolygonOffsets[featureIndex] = polygonIndex;
    const fingerprint = hashGeometryWords(feature.geometry);
    fingerprints[featureIndex * 2] = fingerprint[0];
    fingerprints[featureIndex * 2 + 1] = fingerprint[1];
    for (const polygon of featurePolygons(feature)) {
      polygonRingOffsets[polygonIndex] = ringIndex;
      polygonIndex += 1;
      for (const ring of polygon) {
        ringPositionOffsets[ringIndex] = positionIndex;
        ringIndex += 1;
        for (const coordinate of ring) {
          positions[positionIndex * 2] = Number(coordinate[0]);
          positions[positionIndex * 2 + 1] = Number(coordinate[1]);
          positionIndex += 1;
        }
      }
    }
  });
  featurePolygonOffsets[features.length] = polygonIndex;
  polygonRingOffsets[polygonCount] = ringIndex;
  ringPositionOffsets[ringCount] = positionIndex;
  return buffer;
}

function headerSnapshot(header) {
  return Object.freeze({
    magic: header[HEADER.MAGIC],
    formatVersion: header[HEADER.VERSION],
    featureCount: header[HEADER.FEATURE_COUNT],
    polygonCount: header[HEADER.POLYGON_COUNT],
    ringCount: header[HEADER.RING_COUNT],
    positionCount: header[HEADER.POSITION_COUNT],
    metadataByteLength: header[HEADER.METADATA_BYTES],
    totalByteLength: header[HEADER.TOTAL_BYTES],
    words: Object.freeze(Array.from(header)),
  });
}

function assertMonotonic(values, expectedLast, label) {
  let previous = 0;
  for (let index = 0; index < values.length; index += 1) {
    const current = values[index];
    if (current < previous) throw new Error(`${label} offsets are not monotonic`);
    previous = current;
  }
  if (values[values.length - 1] !== expectedLast) throw new Error(`${label} final offset is invalid`);
}

export function inspectCanonicalCountryPacket(buffer, expectedHeader = null) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < CANONICAL_COUNTRY_PACKET_HEADER_WORDS * 4) throw new TypeError('canonical country packet buffer is invalid');
  const header = new Uint32Array(buffer, 0, CANONICAL_COUNTRY_PACKET_HEADER_WORDS);
  if (header[HEADER.MAGIC] !== CANONICAL_COUNTRY_PACKET_MAGIC || header[HEADER.VERSION] !== CANONICAL_COUNTRY_PACKET_VERSION) throw new Error('canonical country packet header is invalid');
  if (header[HEADER.TOTAL_BYTES] !== buffer.byteLength) throw new Error('canonical country packet byte length is invalid');
  if (expectedHeader && (!Array.isArray(expectedHeader) || expectedHeader.length !== header.length || expectedHeader.some((value, index) => Number(value) !== header[index]))) throw new Error('canonical country packet manifest header is invalid');
  const featureCount = header[HEADER.FEATURE_COUNT];
  const polygonCount = header[HEADER.POLYGON_COUNT];
  const ringCount = header[HEADER.RING_COUNT];
  const positionCount = header[HEADER.POSITION_COUNT];
  if (!featureCount || header[HEADER.FEATURE_TYPES_BYTES] !== featureCount
    || header[HEADER.FEATURE_POLYGON_OFFSET_COUNT] !== featureCount + 1
    || header[HEADER.POLYGON_RING_OFFSET_COUNT] !== polygonCount + 1
    || header[HEADER.RING_POSITION_OFFSET_COUNT] !== ringCount + 1
    || header[HEADER.FINGERPRINT_WORD_COUNT] !== featureCount * 2) throw new Error('canonical country packet counts are invalid');
  const metadataEnd = header[HEADER.METADATA_OFFSET] + header[HEADER.METADATA_BYTES];
  const positionsEnd = header[HEADER.POSITIONS_OFFSET] + positionCount * 2 * 8;
  if (header[HEADER.METADATA_OFFSET] < header.byteLength || metadataEnd > buffer.byteLength
    || header[HEADER.FEATURE_TYPES_OFFSET] < metadataEnd
    || header[HEADER.FEATURE_POLYGON_OFFSETS_OFFSET] % 4
    || header[HEADER.POLYGON_RING_OFFSETS_OFFSET] % 4
    || header[HEADER.RING_POSITION_OFFSETS_OFFSET] % 4
    || header[HEADER.FINGERPRINTS_OFFSET] % 4
    || header[HEADER.POSITIONS_OFFSET] % 8
    || positionsEnd !== buffer.byteLength) throw new Error('canonical country packet offsets are invalid');
  const metadata = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, header[HEADER.METADATA_OFFSET], header[HEADER.METADATA_BYTES])));
  if (!Array.isArray(metadata) || metadata.length !== featureCount || new Set(metadata.map(entry => String(entry?.id || ''))).size !== featureCount) throw new Error('canonical country packet metadata is invalid');
  const featureTypes = new Uint8Array(buffer, header[HEADER.FEATURE_TYPES_OFFSET], featureCount);
  if ([...featureTypes].some(value => value !== 1 && value !== 2)) throw new Error('canonical country packet geometry types are invalid');
  const featurePolygonOffsets = new Uint32Array(buffer, header[HEADER.FEATURE_POLYGON_OFFSETS_OFFSET], featureCount + 1);
  const polygonRingOffsets = new Uint32Array(buffer, header[HEADER.POLYGON_RING_OFFSETS_OFFSET], polygonCount + 1);
  const ringPositionOffsets = new Uint32Array(buffer, header[HEADER.RING_POSITION_OFFSETS_OFFSET], ringCount + 1);
  assertMonotonic(featurePolygonOffsets, polygonCount, 'feature polygon');
  assertMonotonic(polygonRingOffsets, ringCount, 'polygon ring');
  assertMonotonic(ringPositionOffsets, positionCount, 'ring position');
  const positions = new Float64Array(buffer, header[HEADER.POSITIONS_OFFSET], positionCount * 2);
  for (let index = 0; index < positions.length; index += 1) if (!Number.isFinite(positions[index])) throw new Error('canonical country packet contains non-finite positions');
  return headerSnapshot(header);
}

export function canonicalCountryPacketTransferables(buffer) {
  return buffer instanceof ArrayBuffer ? [buffer] : [];
}

export function createCanonicalCountryStore(buffer, { expectedHeader = null } = {}) {
  const summary = inspectCanonicalCountryPacket(buffer, expectedHeader);
  const header = new Uint32Array(buffer, 0, CANONICAL_COUNTRY_PACKET_HEADER_WORDS);
  const metadata = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, header[HEADER.METADATA_OFFSET], header[HEADER.METADATA_BYTES])));
  const featureTypes = new Uint8Array(buffer, header[HEADER.FEATURE_TYPES_OFFSET], summary.featureCount);
  const featurePolygonOffsets = new Uint32Array(buffer, header[HEADER.FEATURE_POLYGON_OFFSETS_OFFSET], summary.featureCount + 1);
  const polygonRingOffsets = new Uint32Array(buffer, header[HEADER.POLYGON_RING_OFFSETS_OFFSET], summary.polygonCount + 1);
  const ringPositionOffsets = new Uint32Array(buffer, header[HEADER.RING_POSITION_OFFSETS_OFFSET], summary.ringCount + 1);
  const fingerprints = new Uint32Array(buffer, header[HEADER.FINGERPRINTS_OFFSET], summary.featureCount * 2);
  const positions = new Float64Array(buffer, header[HEADER.POSITIONS_OFFSET], summary.positionCount * 2);
  const idToIndex = new Map(metadata.map((entry, index) => [String(entry.id), index]));

  const resolveIndex = value => typeof value === 'number' && Number.isInteger(value)
    ? value
    : idToIndex.get(String(value));
  const materializeFeature = value => {
    const featureIndex = resolveIndex(value);
    if (!Number.isInteger(featureIndex) || featureIndex < 0 || featureIndex >= summary.featureCount) return null;
    const polygonStart = featurePolygonOffsets[featureIndex];
    const polygonEnd = featurePolygonOffsets[featureIndex + 1];
    const polygons = new Array(polygonEnd - polygonStart);
    for (let polygonIndex = featurePolygonOffsets[featureIndex]; polygonIndex < featurePolygonOffsets[featureIndex + 1]; polygonIndex += 1) {
      const ringStart = polygonRingOffsets[polygonIndex];
      const ringEnd = polygonRingOffsets[polygonIndex + 1];
      const polygon = new Array(ringEnd - ringStart);
      for (let ringIndex = polygonRingOffsets[polygonIndex]; ringIndex < polygonRingOffsets[polygonIndex + 1]; ringIndex += 1) {
        const positionStart = ringPositionOffsets[ringIndex];
        const positionEnd = ringPositionOffsets[ringIndex + 1];
        const ring = new Array(positionEnd - positionStart);
        for (let positionIndex = positionStart; positionIndex < positionEnd; positionIndex += 1) {
          ring[positionIndex - positionStart] = [positions[positionIndex * 2], positions[positionIndex * 2 + 1]];
        }
        polygon[ringIndex - ringStart] = ring;
      }
      polygons[polygonIndex - polygonStart] = polygon;
    }
    const entry = metadata[featureIndex];
    return {
      type: 'Feature',
      id: String(entry.id),
      properties: { ...(entry.properties || {}) },
      geometry: featureTypes[featureIndex] === 1
        ? { type: 'Polygon', coordinates: polygons[0] || [] }
        : { type: 'MultiPolygon', coordinates: polygons },
    };
  };
  const materializeCollectionSync = () => ({
    type: 'FeatureCollection',
    features: metadata.map((_, index) => materializeFeature(index)),
  });
  const materializeCollection = async ({
    budgetMs = 4,
    coordinateBudget = 4096,
    waitForQuiet = async () => {},
    yieldFrame = async () => {},
    onSlice = () => {},
    now = () => globalThis.performance?.now?.() ?? Date.now(),
  } = {}) => {
    const features = new Array(summary.featureCount);
    let sliceStart = now();
    let sliceCoordinates = 0;
    let sliceCount = 0;
    let maxSliceMs = 0;
    const yieldSlice = async force => {
      const elapsed = now() - sliceStart;
      if (!force && sliceCoordinates < coordinateBudget && elapsed < budgetMs) return;
      sliceCount += 1;
      maxSliceMs = Math.max(maxSliceMs, elapsed);
      onSlice({ sliceCount, elapsed, coordinateCount: sliceCoordinates });
      await yieldFrame();
      await waitForQuiet();
      sliceStart = now();
      sliceCoordinates = 0;
    };
    await waitForQuiet();
    for (let featureIndex = 0; featureIndex < summary.featureCount; featureIndex += 1) {
      const polygonStart = featurePolygonOffsets[featureIndex];
      const polygonEnd = featurePolygonOffsets[featureIndex + 1];
      const polygons = new Array(polygonEnd - polygonStart);
      for (let polygonIndex = featurePolygonOffsets[featureIndex]; polygonIndex < featurePolygonOffsets[featureIndex + 1]; polygonIndex += 1) {
        const ringStart = polygonRingOffsets[polygonIndex];
        const ringEnd = polygonRingOffsets[polygonIndex + 1];
        const polygon = new Array(ringEnd - ringStart);
        for (let ringIndex = polygonRingOffsets[polygonIndex]; ringIndex < polygonRingOffsets[polygonIndex + 1]; ringIndex += 1) {
          const positionStart = ringPositionOffsets[ringIndex];
          const positionEnd = ringPositionOffsets[ringIndex + 1];
          const ring = new Array(positionEnd - positionStart);
          for (let positionIndex = positionStart; positionIndex < positionEnd; positionIndex += 1) {
            ring[positionIndex - positionStart] = [positions[positionIndex * 2], positions[positionIndex * 2 + 1]];
            sliceCoordinates += 1;
            if ((sliceCoordinates & 255) === 0) await yieldSlice(false);
          }
          polygon[ringIndex - ringStart] = ring;
        }
        polygons[polygonIndex - polygonStart] = polygon;
      }
      const entry = metadata[featureIndex];
      features[featureIndex] = {
        type: 'Feature',
        id: String(entry.id),
        properties: { ...(entry.properties || {}) },
        geometry: featureTypes[featureIndex] === 1
          ? { type: 'Polygon', coordinates: polygons[0] || [] }
          : { type: 'MultiPolygon', coordinates: polygons },
      };
      await yieldSlice(false);
    }
    const finalElapsed = now() - sliceStart;
    if (sliceCoordinates || finalElapsed) {
      sliceCount += 1;
      maxSliceMs = Math.max(maxSliceMs, finalElapsed);
      onSlice({ sliceCount, elapsed: finalElapsed, coordinateCount: sliceCoordinates, final: true });
    }
    return {
      collection: { type: 'FeatureCollection', features },
      metrics: { sliceCount, maxSliceMs, coordinateCount: summary.positionCount },
    };
  };
  const geometryEquals = (value, geometry) => {
    const featureIndex = resolveIndex(value);
    if (!Number.isInteger(featureIndex) || !geometry) return false;
    const fingerprint = hashGeometryWords(geometry);
    if (fingerprint[0] !== fingerprints[featureIndex * 2]
        || fingerprint[1] !== fingerprints[featureIndex * 2 + 1]) return false;
    const expectedType = featureTypes[featureIndex] === 1 ? 'Polygon' : 'MultiPolygon';
    if (geometry.type !== expectedType) return false;
    const polygons = expectedType === 'Polygon' ? [geometry.coordinates || []] : geometry.coordinates || [];
    const polygonStart = featurePolygonOffsets[featureIndex];
    const polygonEnd = featurePolygonOffsets[featureIndex + 1];
    if (polygons.length !== polygonEnd - polygonStart) return false;
    for (let localPolygon = 0; localPolygon < polygons.length; localPolygon += 1) {
      const polygonIndex = polygonStart + localPolygon;
      const rings = polygons[localPolygon] || [];
      const ringStart = polygonRingOffsets[polygonIndex];
      const ringEnd = polygonRingOffsets[polygonIndex + 1];
      if (rings.length !== ringEnd - ringStart) return false;
      for (let localRing = 0; localRing < rings.length; localRing += 1) {
        const ringIndex = ringStart + localRing;
        const ring = rings[localRing] || [];
        const positionStart = ringPositionOffsets[ringIndex];
        const positionEnd = ringPositionOffsets[ringIndex + 1];
        if (ring.length !== positionEnd - positionStart) return false;
        for (let localPosition = 0; localPosition < ring.length; localPosition += 1) {
          const coordinate = ring[localPosition];
          const positionIndex = positionStart + localPosition;
          if (!isPosition(coordinate)
              || !Object.is(Number(coordinate[0]), positions[positionIndex * 2])
              || !Object.is(Number(coordinate[1]), positions[positionIndex * 2 + 1])) return false;
        }
      }
    }
    return true;
  };
  return Object.freeze({
    byteLength: buffer.byteLength,
    featureCount: summary.featureCount,
    ids: () => Object.freeze(metadata.map(entry => String(entry.id))),
    getFingerprint: value => {
      const index = resolveIndex(value);
      return Number.isInteger(index) ? `${fingerprints[index * 2].toString(16).padStart(8, '0')}${fingerprints[index * 2 + 1].toString(16).padStart(8, '0')}` : '';
    },
    geometryEquals,
    materializeFeature,
    materializeCollection,
    materializeCollectionSync,
    summary,
  });
}
