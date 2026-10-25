import { buildSelectionBoundarySegments } from './selection-stroke-geometry.js';
import { resolveRenderLod, simplifyRenderGeometry } from './render-lod.js';
import '../workers/gpu-mesh-core.js';
import { sharedCalculationCore } from './temporal.js';
import { geometryRevisionKey } from './geometry-versions.js';
import { geometryReferenceFor } from './geometry-version-store.js';

globalThis.PandoLabGpuMeshCore.setSharedCore(sharedCalculationCore);

const EMPTY_REVISIONS = Object.freeze({
  geometry: 0,
  style: 0,
  overlayOrder: 0,
  countryState: 0,
  selection: 0,
  editPreview: 0,
  view: 0,
});

const isPolygonGeometry = geometry => geometry?.type === 'Polygon' || geometry?.type === 'MultiPolygon';

function finiteCoordinate(value) {
  return Array.isArray(value) && value.length >= 2
    && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]));
}

export function buildPolygonGeometryPacket(geometry) {
  return globalThis.PandoLabGpuMeshCore.buildPolygonGeometryPacket(geometry);
}

export function buildStrokeGeometryPacket(geometry) {
  if (isPolygonGeometry(geometry)) {
    const mesh = buildPolygonGeometryPacket(geometry);
    return Object.freeze({ startsEnds: mesh.startsEnds, segmentCount: mesh.segmentCount });
  }
  const startsEnds = [];
  for (const segment of buildSelectionBoundarySegments(geometry, { densify: true })) {
    const [start, end] = segment || [];
    if (!finiteCoordinate(start) || !finiteCoordinate(end)) continue;
    const values = [Number(start[0]), Number(start[1]), Number(end[0]), Number(end[1])];
    if (Math.hypot(values[2] - values[0], values[3] - values[1]) <= 1e-12) continue;
    startsEnds.push(...values);
  }
  return Object.freeze({
    startsEnds: new Float32Array(startsEnds),
    segmentCount: startsEnds.length / 4,
  });
}

function normalizedStyle(style = {}) {
  const color = /^#[0-9a-f]{6}$/i.test(String(style.color || '')) ? String(style.color).toLowerCase() : '#000000';
  const casing = style.casing && typeof style.casing === 'object'
    ? Object.freeze({
      color: /^#[0-9a-f]{6}$/i.test(String(style.casing.color || '')) ? String(style.casing.color).toLowerCase() : '#000000',
      alpha: Math.max(0, Math.min(1, Number(style.casing.alpha ?? 1))),
      width: Math.max(0, Number(style.casing.width || 0)),
    })
    : null;
  return Object.freeze({
    color,
    alpha: Math.max(0, Math.min(1, Number(style.alpha ?? 1))),
    width: Math.max(0, Number(style.width ?? 1)),
    scaleWithView: style.scaleWithView === true,
    antiAlias: style.antiAlias !== false,
    coverage: style.coverage === 'union' ? 'union' : 'normal',
    innerCutout: Math.max(0, Number(style.innerCutout) || 0),
    fillAlpha: Math.max(0, Math.min(1, Number(style.fillAlpha ?? style.alpha ?? 1))),
    casing,
    cap: style.cap === 'butt' ? 'butt' : 'round',
    join: ['round', 'bevel', 'miter'].includes(style.join) ? style.join : 'round',
    dash: Object.freeze(Array.isArray(style.dash) ? [Math.max(0, Number(style.dash[0]) || 0), Math.max(0, Number(style.dash[1]) || 0)] : [0, 0]),
    miterLimit: Math.max(1, Number(style.miterLimit) || 4),
    blendMode: style.blendMode === 'multiply' ? 'multiply' : 'normal',
  });
}

