import { TextEncoder } from 'node:util';

import { CANONICAL_COUNTRY_PACKET_MAGIC } from '../assets/js/modules/canonical-country-packet.js';

const FORMAT_VERSION = 1;
const HEADER_WORDS = 20;

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
  const polygons = featurePolygons({ geometry });
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
  const headerBytes = HEADER_WORDS * Uint32Array.BYTES_PER_ELEMENT;
  const metadataOffset = headerBytes;
  const featureTypesOffset = metadataOffset + metadataBytes.byteLength;
  const featurePolygonOffsetsOffset = align(featureTypesOffset + features.length, 4);
  const polygonRingOffsetsOffset = featurePolygonOffsetsOffset + (features.length + 1) * 4;
  const ringPositionOffsetsOffset = polygonRingOffsetsOffset + (polygonCount + 1) * 4;
  const fingerprintsOffset = ringPositionOffsetsOffset + (ringCount + 1) * 4;
  const positionsOffset = align(fingerprintsOffset + features.length * 2 * 4, 8);
  const totalBytes = positionsOffset + positionCount * 2 * 8;
  const buffer = new ArrayBuffer(totalBytes);
  const header = new Uint32Array(buffer, 0, HEADER_WORDS);
  header.set([
    CANONICAL_COUNTRY_PACKET_MAGIC,
    FORMAT_VERSION,
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
