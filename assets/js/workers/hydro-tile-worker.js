/* AtlasWright v0.12.4 Hydro shard, Range, and persistent-cache worker. */
'use strict';

importScripts('../vendor/fflate/fflate.min.js', '../vendor/earcut.min.js');

const textDecoder = new TextDecoder('utf-8');
let manifest = null;
let baseUrl = '';
let assetRevision = '';
let latestRevision = 0;
let busy = false;
let pendingView = null;
let firstViewReady = false;
const tilePacks = new Map();
const logicalPacks = new Map();
const packSpecs = new Map();
const shardSpecs = new Map();
const postedPacks = new Set();
const inFlightPacks = new Map();
const fullShardMemory = new Map();
let rangeSupportPromise = null;

function resolveUrl(path) {
  const url = new URL(path, baseUrl);
  if (assetRevision) url.searchParams.set('v', assetRevision);
  return url.href;
}

async function fetchGzip(path) {
  const response = await fetch(resolveUrl(path));
  if (!response.ok) throw new Error(`${path} HTTP ${response.status}`);
  return self.fflate.gunzipSync(new Uint8Array(await response.arrayBuffer()));
}

function readGlobalIndex(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x33495741 || view.getUint16(4, true) !== 3) {
    throw new Error('수계 공간 인덱스 버전이 올바르지 않습니다.');
  }
  const tileCount = view.getUint32(8, true);
  const logicalCount = view.getUint32(12, true);
  const packCount = view.getUint32(16, true);
  let offset = 20;
  for (let index = 0; index < tileCount; index += 1) {
    const stage = view.getUint8(offset);
    const x = view.getUint16(offset + 1, true);
    const y = view.getUint16(offset + 3, true);
    const count = view.getUint16(offset + 5, true);
    offset += 7;
    const packs = new Array(count);
    for (let item = 0; item < count; item += 1, offset += 4) packs[item] = view.getUint32(offset, true);
    tilePacks.set(`${stage}/${x}-${y}`, packs);
  }
  for (let index = 0; index < logicalCount; index += 1) {
    const logicalFid = view.getUint32(offset, true);
    const count = view.getUint16(offset + 4, true);
    offset += 6;
    const packs = new Array(count);
    for (let item = 0; item < count; item += 1, offset += 4) packs[item] = view.getUint32(offset, true);
    logicalPacks.set(logicalFid, packs);
  }
  for (let index = 0; index < packCount; index += 1) {
    const id = view.getUint32(offset, true);
    const shard = view.getUint16(offset + 4, true);
    const packOffset = view.getUint32(offset + 6, true);
    const length = view.getUint32(offset + 10, true);
    const stage = view.getUint8(offset + 14);
    packSpecs.set(id, { id, shard, offset: packOffset, length, stage });
    offset += 15;
  }
  if (offset !== bytes.length) throw new Error('수계 공간 인덱스에 불필요한 데이터가 있습니다.');
}

async function openHydroCache() {
  if (!('caches' in self)) return null;
  try { return await caches.open(manifest.cache?.name || `atlaswright-hydro-v${manifest.version}`); }
  catch (_) { return null; }
}

async function cachedFullShard(spec) {
  if (fullShardMemory.has(spec.id)) return fullShardMemory.get(spec.id);
  const cache = await openHydroCache();
  if (!cache) return null;
  const response = await cache.match(resolveUrl(spec.url));
  if (!response) return null;
  const bytes = new Uint8Array(await response.arrayBuffer());
  fullShardMemory.set(spec.id, bytes);
  if (fullShardMemory.size > 2) fullShardMemory.delete(fullShardMemory.keys().next().value);
  return bytes;
}