function packetKey(item, kind, lod = 'high', projection = 'flat') {
  const reference = geometryReferenceFor(item?.geometry);
  return `${kind}:${String(item?.key || '')}:${reference ? JSON.stringify(reference) : ''}:${String(item?.geometryRevision || geometryRevisionKey(item?.geometry))}:${lod}:${projection}:mesh-${globalThis.PandoLabGpuMeshCore.MESH_ALGORITHM_REVISION}:edge-${globalThis.PandoLabGpuMeshCore.MAX_RENDER_EDGE_DEGREES}`;
}

function geometryPacketByteLength(packet) {
  return Number(packet?.positions?.byteLength || 0)
    + Number(packet?.indices?.byteLength || 0)
    + Number(packet?.boundaryIndices?.byteLength || 0)
    + Number(packet?.featureIds?.byteLength || 0)
    + Number(packet?.ringCoordinates?.byteLength || 0)
    + Number(packet?.ringOffsets?.byteLength || 0)
    + Number(packet?.polygonOffsets?.byteLength || 0)
    + Number(packet?.startsEnds?.byteLength || 0);
}

function freezePacket(item, geometryPacket, kind, { lod = 'high', projection = 'flat', protected: protectedGeometry = false } = {}) {
  const ownerRanges = item?.ownerRanges && typeof item.ownerRanges === 'object'
    ? Object.freeze(Object.fromEntries(Object.entries(item.ownerRanges).map(([key, range]) => [String(key), Object.freeze({
      first: Math.max(0, Number(range?.first || 0)),
      count: Math.max(0, Number(range?.count || 0)),
    })])))
    : undefined;
  return Object.freeze({
    key: String(item?.key || ''),
    domain: String(item?.domain || ''),
    objectKey: String(item?.objectKey || ''),
    continuityOwnerIds: Object.freeze([...(item?.continuityOwnerIds || [])].map(String)),
    geometryRevision: item?.geometryRevision ?? 0,
    order: Number(item?.order || 0),
    style: normalizedStyle(item?.style),
    blendMode: item?.blendMode === 'multiply' || item?.style?.blendMode === 'multiply' ? 'multiply' : 'normal',
    role: String(item?.role || ''),
    interactionPriority: Number(item?.interactionPriority || 0),
    ownerId: String(item?.ownerId || ''),
    parentId: String(item?.parentId || ''),
    territoryDepth: Number(item?.territoryDepth || 0),
    sourceKey: packetKey(item, kind, lod, projection),
    chunkKey: String(item?.chunkKey || item?.key || ''),
    lod,
    lodPolicy: String(item?.lodPolicy || 'exact'),
    priority: Math.max(Number(item?.priority || 0), protectedGeometry ? 100 : 0),
    protected: item?.protected === true || protectedGeometry,
    byteLength: geometryPacketByteLength(geometryPacket),
    ownerIds: item?.ownerIds ? Object.freeze([...item.ownerIds].map(String)) : undefined,
    ownerRanges,
    ...geometryPacket,
  });
}

