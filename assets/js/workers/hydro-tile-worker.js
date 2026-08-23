/* AtlasWright v0.16.3 water-system shard, Range, and persistent-cache worker. */
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
let includeGeometry = false;
let interactionActive = false;
let foregroundActive = false;
let cacheStarted = false;
let cacheProgressAt = 0;
const featureMetadata = new Map();
let detailMetadataPromise = null;
let canvasPort = null;

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
  if (view.getUint32(0, true) !== 0x34495741 || view.getUint16(4, true) !== 4) {
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

function readFeatureMetadata(bytes) {
  const payload = JSON.parse(textDecoder.decode(bytes));
  if (Number(payload?.version) !== 5 || !Array.isArray(payload?.features)) {
    throw new Error('수계 메타데이터 버전이 올바르지 않습니다.');
  }
  for (const row of payload.features) featureMetadata.set(Number(row.fid), row);
}

async function ensureDetailMetadata() {
  if (detailMetadataPromise) return detailMetadataPromise;
  const detailUrl = manifest.metadata?.detail?.url;
  if (!detailUrl) return null;
  detailMetadataPromise = fetchGzip(detailUrl).then(bytes => {
    const payload = JSON.parse(textDecoder.decode(bytes));
    if (Number(payload?.version) !== 5 || !Array.isArray(payload?.features)) {
      throw new Error('수계 상세 메타데이터 버전이 올바르지 않습니다.');
    }
    for (const row of payload.features) {
      const metadata = featureMetadata.get(Number(row.fid));
      if (metadata) Object.assign(metadata, row);
    }
  });
  return detailMetadataPromise;
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
  if (view.getUint32(0, true) !== 0x46485741 || view.getUint16(4, true) !== 4) throw new Error('수계 feature pack 버전이 올바르지 않습니다.');
  const count = view.getUint32(8, true);
  const features = [];
  const descriptors = [];
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
    const geometryLength = view.getUint32(offset + 36, true);
    const widthLength = view.getUint32(offset + 40, true);
    offset += 44;
    const geometry = readGeometry(bytes.subarray(offset, offset + geometryLength), geometryKind); offset += geometryLength;
    const widthProfile = kind === 1 ? readWidthProfile(bytes.subarray(offset, offset + widthLength), geometry) : []; offset += widthLength;
    const metadata = featureMetadata.get(fid);
    if (!metadata || Number(metadata.logicalFid) !== logicalFid) throw new Error(`수계 feature ${fid} 메타데이터가 없습니다.`);
    const feature = {
      type: 'Feature', id: metadata.awId,
      properties: {
        __fid: fid, __logicalFid: logicalFid, __flags: flags, border_aligned: (flags & 1) !== 0,
        fragment_index: fragmentIndex, fragment_count: fragmentCount,
        aw_id: metadata.awId, layer_id: metadata.layerId, category: kind === 1 ? 'river' : 'lake', name: metadata.name || '', name_ko: metadata.name || '',
        source_id: metadata.sourceId || '', source: metadata.source || '',
        system_id: metadata.systemId || '', mainstem_name_ko: metadata.mainstemNameKo || metadata.name || '',
        role: metadata.role || '', aliases: metadata.aliases || [], tributary_names: metadata.tributaryNames || [],
        osm_relation_ids: metadata.osmRelationIds || [],
        min_zoom: manifest.stages[stage].minZoom, stage, stroke_width: width, stroke_widths: widthProfile, pack_id: packId,
      },
      geometry, __awBounds: bounds,
    };
    features.push(feature);
    descriptors.push({
      fid, logicalFid, flags, fragmentIndex, fragmentCount,
      awId: metadata.awId, name: metadata.name || '', source: metadata.source || '',
      systemId: metadata.systemId || '', mainstemNameKo: metadata.mainstemNameKo || metadata.name || '', role: metadata.role || '',
      sourceId: metadata.sourceId || '', layerId: metadata.layerId,
      category: kind === 1 ? 'river' : 'lake', minZoom: manifest.stages[stage].minZoom,
      stage, width, packId, bounds: metadata.bounds || bounds.map(value => Math.round(value * 1e6)),
    });
  }
  if (offset !== bytes.length) throw new Error(`수계 pack ${packId}에 불필요한 데이터가 있습니다.`);
  const mesh = buildMesh(features);
  return { features, descriptors, mesh };
}

async function loadPack(packId) {
  if (inFlightPacks.has(packId)) return inFlightPacks.get(packId);
  const promise = fetchPackBytes(packId).then(bytes => readPack(bytes, packId)).finally(() => inFlightPacks.delete(packId));
  inFlightPacks.set(packId, promise);
  return promise;
}

function coalescePackRanges(packIds) {
  const byShard = new Map();
  for (const packId of packIds) {
    const spec = packSpecs.get(Number(packId));
    if (!spec) continue;
    if (!byShard.has(spec.shard)) byShard.set(spec.shard, []);
    byShard.get(spec.shard).push(spec);
  }
  const groups = [];
  for (const [shard, rows] of byShard) {
    rows.sort((left, right) => left.offset - right.offset);
    let group = null;
    for (const row of rows) {
      const rowEnd = row.offset + row.length;
      if (!group || row.offset - group.end > 32 * 1024 || rowEnd - group.start > 1024 * 1024) {
        group = { shard, start: row.offset, end: rowEnd, rows: [row] };
        groups.push(group);
      } else {
        group.end = Math.max(group.end, rowEnd);
        group.rows.push(row);
      }
    }
  }
  return groups.sort((left, right) => left.shard - right.shard || left.start - right.start);
}

