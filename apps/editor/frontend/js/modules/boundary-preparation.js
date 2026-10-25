import { prepareBoundaryDisplay } from './boundary-display.js';
import { boundarySourceSegments, buildBoundaryTopologyFromSegments, planSharedBoundaryEdit, planCoastEdit, moveTopologyNodes, topologyNodeKey } from "../../../../../shared/frontend/js/modules/boundary-topology.js";
import { createBoundarySpatialIndex, segmentBounds } from "../../../../../shared/frontend/js/modules/boundary-spatial-index.js";

const locked = feature => !!(feature.boundaryLocked ?? feature.properties?.locked);
const metadata = feature => JSON.stringify([feature.properties?.entityKind, feature.properties?.parentId, undefined, locked(feature)]);
const padded = bounds => {
  // pointOnSegment also allows an epsilon of the segment parameter at its ends.
  const margin = 1e-7 * (1 + Math.hypot(bounds[2] - bounds[0], bounds[3] - bounds[1]));
  return [bounds[0] - margin, bounds[1] - margin, bounds[2] + margin, bounds[3] + margin];
};

// A ring envelope includes every source segment (including dateline-crossing
// edges). It is only a conservative broad phase: exact contacts and splits
// remain owned by the existing C++ topology calculation.
function geometryRingBounds(geometry) {
  const polygons = geometry?.type === 'Polygon' ? [geometry.coordinates]
    : geometry?.type === 'MultiPolygon' ? geometry.coordinates : [];
  const boxes = [];
  for (const rings of polygons || []) for (const ring of rings || []) {
    let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
    for (const point of ring || []) {
      const x = point?.[0], y = point?.[1];
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      west = Math.min(west, x); east = Math.max(east, x);
      south = Math.min(south, y); north = Math.max(north, y);
    }
    if (west <= east && south <= north) boxes.push([west, south, east, north]);
  }
  return boxes;
}

// Conservative accounting of retained JS collections, not actual V8 heap bytes.
// One oversize active preparation remains usable; older preparations are evicted.
export const BOUNDARY_PREPARATION_CACHE_BUDGET_BYTES = 32 * 1024 * 1024;
const MAX_CACHED_PREPARATIONS = 8;
const estimateCacheEntryBytes = entry => entry.topology.nodes.size * 240
  + entry.topology.segments.size * 320 + entry.targetRowCount * 176
  + (entry.handles?.length || 0) * 256 + (entry.segments?.length || 0) * 176;

