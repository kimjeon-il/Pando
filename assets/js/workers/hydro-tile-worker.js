/* AtlasWright v0.12.1 hydro tile loader and mesh worker. */
'use strict';

importScripts('../vendor/fflate/fflate.min.js', '../vendor/earcut.min.js');

const textDecoder = new TextDecoder('utf-8');
let manifest = null;
let baseUrl = '';
let assetRevision = '';
let busy = false;
let pendingView = null;
let latestRevision = 0;
const indexCache = new Map();
const packCache = new Map();
const postedPacks = new Set();

function resolveUrl(template, values = {}) {
  let path = template;
  for (const [key, value] of Object.entries(values)) path = path.replace(`{${key}}`, String(value));
  const url = new URL(path, baseUrl);
  if (assetRevision) url.searchParams.set('v', assetRevision);
  return url.href;
}

async function fetchGzip(url, allowMissing = false) {
  const response = await fetch(url);
  if (allowMissing && response.status === 404) return null;
  if (!response.ok) throw new Error(`${url} HTTP ${response.status}`);
  const compressed = new Uint8Array(await response.arrayBuffer());
  return self.fflate.gunzipSync(compressed);
}

function readIndex(bytes) {
  if (!bytes) return [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x58495741 || view.getUint16(4, true) !== 1) throw new Error('수계 공간 인덱스 형식이 올바르지 않습니다.');
  const count = view.getUint32(8, true);
  const entries = new Array(count);
  let offset = 12;
  for (let index = 0; index < count; index += 1) {
    entries[index] = { packId: view.getUint32(offset, true), fid: view.getUint32(offset + 4, true) };
    offset += 8;
  }
  return entries;
}

function readUVarint(bytes, cursor) {
  let value = 0;
  let shift = 0;
  while (cursor.offset < bytes.length) {
    const byte = bytes[cursor.offset++];
    value |= (byte & 0x7f) << shift;
    if (!(byte & 0x80)) return value >>> 0;
    shift += 7;
    if (shift > 35) throw new Error('수계 varint가 손상되었습니다.');
  }
  throw new Error('수계 varint가 중간에서 끝났습니다.');
}

function readSVarint(bytes, cursor) {
  const value = readUVarint(bytes, cursor);
  return (value >>> 1) ^ -(value & 1);
}

function readLine(bytes, cursor) {
  const count = readUVarint(bytes, cursor);
  const points = new Array(count);
  let x = 0;
  let y = 0;
  for (let index = 0; index < count; index += 1) {
    if (index === 0) {
      x = readSVarint(bytes, cursor);
      y = readSVarint(bytes, cursor);
    } else {
      x += readSVarint(bytes, cursor);
      y += readSVarint(bytes, cursor);
    }
    points[index] = [x / 1e6, y / 1e6];
  }
  return points;
}

function readGeometry(bytes, geometryKind) {
  const cursor = { offset: 0 };
  if (geometryKind === 1 || geometryKind === 2) {
    const partCount = readUVarint(bytes, cursor);
    const parts = new Array(partCount);
    for (let part = 0; part < partCount; part += 1) parts[part] = readLine(bytes, cursor);
    return geometryKind === 1 ? { type: 'LineString', coordinates: parts[0] || [] } : { type: 'MultiLineString', coordinates: parts };
  }
  const polygonCount = readUVarint(bytes, cursor);
  const polygons = new Array(polygonCount);
  for (let polygon = 0; polygon < polygonCount; polygon += 1) {
    const ringCount = readUVarint(bytes, cursor);
    const rings = new Array(ringCount);
    for (let ring = 0; ring < ringCount; ring += 1) rings[ring] = readLine(bytes, cursor);
    polygons[polygon] = rings;
  }
  return geometryKind === 3 ? { type: 'Polygon', coordinates: polygons[0] || [] } : { type: 'MultiPolygon', coordinates: polygons };
}

function lineParts(geometry) {
  if (geometry.type === 'LineString') return [geometry.coordinates];
  if (geometry.type === 'MultiLineString') return geometry.coordinates;
  return [];
}