async function fetchPackBytes(packId) {
  const pack = packSpecs.get(Number(packId));
  if (!pack) throw new Error(`수계 pack ${packId} 정보가 없습니다.`);
  const shard = shardSpecs.get(Number(pack.shard));
  if (!shard) throw new Error(`수계 shard ${pack.shard} 정보가 없습니다.`);
  const cached = await cachedFullShard(shard);
  if (cached) return self.fflate.gunzipSync(cached.subarray(pack.offset, pack.offset + pack.length));
  const url = resolveUrl(shard.url);
  const response = await fetch(url, { headers: { Range: `bytes=${pack.offset}-${pack.offset + pack.length - 1}` } });
  if (!response.ok) throw new Error(`${shard.url} HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (response.status === 206) return self.fflate.gunzipSync(bytes);
  if (bytes.length < pack.offset + pack.length) throw new Error(`${shard.url}의 Range 응답이 손상되었습니다.`);
  const cache = await openHydroCache();
  if (cache) {
    try { await cache.put(url, new Response(bytes, { headers: { 'Content-Type': 'application/octet-stream' } })); }
    catch (_) { /* quota errors leave streaming mode available */ }
  }
  return self.fflate.gunzipSync(bytes.subarray(pack.offset, pack.offset + pack.length));
}

async function detectRangeSupport() {
  const first = [...shardSpecs.values()][0];
  if (!first) return false;
  try {
    const response = await fetch(resolveUrl(first.url), { method: 'HEAD' });
    return response.ok && /bytes/i.test(response.headers.get('Accept-Ranges') || '');
  } catch (_) { return false; }
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

function readWidthProfile(bytes, geometry) {
  if (!bytes.length) return [];
  const cursor = { offset: 0 };
  const geometryParts = lineParts(geometry);
  const partCount = readUVarint(bytes, cursor);
  if (partCount !== geometryParts.length) throw new Error('강 너비 part 수가 지오메트리와 다릅니다.');
  return geometryParts.map(points => {
    const count = readUVarint(bytes, cursor);
    if (count !== points.length) throw new Error('강 너비 꼭짓점 수가 지오메트리와 다릅니다.');
    let width = count ? readUVarint(bytes, cursor) : 0;
    const widths = new Array(count);
    for (let index = 0; index < count; index += 1) {
      if (index) width += readSVarint(bytes, cursor);
      widths[index] = width / 1000;
    }
    return widths;
  });
}

function readSourceIds(bytes) {
  if (!bytes.length) return '';
  const cursor = { offset: 0 };
  const count = readUVarint(bytes, cursor);
  let sourceId = count ? readUVarint(bytes, cursor) : 0;
  const ids = new Array(count);
  for (let index = 0; index < count; index += 1) {
    if (index) sourceId += readSVarint(bytes, cursor);
    ids[index] = String(sourceId);
  }
  return ids.join(',');
}

function coordinateCount(geometry) {
  if (geometry.type === 'LineString') return geometry.coordinates.length;
  if (geometry.type === 'MultiLineString' || geometry.type === 'Polygon') return geometry.coordinates.reduce((sum, part) => sum + part.length, 0);
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.reduce((sum, polygon) => sum + polygon.reduce((ringSum, ring) => ringSum + ring.length, 0), 0);
  return 0;
}

function buildMesh(features) {
  const riverStarts = [], riverEnds = [], riverFeatureIds = [], riverStartWidths = [], riverEndWidths = [];
  const borderRiverStarts = [], borderRiverEnds = [], borderRiverFeatureIds = [], borderRiverStartWidths = [], borderRiverEndWidths = [];
  const lakePositions = [], lakeFeatureIds = [], lakeIndices = [];
  for (const feature of features) {
    const fid = Number(feature.properties.__fid);
    if (feature.properties.category === 'river') {
      const aligned = (Number(feature.properties.__flags || 0) & 1) !== 0;
      const starts = aligned ? borderRiverStarts : riverStarts;
      const ends = aligned ? borderRiverEnds : riverEnds;
      const featureIds = aligned ? borderRiverFeatureIds : riverFeatureIds;
      const startWidths = aligned ? borderRiverStartWidths : riverStartWidths;
      const endWidths = aligned ? borderRiverEndWidths : riverEndWidths;
      const parts = lineParts(feature.geometry);
      const profiles = feature.properties.stroke_widths || [];
      for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
        const part = parts[partIndex], widths = profiles[partIndex] || [];
        for (let index = 0; index < part.length - 1; index += 1) {
          starts.push(Math.round(part[index][0] * 1e6), Math.round(part[index][1] * 1e6));
          ends.push(Math.round(part[index + 1][0] * 1e6), Math.round(part[index + 1][1] * 1e6));
          featureIds.push(fid);
          startWidths.push(Number(widths[index] ?? feature.properties.stroke_width ?? 0.8));
          endWidths.push(Number(widths[index + 1] ?? widths[index] ?? feature.properties.stroke_width ?? 0.8));
        }
      }
      continue;
    }
    for (const polygon of polygonParts(feature.geometry)) {
      const vertices = [], holes = [];
      for (let ringIndex = 0; ringIndex < polygon.length; ringIndex += 1) {
        const sourceRing = polygon[ringIndex] || [];
        const last = sourceRing[sourceRing.length - 1];
        const ring = sourceRing.length > 1 && sourceRing[0][0] === last[0] && sourceRing[0][1] === last[1] ? sourceRing.slice(0, -1) : sourceRing;
        if (ring.length < 3) continue;
        if (ringIndex) holes.push(vertices.length / 2);
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
    riverStarts: new Int32Array(riverStarts), riverEnds: new Int32Array(riverEnds), riverFeatureIds: new Uint32Array(riverFeatureIds),
    riverStartWidths: new Float32Array(riverStartWidths), riverEndWidths: new Float32Array(riverEndWidths),
    borderRiverStarts: new Int32Array(borderRiverStarts), borderRiverEnds: new Int32Array(borderRiverEnds), borderRiverFeatureIds: new Uint32Array(borderRiverFeatureIds),
    borderRiverStartWidths: new Float32Array(borderRiverStartWidths), borderRiverEndWidths: new Float32Array(borderRiverEndWidths),
    lakePositions: new Int32Array(lakePositions), lakeFeatureIds: new Uint32Array(lakeFeatureIds), lakeIndices: new Uint32Array(lakeIndices),
  };
}

function readPack(bytes, packId) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46485741 || view.getUint16(4, true) !== 3) throw new Error('수계 feature pack 버전이 올바르지 않습니다.');
  const count = view.getUint32(8, true);
  const features = [];
  let offset = 12;
  for (let index = 0; index < count; index += 1) {
    const fid = view.getUint32(offset, true);
    const logicalFid = view.getUint32(offset + 4, true);
    const kind = view.getUint8(offset + 8);
    const stage = view.getUint8(offset + 9);
    const geometryKind = view.getUint8(offset + 10);
    const flags = view.getUint8(offset + 11);
    const fragmentIndex = view.getUint16(offset + 12, true);
    const fragmentCount = view.getUint16(offset + 14, true);
    const width = view.getFloat32(offset + 16, true);
    const bounds = [0, 1, 2, 3].map(item => view.getInt32(offset + 20 + item * 4, true) / 1e6);
    const lengths = [0, 1, 2, 3, 4].map(item => view.getUint16(offset + 36 + item * 2, true));
    const sourceLength = view.getUint32(offset + 46, true);
    const geometryLength = view.getUint32(offset + 50, true);
    const widthLength = view.getUint32(offset + 54, true);
    offset += 58;
    const strings = [];
    for (const length of lengths) {
      strings.push(textDecoder.decode(bytes.subarray(offset, offset + length)));
      offset += length;
    }
    const sourcePayload = bytes.subarray(offset, offset + sourceLength); offset += sourceLength;
    const geometry = readGeometry(bytes.subarray(offset, offset + geometryLength), geometryKind); offset += geometryLength;
    const widthProfile = kind === 1 ? readWidthProfile(bytes.subarray(offset, offset + widthLength), geometry) : []; offset += widthLength;
    const [awId, name, legacySourceId, source, layerId] = strings;
    features.push({
      type: 'Feature', id: awId,
      properties: {
        __fid: fid, __logicalFid: logicalFid, __flags: flags, border_aligned: (flags & 1) !== 0,
        fragment_index: fragmentIndex, fragment_count: fragmentCount,
        aw_id: awId, layer_id: layerId, category: kind === 1 ? 'river' : 'lake', name, name_ko: name,
        source_id: sourcePayload.length ? readSourceIds(sourcePayload) : legacySourceId, source,
        min_zoom: manifest.stages[stage].minZoom, stage, stroke_width: width, stroke_widths: widthProfile, pack_id: packId,
      },
      geometry, __awBounds: bounds,
    });
  }
  if (offset !== bytes.length) throw new Error(`수계 pack ${packId}에 불필요한 데이터가 있습니다.`);
  const mesh = buildMesh(features);
  return { features, mesh, sourceBytesEstimate: features.reduce((sum, feature) => sum + coordinateCount(feature.geometry) * 16, 0) };
}

async function loadPack(packId) {
  if (inFlightPacks.has(packId)) return inFlightPacks.get(packId);
  const promise = fetchPackBytes(packId).then(bytes => readPack(bytes, packId)).finally(() => inFlightPacks.delete(packId));
  inFlightPacks.set(packId, promise);
  return promise;
}

function postPack(packId, pack, revision) {
  const mesh = pack.mesh;
  postMessage({
    type: 'pack', revision, packId, features: pack.features, sourceBytesEstimate: pack.sourceBytesEstimate,
    mesh: {
      riverStarts: mesh.riverStarts.buffer, riverEnds: mesh.riverEnds.buffer, riverFeatureIds: mesh.riverFeatureIds.buffer,
      riverStartWidths: mesh.riverStartWidths.buffer, riverEndWidths: mesh.riverEndWidths.buffer,
      borderRiverStarts: mesh.borderRiverStarts.buffer, borderRiverEnds: mesh.borderRiverEnds.buffer, borderRiverFeatureIds: mesh.borderRiverFeatureIds.buffer,
      borderRiverStartWidths: mesh.borderRiverStartWidths.buffer, borderRiverEndWidths: mesh.borderRiverEndWidths.buffer,
      lakePositions: mesh.lakePositions.buffer, lakeFeatureIds: mesh.lakeFeatureIds.buffer, lakeIndices: mesh.lakeIndices.buffer,
    },
  }, [
    mesh.riverStarts.buffer, mesh.riverEnds.buffer, mesh.riverFeatureIds.buffer, mesh.riverStartWidths.buffer, mesh.riverEndWidths.buffer,
    mesh.borderRiverStarts.buffer, mesh.borderRiverEnds.buffer, mesh.borderRiverFeatureIds.buffer,
    mesh.borderRiverStartWidths.buffer, mesh.borderRiverEndWidths.buffer,
    mesh.lakePositions.buffer, mesh.lakeFeatureIds.buffer, mesh.lakeIndices.buffer,
  ]);
  postedPacks.add(packId);
}

async function processView(message) {
  latestRevision = Math.max(latestRevision, Number(message.revision || 0));
  const packIds = [...new Set((message.tiles || []).flatMap(spec => tilePacks.get(`${spec.stage}/${spec.x}-${spec.y}`) || []))].sort((a, b) => a - b);
  postMessage({ type: 'active', revision: message.revision, packIds });
  const needed = packIds.filter(packId => !postedPacks.has(packId));
  const supportsRange = await (rangeSupportPromise || Promise.resolve(false));
  const concurrency = message.mobile ? 4 : 6;
  if (supportsRange) {
    let packCursor = 0;
    await Promise.all(Array.from({ length: Math.min(concurrency, needed.length) }, async () => {
      while (packCursor < needed.length) {
        if (message.revision < latestRevision) return;
        const packId = needed[packCursor++];
        const pack = await loadPack(packId);
        if (message.revision < latestRevision) return;
        postPack(packId, pack, message.revision);
      }
    }));
  } else {
    const groups = new Map();
    for (const packId of needed) {
      const shardId = packSpecs.get(packId)?.shard;
      if (!groups.has(shardId)) groups.set(shardId, []);
      groups.get(shardId).push(packId);
    }
    const shardGroups = [...groups.values()];
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(concurrency, shardGroups.length) }, async () => {
      while (cursor < shardGroups.length) {
        const packIdsForShard = shardGroups[cursor++];
        for (const packId of packIdsForShard) {
          if (message.revision < latestRevision) return;
          const pack = await loadPack(packId);
          if (message.revision < latestRevision) return;
          postPack(packId, pack, message.revision);
        }
      }
    }));
  }
  if (message.revision < latestRevision) return;
  postMessage({ type: 'view-ready', revision: message.revision, packIds });
  if (!firstViewReady) {
    firstViewReady = true;
    backgroundCacheShards().catch(error => postMessage({ type: 'cache-unavailable', message: error?.message || String(error) }));
  }
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
  } finally { busy = false; }
}

async function backgroundCacheShards(force = false) {
  const cache = await openHydroCache();
  if (!cache) {
    postMessage({ type: 'cache-unavailable', message: '이 브라우저에서는 수계 영구 저장소를 사용할 수 없습니다.' });
    return;
  }
  const shards = [...shardSpecs.values()];
  const totalBytes = shards.reduce((sum, shard) => sum + Number(shard.bytes || 0), 0);
  let loadedBytes = 0;
  let loadedShards = 0;
  for (const shard of shards) {
    const url = resolveUrl(shard.url);
    let response = force ? null : await cache.match(url);
    if (!response) {
      response = await fetch(url);
      if (!response.ok) throw new Error(`${shard.url} HTTP ${response.status}`);
      try { await cache.put(url, response.clone()); }
      catch (error) {
        postMessage({ type: 'cache-unavailable', message: `수계 저장 공간이 부족합니다. ${error?.message || ''}` });
        return;
      }
    }
    loadedBytes += Number(shard.bytes || 0);
    loadedShards += 1;
    postMessage({ type: 'cache-progress', loadedBytes, totalBytes, loadedShards, totalShards: shards.length, percent: totalBytes ? Math.round(loadedBytes / totalBytes * 100) : 100 });
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  postMessage({ type: 'cache-complete', loadedBytes, totalBytes, loadedShards, totalShards: shards.length, percent: 100 });
}

function mergeLogicalFragments(features) {
  const ordered = features.slice().sort((a, b) => a.properties.fragment_index - b.properties.fragment_index);
  const first = ordered[0];
  if (!first || first.properties.category !== 'river') return first || null;
  const parts = ordered.flatMap(feature => lineParts(feature.geometry));
  const widths = ordered.flatMap(feature => feature.properties.stroke_widths || []);
  const sourceIds = [...new Set(ordered.flatMap(feature => String(feature.properties.source_id || '').split(',').filter(Boolean)))];
  return {
    type: 'Feature', id: first.id,
    properties: { ...first.properties, source_id: sourceIds.join(','), stroke_widths: widths, fragment_index: 0, fragment_count: ordered.length, pack_ids: [...new Set(ordered.map(feature => feature.properties.pack_id))] },
    geometry: parts.length === 1 ? { type: 'LineString', coordinates: parts[0] } : { type: 'MultiLineString', coordinates: parts },
  };
}

async function loadLogicalFeature(message) {
  try {
    const logicalFid = Number(message.logicalFid);
    const packs = logicalPacks.get(logicalFid) || [];
    const decoded = await Promise.all(packs.map(async packId => readPack(await fetchPackBytes(packId), packId)));
    const features = decoded.flatMap(pack => pack.features).filter(feature => Number(feature.properties.__logicalFid) === logicalFid);
    postMessage({ type: 'feature', requestId: message.requestId, feature: mergeLogicalFragments(features) });
  } catch (error) {
    postMessage({ type: 'feature-error', requestId: message.requestId, message: error?.message || String(error) });
  }
}

onmessage = async event => {
  const message = event.data || {};
  if (message.type === 'init') {
    try {
      manifest = message.manifest;
      baseUrl = message.baseUrl;
      assetRevision = message.assetRevision || manifest.version || '';
      for (const shard of manifest.shards || []) shardSpecs.set(Number(shard.id), shard);
      readGlobalIndex(await fetchGzip(manifest.index.url));
      rangeSupportPromise = detectRangeSupport();
      postMessage({ type: 'ready' });
    } catch (error) {
      postMessage({ type: 'error', message: error?.message || String(error) });
    }
    return;
  }
  if (message.type === 'view') drain(message);
  else if (message.type === 'release') for (const packId of message.packIds || []) postedPacks.delete(packId);
  else if (message.type === 'load-feature') loadLogicalFeature(message);
  else if (message.type === 'retry-cache') backgroundCacheShards(true).catch(error => postMessage({ type: 'cache-unavailable', message: error?.message || String(error) }));
};