export function createBoundaryPreparation({ cacheBudgetBytes = BOUNDARY_PREPARATION_CACHE_BUDGET_BYTES } = {}) {
  if (!Number.isSafeInteger(cacheBudgetBytes) || cacheBudgetBytes < 1)
    throw new TypeError('Boundary cache budget must be a positive safe integer.');
  const sources = new Map();
  // Only ring envelopes are indexed at first edit. Unrelated world geometry
  // must not materialize thousands of segment objects and grid entries.
  const featureIndex = createBoundarySpatialIndex();
  const cache = new Map();
  let evictions = 0;
  const estimatedCacheBytes = () => [...cache.values()].reduce((sum, entry) => sum + estimateCacheEntryBytes(entry), 0);
  function retainCacheEntry(entry) {
    cache.delete(entry.key);
    cache.set(entry.key, entry);
    // Keep this entry valid for the active edit, even if it alone exceeds the
    // budget. Reclaim previous heavy topologies and their detached source rows.
    while (cache.size > 1 && (cache.size > MAX_CACHED_PREPARATIONS || estimatedCacheBytes() > cacheBudgetBytes)) {
      cache.delete(cache.keys().next().value);
      evictions++;
    }
    const retained = new Set([...cache.values()].flatMap(row => [...row.dependencies]));
    for (const [id, source] of sources) if (source.rows && !retained.has(id)) source.rows = null;
  }
  let sequence = 0;
  const namespace = globalThis.crypto?.randomUUID?.() || `${Date.now()}:${Math.random()}`;

  async function sync(features, checkpoint = async () => {}) {
    const incoming = new Map(features.map(feature => [String(feature.id), feature]));
    const changed = new Set();
    const dirty = [];
    try {
      for (const [id, previous] of sources) {
        const feature = incoming.get(id);
        if (feature?.geometry === previous.feature.geometry && metadata(feature) === previous.metadata) continue;
        changed.add(id);
        dirty.push(...previous.boxes);
        featureIndex.remove(id);
        sources.delete(id);
      }
      for (const [id, feature] of incoming) {
        if (sources.has(id)) continue;
        await checkpoint();
        changed.add(id);
        const boxes = geometryRingBounds(feature.geometry);
        sources.set(id, { feature, boxes, rows: null, metadata: metadata(feature) });
        dirty.push(...boxes);
        if (boxes.length) featureIndex.insert(id, id, boxes);
      }
    } finally {
      if (changed.size) for (const [key, entry] of cache) {
        if ([...changed].some(id => entry.dependencies.has(id)) || dirty.some(bounds => entry.targetIndex.query(padded(bounds)).length)) cache.delete(key);
      }
    }
  }

  function sourceRows(id) {
    const source = sources.get(id);
    if (!source) return [];
    if (!source.rows) source.rows = boundarySourceSegments(source.feature)
      .map((row, index) => ({ ...row, id: `${id}:${index}`, bounds: segmentBounds(row) }));
    return source.rows;
  }

  async function prepare({ targetIds, mode, neighborsOnly = false, autoSeedId = null }, checkpoint = async () => {}) {
    const ids = [...new Set(targetIds.map(String))].sort();
    const targets = ids.map(id => sources.get(id)?.feature);
    if (!targets.length || targets.some(feature => !feature)) throw new Error('경계 편집 대상을 찾을 수 없습니다.');
    if (targets.some(feature => locked(feature))) throw new Error('잠긴 객체의 경계를 편집할 수 없습니다.');
    const unit = targets.find(feature => (feature.properties?.entityKind === 'general' && !!feature.properties?.parentId));
    if (unit && targets.some(feature => !(feature.properties?.entityKind === 'general' && !!feature.properties?.parentId)
      || feature.properties.parentId !== unit.properties.parentId)) throw new Error('같은 상위 단위 안의 하위단위만 편집할 수 있습니다.');
    const parentId = unit ? String(unit.properties.parentId) : null;
    if (unit && !sources.has(parentId)) throw new Error('상위 단위를 찾을 수 없습니다.');
    for (const target of targets) {
      let ancestor = target;
      const visited = new Set();
      while (ancestor?.properties?.parentId) {
        const id = String(ancestor.properties.parentId);
        if (visited.has(id)) throw new Error('상위 단위 관계가 순환합니다.');
        visited.add(id);
        ancestor = sources.get(id)?.feature;
        if (!ancestor) throw new Error('상위 단위를 찾을 수 없습니다.');
        if (locked(ancestor)) throw new Error('상위 단위가 잠겨 있습니다.');
      }
    }
    const allowed = feature => !!feature && (unit ? (feature.properties?.entityKind === 'general' && !!feature.properties?.parentId)
      && feature.properties.parentId === unit.properties.parentId
      : !(feature.properties?.entityKind === 'general' && !!feature.properties?.parentId) && !(feature.properties?.entityKind === 'regional'));
    const key = JSON.stringify([mode, ids, parentId, autoSeedId]);
    let entry = cache.get(key);
    if (entry) {
      cache.delete(key);
      cache.set(key, entry);
    }
    if (!entry) {
      const selected = new Set(ids);
      const rows = new Map();
      const targetIndex = createBoundarySpatialIndex();
      // Build only the selected edges first. The target segment index then
      // tests candidate edges directly, avoiding a second world-wide index.
      const candidateIds = new Set();
      for (const id of ids) {
        const source = sources.get(id);
        for (const bounds of source.boxes) {
          for (const candidateId of featureIndex.query(padded(bounds))) candidateIds.add(candidateId);
        }
        for (const row of sourceRows(id)) {
          await checkpoint();
          rows.set(row.id, row);
          targetIndex.insert(row.id, row, padded(row.bounds));
        }
      }
      // Ring envelopes may return false positives, never false negatives.
      // Restrict their detailed segment materialization to eligible owners;
      // exact C++ topology still decides shared/coast segment membership.
      for (const id of candidateIds) {
        if (selected.has(id)) continue;
        const source = sources.get(id);
        const feature = source?.feature;
        if (!allowed(feature) && id !== parentId) continue;
        // A large country's ring envelope can cover remote countries with no
        // nearby coastline. Reject those before reading any candidate edges.
        if (!source.boxes.some(bounds => targetIndex.query(bounds).length)) continue;
        await checkpoint();
        for (const candidate of sourceRows(id)) {
          // Symmetric overlap with the padded target segment reproduces the
          // original per-target-row query without indexing distant segments.
          if (targetIndex.query(candidate.bounds).length) rows.set(candidate.id, candidate);
        }
      }
      // Parent ownership marks its exterior as an unselected/fixed boundary.
      const topology = buildBoundaryTopologyFromSegments([...rows.values()]);
      const neighbors = new Set();
      for (const segment of topology.segments.values()) if (segment.ownerIds.size >= 2 && [...segment.ownerIds].some(id => selected.has(id))) {
        for (const id of segment.ownerIds) if (!selected.has(id) && id !== parentId && allowed(sources.get(id)?.feature)) neighbors.add(id);
      }
      let editableIds = ids;
      if (unit && autoSeedId && selected.has(String(autoSeedId))) {
        const adjacent = new Map(ids.map(id => [id, new Set()]));
        for (const segment of topology.segments.values()) if (segment.ownerIds.size >= 2 && [...segment.ownerIds].every(id => selected.has(id))) {
          for (const a of segment.ownerIds) for (const b of segment.ownerIds) adjacent.get(a).add(b);
        }
        const connected = new Set([String(autoSeedId)]), queue = [...connected];
        for (let i = 0; i < queue.length; i++) for (const id of adjacent.get(queue[i]) || []) if (!connected.has(id)) { connected.add(id); queue.push(id); }
        editableIds = ids.filter(id => connected.has(id));
      }
      const plan = mode === 'coast' ? planCoastEdit(topology, ids[0]) : planSharedBoundaryEdit(topology, editableIds);
      entry = { id: `boundary:${namespace}:${++sequence}`, key, ids: editableIds, mode, topology, plan, neighbors: [...neighbors], handles: null, segments: null,
        dependencies: new Set([...rows.values()].map(row => row.featureId)), targetIndex,
        targetRowCount: [...ids].reduce((sum, id) => sum + sourceRows(id).length, 0) };
      // Cache publication is deferred until the result is completely prepared,
      // so a cancelled calculation never occupies a retained slot.
    }
    if (!neighborsOnly && !entry.handles) {
      // A locked unselected owner always stays fixed; selected locked targets were rejected above.
      const { topology, plan } = entry;
      const selected = new Set(ids);
      const nodeSegments = new Map();
      for (const segment of topology.segments.values()) for (const nodeKey of [
        topologyNodeKey(segment.a), topologyNodeKey(segment.b),
      ]) {
        if (!nodeSegments.has(nodeKey)) nodeSegments.set(nodeKey, []);
        nodeSegments.get(nodeKey).push({ start: segment.a, end: segment.b });
      }
      const handles = [...new Set([...plan.editableNodeKeys, ...plan.fixedNodeKeys])].map(nodeKey => {
        const node = topology.nodes.get(nodeKey);
        const ref = node.refs.find(row => selected.has(row.featureId)) || node.virtualRefs.find(row => selected.has(row.featureId));
        return { key: nodeKey, nodeKey, coordinate: node.coordinate, coord: node.coordinate,
          polygonIndex: ref?.polygonIndex, ringIndex: ref?.ringIndex, index: ref?.vertexIndex,
          refs: node.refs.filter(row => selected.has(row.featureId)),
          virtualRefs: node.virtualRefs.filter(row => selected.has(row.featureId)),
          ownerIds: [...node.ownerIds], boundaryKind: mode === 'coast' ? 'coast' : 'shared',
          fixed: plan.fixedNodeKeys.has(nodeKey), segments: nodeSegments.get(nodeKey) || [] };
      });
      const segments = [...plan.segmentKeys].map(segmentKey => {
        const row = topology.segments.get(segmentKey);
        return { key: row.key, kind: mode === 'coast' ? 'coast' : 'shared', start: row.a, end: row.b,
          geometry: { type: 'LineString', coordinates: [row.a, row.b] } };
      });
      entry.handles = handles;
      entry.segments = segments;
      entry.displayIndex = prepareBoundaryDisplay(handles, segments);
    }
    retainCacheEntry(entry);
    return { preparationId: entry.id, mode, selectedIds: entry.ids, neighbors: entry.neighbors,
      valid: mode === 'coast' ? entry.plan.segmentKeys.size > 0 : entry.plan.valid,
      isolatedIds: entry.plan.isolatedIds || [],
      displayIndex: neighborsOnly ? null : entry.displayIndex,
      handles: neighborsOnly ? [] : entry.handles, segments: neighborsOnly ? [] : entry.segments };
  }

  function move({ preparationId, moves }) {
    const entry = [...cache.values()].find(row => row.id === preparationId);
    if (!entry) throw new Error('경계 준비 결과가 변경되었습니다. 다시 시작하세요.');
    if (!Array.isArray(moves) || !moves.length) throw new Error('이동한 경계점이 없습니다.');
    const resolved=moves.map(({nodeKey,coordinate})=>{
      const node=entry.topology.nodes.get(nodeKey);
      if(!node || !entry.plan.editableNodeKeys.has(nodeKey))throw new Error('고정된 경계점은 이동할 수 없습니다.');
      if(coordinate?.length!==2 || !coordinate.every(Number.isFinite) || Math.abs(coordinate[1])>90)throw new Error('유효하지 않은 위치입니다.');
      return {node,coordinate};
    });
    const ids=new Set(resolved.flatMap(({node})=>[...node.ownerIds]));
    const features=new Map([...ids].map(id=>{
      const source=sources.get(id)?.feature;
      if(!source || locked(source))throw new Error('경계 소유 객체가 없거나 잠겨 있습니다.');
      const {boundaryLocked,...feature}=source;
      return [id,structuredClone(feature)];
    }));
    moveTopologyNodes(features,resolved);
    return {features:[...features.values()],affectedIds:[...features.keys()]};
  }
  function stats() {
    const detailed = [...sources.values()].filter(source => source.rows);
    return Object.freeze({
      sourceCount: sources.size,
      segmentSourceCount: detailed.length,
      segmentCount: detailed.reduce((sum, source) => sum + source.rows.length, 0),
      cachedPreparations: cache.size,
      cachedNodes: [...cache.values()].reduce((sum, row) => sum + row.topology.nodes.size, 0),
      cachedSegments: [...cache.values()].reduce((sum, row) => sum + row.topology.segments.size, 0),
      cachedHandles: [...cache.values()].reduce((sum, row) => sum + (row.handles?.length || 0), 0),
      cacheEstimatedBytes: estimatedCacheBytes(),
      cacheBudgetBytes,
      cacheEvictions: evictions,
    });
  }
  return { sync, prepare, move, stats };
}