function polygonParts(geometry) {
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

function coordinateCount(geometry) {
  if (geometry.type === 'LineString') return geometry.coordinates.length;
  if (geometry.type === 'MultiLineString' || geometry.type === 'Polygon') return geometry.coordinates.reduce((sum, part) => sum + part.length, 0);
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.reduce((sum, polygon) => sum + polygon.reduce((ringSum, ring) => ringSum + ring.length, 0), 0);
  return 0;
}

function buildMesh(features) {
  const riverStarts = [];
  const riverEnds = [];
  const riverFeatureIds = [];
  const riverWidths = [];
  const lakePositions = [];
  const lakeFeatureIds = [];
  const lakeIndices = [];
  for (const feature of features) {
    const fid = Number(feature.properties.__fid);
    if (feature.properties.category === 'river') {
      for (const part of lineParts(feature.geometry)) {
        for (let index = 0; index < part.length - 1; index += 1) {
          const a = part[index];
          const b = part[index + 1];
          riverStarts.push(Math.round(a[0] * 1e6), Math.round(a[1] * 1e6));
          riverEnds.push(Math.round(b[0] * 1e6), Math.round(b[1] * 1e6));
          riverFeatureIds.push(fid);
          riverWidths.push(Number(feature.properties.stroke_width || 0.8));
        }
      }
      continue;
    }
    for (const polygon of polygonParts(feature.geometry)) {
      const vertices = [];
      const holes = [];
      for (let ringIndex = 0; ringIndex < polygon.length; ringIndex += 1) {
        const sourceRing = polygon[ringIndex] || [];
        const ring = sourceRing.length > 1 && sourceRing[0][0] === sourceRing[sourceRing.length - 1][0] && sourceRing[0][1] === sourceRing[sourceRing.length - 1][1]
          ? sourceRing.slice(0, -1) : sourceRing;
        if (ring.length < 3) continue;
        if (ringIndex > 0) holes.push(vertices.length / 2);
        for (const point of ring) vertices.push(point[0], point[1]);
      }
      if (vertices.length < 6) continue;
      const base = lakePositions.length / 2;
      const triangles = self.earcut(vertices, holes, 2);
      for (let index = 0; index < vertices.length; index += 2) {
        lakePositions.push(Math.round(vertices[index] * 1e6), Math.round(vertices[index + 1] * 1e6));
        lakeFeatureIds.push(fid);
      }
      for (const triangle of triangles) lakeIndices.push(base + triangle);
    }
  }
  return {
    riverStarts: new Int32Array(riverStarts),
    riverEnds: new Int32Array(riverEnds),
    riverFeatureIds: new Uint32Array(riverFeatureIds),
    riverWidths: new Float32Array(riverWidths),
    lakePositions: new Int32Array(lakePositions),
    lakeFeatureIds: new Uint32Array(lakeFeatureIds),
    lakeIndices: new Uint32Array(lakeIndices),
  };
}

function readPack(bytes, packId) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46485741 || view.getUint16(4, true) !== 1) throw new Error('수계 feature pack 형식이 올바르지 않습니다.');
  const count = view.getUint32(8, true);
  const features = [];
  let offset = 12;
  for (let index = 0; index < count; index += 1) {
    const fid = view.getUint32(offset, true);
    const kind = view.getUint8(offset + 4);
    const stage = view.getUint8(offset + 5);
    const geometryKind = view.getUint8(offset + 6);
    const width = view.getFloat32(offset + 8, true);
    const bounds = [0, 1, 2, 3].map(item => view.getInt32(offset + 12 + item * 4, true) / 1e6);
    const lengths = [0, 1, 2, 3, 4].map(item => view.getUint16(offset + 28 + item * 2, true));
    const payloadLength = view.getUint32(offset + 38, true);
    offset += 42;
    const strings = [];
    for (const length of lengths) {
      strings.push(textDecoder.decode(bytes.subarray(offset, offset + length)));
      offset += length;
    }
    const geometry = readGeometry(bytes.subarray(offset, offset + payloadLength), geometryKind);
    offset += payloadLength;
    const category = kind === 1 ? 'river' : 'lake';
    const [awId, name, sourceId, source, layerId] = strings;
    features.push({
      type: 'Feature', id: awId,
      properties: {
        __fid: fid, aw_id: awId, layer_id: layerId, category, name, name_ko: name,
        source_id: sourceId, source, min_zoom: manifest.stages[stage].minZoom, stage,
        stroke_width: width, pack_id: packId,
      },
      geometry,
      __awBounds: bounds,
    });
  }
  return {
    features,
    mesh: buildMesh(features),
    sourceBytesEstimate: features.reduce((sum, feature) => sum + coordinateCount(feature.geometry) * 16, 0),
  };
}