async function loadPackRangeGroup(group) {
  const shard = shardSpecs.get(Number(group.shard));
  if (!shard) throw new Error(`수계 shard ${group.shard} 정보가 없습니다.`);
  const cached = await cachedFullShard(shard);
  let bytes = cached;
  let baseOffset = 0;
  if (!bytes) {
    const url = resolveUrl(shard.url);
    const response = await fetch(url, { headers: { Range: `bytes=${group.start}-${group.end - 1}` } });
    if (!response.ok) throw new Error(`${shard.url} HTTP ${response.status}`);
    bytes = new Uint8Array(await response.arrayBuffer());
    if (response.status === 206) baseOffset = group.start;
    else {
      if (bytes.length < group.end) throw new Error(`${shard.url}의 Range 응답이 손상되었습니다.`);
      const cache = await openHydroCache();
      if (cache) {
        try { await cache.put(url, new Response(bytes, { headers: { 'Content-Type': 'application/octet-stream' } })); }
        catch (_) { /* foreground rendering must continue */ }
      }
      fullShardMemory.set(shard.id, bytes);
    }
  }
  return group.rows.map(row => {
    const start = row.offset - baseOffset;
    const compressed = bytes.subarray(start, start + row.length);
    return [row.id, readPack(self.fflate.gunzipSync(compressed), row.id)];
  });
}

function postPack(packId, pack, revision) {
  const mesh = pack.mesh;
  postMessage({
    type: 'pack', revision, packId, descriptors: pack.descriptors,
    features: includeGeometry ? pack.features : null,
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
  canvasPort?.postMessage({ type: 'pack', revision, packId, features: pack.features });
  postedPacks.add(packId);
}

function postActive(revision, packIds) {
  postMessage({ type: 'active', revision, packIds });
  canvasPort?.postMessage({ type: 'active', revision, packIds });
}

async function processView(message) {
  latestRevision = Math.max(latestRevision, Number(message.revision || 0));
  const packIds = [...new Set((message.tiles || []).flatMap(spec => tilePacks.get(`${spec.stage}/${spec.x}-${spec.y}`) || []))].sort((a, b) => a - b);
  const needed = packIds.filter(packId => !postedPacks.has(packId));
  let activated = needed.length === 0 || packIds.some(packId => postedPacks.has(packId));
  if (activated) postActive(message.revision, packIds);
  const supportsRange = await (rangeSupportPromise || Promise.resolve(false));
  const concurrency = message.mobile ? 2 : 4;
  foregroundActive = true;
  if (supportsRange) {
    const groups = coalescePackRanges(needed);
    let groupCursor = 0;
    await Promise.all(Array.from({ length: Math.min(concurrency, groups.length) }, async () => {
      while (groupCursor < groups.length) {
        if (message.revision < latestRevision) return;
        const group = groups[groupCursor++];
        const rows = await loadPackRangeGroup(group);
        if (message.revision < latestRevision) return;
        for (const [packId, pack] of rows) postPack(packId, pack, message.revision);
        if (!activated && rows.length) {
          activated = true;
          postActive(message.revision, packIds);
        }
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
          if (!activated) {
            activated = true;
            postActive(message.revision, packIds);
          }
        }
      }
    }));
  }
  foregroundActive = false;
  if (message.revision < latestRevision) return;
  if (!activated) postActive(message.revision, packIds);
  postMessage({ type: 'view-ready', revision: message.revision, packIds });
  if (!firstViewReady) {
    firstViewReady = true;
    scheduleBackgroundCache();
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
  } finally { busy = false; foregroundActive = false; }
}

function scheduleBackgroundCache(force = false) {
  if (cacheStarted && !force) return;
  cacheStarted = true;
  setTimeout(() => backgroundCacheShards(force).catch(error => postMessage({ type: 'cache-unavailable', message: error?.message || String(error) })), force ? 0 : 2000);
}

async function waitForCacheIdle() {
  while (interactionActive || foregroundActive || busy) {
    await new Promise(resolve => setTimeout(resolve, 250));
  }
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
    await waitForCacheIdle();
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
    const now = performance.now();
    if (now - cacheProgressAt >= 250 || loadedShards === shards.length) {
      cacheProgressAt = now;
      postMessage({ type: 'cache-progress', loadedBytes, totalBytes, loadedShards, totalShards: shards.length, percent: totalBytes ? Math.round(loadedBytes / totalBytes * 100) : 100 });
    }
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
    await ensureDetailMetadata();
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
      includeGeometry = message.includeGeometry === true;
      for (const shard of manifest.shards || []) shardSpecs.set(Number(shard.id), shard);
      readGlobalIndex(await fetchGzip(manifest.index.url));
      readFeatureMetadata(await fetchGzip(manifest.metadata?.core?.url || manifest.metadata?.url));
      rangeSupportPromise = detectRangeSupport();
      postMessage({ type: 'ready' });
    } catch (error) {
      postMessage({ type: 'error', message: error?.message || String(error) });
    }
    return;
  }
  if (message.type === 'view') drain(message);
  else if (message.type === 'release') {
    for (const packId of message.packIds || []) postedPacks.delete(packId);
    canvasPort?.postMessage({ type: 'release', packIds: message.packIds || [] });
  }
  else if (message.type === 'hydro-port') {
    canvasPort?.close?.();
    canvasPort = message.port || null;
    canvasPort?.start?.();
  }
  else if (message.type === 'load-feature') loadLogicalFeature(message);
  else if (message.type === 'interaction') interactionActive = message.active === true;
  else if (message.type === 'retry-cache') scheduleBackgroundCache(true);
};