export function createRenderSceneBuilder({
  cacheLimit = 4096,
  cacheByteBudget = 192 * 1024 * 1024,
  meshJobs = null,
} = {}) {
  const polygonCache = new Map();
  const prepared = new Map();
  let preparationRevision = 0;
  const strokeCache = new Map();
  let polygonCacheBytes = 0;
  let strokeCacheBytes = 0;
  let cacheBudgetBytes = Math.max(1, Number(cacheByteBudget) || 1);
  let cacheEvictionCount = 0;
  let buildCount = 0;
  let patchCount = 0;
  let polygonCacheHits = 0;
  let polygonCacheMisses = 0;
  let strokeCacheHits = 0;
  let strokeCacheMisses = 0;
  let triangulationMs = 0;

  function deleteCacheEntry(cache, key) {
    const packet = cache.get(key);
    if (!packet) return false;
    cache.delete(key);
    const bytes = geometryPacketByteLength(packet);
    if (cache === polygonCache) polygonCacheBytes = Math.max(0, polygonCacheBytes - bytes);
    else strokeCacheBytes = Math.max(0, strokeCacheBytes - bytes);
    cacheEvictionCount += 1;
    return true;
  }

  function trimCaches() {
    while (polygonCache.size + strokeCache.size > cacheLimit
      || polygonCacheBytes + strokeCacheBytes > cacheBudgetBytes) {
      const cache = polygonCacheBytes >= strokeCacheBytes ? polygonCache : strokeCache;
      const fallback = cache === polygonCache ? strokeCache : polygonCache;
      const target = cache.size ? cache : fallback;
      const key = target.keys().next().value;
      if (key === undefined || !deleteCacheEntry(target, key)) break;
    }
  }

  function cacheGeometry(cache, key, packet) {
    if (cache.has(key)) deleteCacheEntry(cache, key);
    cache.set(key, packet);
    const bytes = geometryPacketByteLength(packet);
    if (cache === polygonCache) polygonCacheBytes += bytes;
    else strokeCacheBytes += bytes;
    trimCaches();
  }

  function packetContext(item, input = {}) {
    const protectedKeys = input.protectedKeys instanceof Set
      ? input.protectedKeys
      : new Set([...(input.protectedKeys || [])].map(String));
    const protectedGeometry = item?.protected === true || protectedKeys.has(String(item?.objectKey || item?.key || ''));
    return {
      lod: resolveRenderLod({
        requested: input.renderQuality?.backgroundLod || input.quality?.backgroundLod || 'high',
        policy: item?.lodPolicy || 'exact',
        protected: protectedGeometry,
      }),
      projection: input.projection === 'globe' ? 'globe' : 'flat',
      protected: protectedGeometry,
    };
  }

  // A scene-local source map lets the fill and outline roles share one
  // prepared triangle mesh even if their presentation keys differ.
  const sourceKey = (item, context) =>
    `${geometryRevisionKey(item.geometry)}:${context.lod}:${context.projection}:${item.lodPolicy || 'exact'}`;

  function polygonPacket(item, input = {}, sources = null) {
    const context = packetContext(item, input);
    const key = packetKey(item, 'polygon', context.lod, context.projection);
    const source = sourceKey(item, context);
    const cached = polygonCache.get(key);
    if (cached) {
      polygonCache.delete(key);
      polygonCache.set(key, cached);
      sources?.set(source, cached);
      polygonCacheHits += 1;
      return freezePacket(item, cached, 'polygon', context);
    }
    let geometryPacket = sources?.get(source);
    if (geometryPacket) polygonCacheHits += 1;
    else if (meshJobs) {
      geometryPacket = prepared.get(key);
      if (!geometryPacket) throw Object.assign(new Error(`준비되지 않은 GPU 면: ${item.key}`), { code: 'PL-MESH-NOT-PREPARED' });
      polygonCacheMisses += 1;
    } else {
      const started = performance.now();
      const renderGeometry = simplifyRenderGeometry(item?.geometry, {
        lod: context.lod,
        policy: item?.lodPolicy || 'exact',
        projection: context.projection,
      });
      geometryPacket = buildPolygonGeometryPacket(renderGeometry);
      triangulationMs += performance.now() - started;
      polygonCacheMisses += 1;
    }
    cacheGeometry(polygonCache, key, geometryPacket);
    sources?.set(source, geometryPacket);
    return freezePacket(item, geometryPacket, 'polygon', context);
  }

  function strokePacket(item, input = {}, sources = null) {
    const context = packetContext(item, input);
    const key = packetKey(item, 'stroke', context.lod, context.projection);
    const cached = strokeCache.get(key);
    if (cached) {
      strokeCache.delete(key);
      strokeCache.set(key, cached);
      strokeCacheHits += 1;
      return freezePacket(item, cached, 'stroke', context);
    }
    let geometryPacket;
    if (item?.startsEnds instanceof Float32Array) {
      geometryPacket = Object.freeze({ startsEnds: item.startsEnds, segmentCount: Number(item.segmentCount || item.startsEnds.length / 4) });
    } else if (isPolygonGeometry(item?.geometry)) {
      const polygonKey = packetKey(item, 'polygon', context.lod, context.projection);
      const mesh = sources?.get(sourceKey(item, context)) || polygonCache.get(polygonKey)
        || prepared.get(polygonKey) || polygonPacket(item, input, sources);
      geometryPacket = Object.freeze({ startsEnds: mesh.startsEnds, segmentCount: mesh.segmentCount });
    } else {
      geometryPacket = buildStrokeGeometryPacket(simplifyRenderGeometry(item?.geometry, {
        lod: context.lod,
        policy: item?.lodPolicy || 'exact',
        projection: context.projection,
      }));
    }
    cacheGeometry(strokeCache, key, geometryPacket);
    strokeCacheMisses += 1;
    return freezePacket(item, geometryPacket, 'stroke', context);
  }

  function build(input = {}) {
    buildCount += 1;
    const sources = new Map();
    const polygons = (input.polygons || []).filter(item => item?.key && item?.geometry)
      .map(item => polygonPacket(item, input, sources)).filter(packet => packet.triangleCount > 0)
      .sort((left, right) => left.order - right.order);
    const strokes = (input.strokes || []).filter(item => item?.key && (item?.geometry || item?.startsEnds))
      .map(item => strokePacket(item, input, sources)).filter(packet => packet.segmentCount > 0)
      .sort((left, right) => left.order - right.order);
    const revisions = Object.freeze({ ...EMPTY_REVISIONS, ...(input.revisions || {}) });
    return Object.freeze({
      revision: Number(input.revision || buildCount),
      revisions,
      country: Object.freeze({ ...(input.country || {}) }),
      physical: Object.freeze({ ...(input.physical || {}) }),
      quality: Object.freeze({ ...(input.renderQuality || input.quality || {}) }),
      polygons: Object.freeze(polygons),
      strokes: Object.freeze(strokes),
      interaction: Object.freeze({
        selectionPacket: input.interaction?.selectionPacket || null,
        genericFillKeys: Object.freeze([...(input.interaction?.genericFillKeys || [])].map(String)),
        genericFillItems: Object.freeze([...(input.interaction?.genericFillItems || [])]),
        previewPackets: Object.freeze([...(input.interaction?.previewPackets || [])]),
        draftPackets: Object.freeze([...(input.interaction?.draftPackets || [])]),
      }),
    });
  }

  function patch(previous, input = {}) {
    if (!isRenderScene(previous)) return build(input);
    patchCount += 1;
    const polygonMap = new Map(previous.polygons.map(packet => [String(packet.key), packet]));
    const strokeMap = new Map(previous.strokes.map(packet => [String(packet.key), packet]));
    const sources = new Map();
    for (const key of input.removePolygonKeys || []) polygonMap.delete(String(key));
    for (const key of input.removeStrokeKeys || []) strokeMap.delete(String(key));
    for (const item of input.polygons || []) {
      if (!item?.key || !item?.geometry) continue;
      const packet = polygonPacket(item, input, sources);
      if (packet.triangleCount > 0) polygonMap.set(String(packet.key), packet);
      else polygonMap.delete(String(item.key));
    }
    for (const item of input.strokes || []) {
      if (!item?.key || !(item?.geometry || item?.startsEnds)) continue;
      const packet = strokePacket(item, input, sources);
      if (packet.segmentCount > 0) strokeMap.set(String(packet.key), packet);
      else strokeMap.delete(String(item.key));
    }
    const revisions = Object.freeze({ ...previous.revisions, ...(input.revisions || {}) });
    const interactionInput = input.interaction || previous.interaction;
    return Object.freeze({
      revision: Number(input.revision || previous.revision + 1),
      revisions,
      country: Object.freeze({ ...previous.country, ...(input.country || {}) }),
      physical: Object.freeze({ ...previous.physical, ...(input.physical || {}) }),
      quality: Object.freeze({ ...previous.quality, ...(input.renderQuality || input.quality || {}) }),
      polygons: Object.freeze([...polygonMap.values()].sort((left, right) => left.order - right.order)),
      strokes: Object.freeze([...strokeMap.values()].sort((left, right) => left.order - right.order)),
      interaction: Object.freeze({
        selectionPacket: interactionInput?.selectionPacket || null,
        genericFillKeys: Object.freeze([...(interactionInput?.genericFillKeys || [])].map(String)),
        genericFillItems: Object.freeze([...(interactionInput?.genericFillItems || [])]),
        previewPackets: Object.freeze([...(interactionInput?.previewPackets || [])]),
        draftPackets: Object.freeze([...(interactionInput?.draftPackets || [])]),
      }),
    });
  }

  function invalidateGeometry(key) {
    const needle = `:${String(key || '')}:`;
    for (const cache of [polygonCache, strokeCache]) {
      for (const entryKey of [...cache.keys()]) if (entryKey.includes(needle)) deleteCacheEntry(cache, entryKey);
    }
  }

  function missingPolygons(items, input = {}) {
    return items.filter(item => item?.key && isPolygonGeometry(item?.geometry)).map(item => {
      const context = packetContext(item, input);
      return { cacheKey: packetKey(item, 'polygon', context.lod, context.projection), geometry: item.geometry,
        projection: context.projection, lod: context.lod, lodPolicy: item.lodPolicy || 'exact' };
    }).filter(item => !polygonCache.has(item.cacheKey) && !prepared.has(item.cacheKey));
  }

  async function preparePolygons(items, input = {}) {
    const missing = missingPolygons(items, input);
    if (!missing.length) return;
    if (!meshJobs) throw new TypeError('GPU mesh Worker owner is required.');
    const revision = ++preparationRevision;
    const bySource = new Map();
    for (const item of missing) {
      const source = `${geometryRevisionKey(item.geometry)}:${item.lod}:${item.projection}:${item.lodPolicy}`;
      if (!bySource.has(source)) bySource.set(source, { request: item, keys: [] });
      bySource.get(source).keys.push(item.cacheKey);
    }
    const groups = [...bySource.values()];
    const aliases = new Map(groups.map(value => [value.request.cacheKey, value.keys]));
    const result = await meshJobs.preparePolygons(groups.map(value => value.request), revision);
    if (revision !== preparationRevision) return;
    prepared.clear();
    for (const { cacheKey, packet } of result.packets) {
      for (const key of aliases.get(cacheKey) || []) prepared.set(key, packet);
    }
  }

  return Object.freeze({
    build,
    patch,
    missingPolygons,
    preparePolygons,
    releasePrepared: () => prepared.clear(),
    cancelPreparation: () => { preparationRevision += 1; prepared.clear(); meshJobs?.cancelAll('superseded'); },
    invalidateGeometry,
    setCacheByteBudget: value => {
      cacheBudgetBytes = Math.max(1, Number(value) || 1);
      trimCaches();
      return cacheBudgetBytes;
    },
    clear: () => {
      preparationRevision += 1; prepared.clear(); meshJobs?.cancelAll('scene-reset');
      polygonCache.clear(); strokeCache.clear();
      polygonCacheBytes = 0; strokeCacheBytes = 0;
    },
    stats: () => Object.freeze({
      buildCount,
      patchCount,
      polygonCacheSize: polygonCache.size,
      strokeCacheSize: strokeCache.size,
      polygonCacheHits,
      polygonCacheMisses,
      strokeCacheHits,
      strokeCacheMisses,
      triangulationMs,
      cacheBudgetBytes,
      cacheBytes: polygonCacheBytes + strokeCacheBytes,
      polygonCacheBytes,
      strokeCacheBytes,
      cacheEvictionCount,
    }),
  });
}

export function isRenderScene(value) {
  return !!value && Number.isFinite(Number(value.revision))
    && Array.isArray(value.polygons) && Array.isArray(value.strokes)
    && !!value.revisions && !!value.interaction;
}