async function loadIndex(spec) {
  const key = `${spec.stage}/${spec.x}-${spec.y}`;
  if (indexCache.has(key)) return indexCache.get(key);
  const stage = manifest.stages[spec.stage];
  const promise = fetchGzip(resolveUrl(stage.indexTemplate, spec), true).then(readIndex);
  indexCache.set(key, promise);
  return promise;
}

async function loadPack(packId) {
  if (packCache.has(packId)) return packCache.get(packId);
  const promise = fetchGzip(resolveUrl(manifest.packTemplate, { id: packId })).then(bytes => readPack(bytes, packId));
  packCache.set(packId, promise);
  return promise;
}

async function processView(message) {
  latestRevision = Math.max(latestRevision, Number(message.revision || 0));
  const entryGroups = await Promise.all((message.tiles || []).map(loadIndex));
  if (message.revision < latestRevision) return;
  const packIds = [...new Set(entryGroups.flat().map(entry => entry.packId))].sort((a, b) => a - b);
  postMessage({ type: 'active', revision: message.revision, packIds });
  for (const packId of packIds) {
    if (postedPacks.has(packId)) continue;
    const pack = await loadPack(packId);
    if (message.revision < latestRevision) return;
    const mesh = pack.mesh;
    postMessage({
      type: 'pack', revision: message.revision, packId, features: pack.features,
      sourceBytesEstimate: pack.sourceBytesEstimate,
      mesh: {
        riverStarts: mesh.riverStarts.buffer,
        riverEnds: mesh.riverEnds.buffer,
        riverFeatureIds: mesh.riverFeatureIds.buffer,
        riverWidths: mesh.riverWidths.buffer,
        lakePositions: mesh.lakePositions.buffer,
        lakeFeatureIds: mesh.lakeFeatureIds.buffer,
        lakeIndices: mesh.lakeIndices.buffer,
      },
    }, [mesh.riverStarts.buffer, mesh.riverEnds.buffer, mesh.riverFeatureIds.buffer, mesh.riverWidths.buffer, mesh.lakePositions.buffer, mesh.lakeFeatureIds.buffer, mesh.lakeIndices.buffer]);
    postedPacks.add(packId);
    packCache.delete(packId);
  }
  postMessage({ type: 'view-ready', revision: message.revision, packIds });
}

async function drain(message) {
  if (busy) {
    pendingView = message;
    latestRevision = Math.max(latestRevision, Number(message.revision || 0));
    return;
  }
  busy = true;
  let current = message;
  try {
    while (current) {
      pendingView = null;
      await processView(current);
      current = pendingView;
    }
  } catch (error) {
    postMessage({ type: 'error', message: error?.message || String(error), revision: current?.revision || 0 });
  } finally {
    busy = false;
  }
}

onmessage = event => {
  const message = event.data || {};
  if (message.type === 'init') {
    manifest = message.manifest;
    baseUrl = message.baseUrl;
    assetRevision = message.assetRevision || manifest.version || '';
    postMessage({ type: 'ready' });
    return;
  }
  if (message.type === 'view') {
    drain(message);
    return;
  }
  if (message.type === 'release') {
    for (const packId of message.packIds || []) {
      postedPacks.delete(packId);
      packCache.delete(packId);
    }
  }
};
