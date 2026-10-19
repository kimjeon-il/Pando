import { createRenderableBoundarySegmentView, buildRefinedBoundarySegments } from './geographic-boundary.js';
import './polygon-geometry.js';
import { createBoundarySpatialIndex, segmentBounds, padBoundaryBounds } from './boundary-spatial-index.js';
import { countryGeometrySignature } from './country-shared-boundary-cache.js';
import { territorialRootId } from './territorial-units.js';
import { sharedCalculationCore } from './temporal.js';
import { computeCountrySharedContacts } from './country-contact-core.js';
import { multiCoordinates } from './map-edit-geometry.js';

for (const capability of ['boundaryOpposingInteriors', 'boundaryOpposingInteriorsBatch', 'boundaryEdgeBoxesBatch']) {
  if (typeof sharedCalculationCore?.[capability] !== 'function') {
    throw Object.assign(new Error('Shared C++ boundary contact capability unavailable: ' + capability),
      { code: 'PL-CORE-WASM-CAPABILITY' });
  }
}

const { sphericalSignedAreas } = globalThis.PandoLabPolygonGeometry;
const cloneCoordinate = coordinate => [Number(coordinate[0]), Number(coordinate[1])];

function quantized(value, precision) {
  const factor = 10 ** precision;
  return Math.round(Number(value) * factor) / factor;
}

export function topologyNodeKey(coordinate, precision = 7) {
  return `${quantized(coordinate[0], precision)},${quantized(coordinate[1], precision)}`;
}

function segmentKey(a, b, precision) {
  const left = topologyNodeKey(a, precision);
  const right = topologyNodeKey(b, precision);
  return left < right ? `${left}|${right}` : `${right}|${left}`;
}

function polygonRings(feature) {
  if (feature?.geometry?.type === 'Polygon') return [{ polygonIndex: 0, rings: feature.geometry.coordinates || [] }];
  if (feature?.geometry?.type === 'MultiPolygon') return (feature.geometry.coordinates || []).map((rings, polygonIndex) => ({ polygonIndex, rings }));
  return [];
}

function featureId(feature, index = 0) {
  return String(feature?.id || index);
}

export function boundarySourceSegments(feature, fallbackId = 0, { compactPrepared = false } = {}) {
  const rows = [];
  const id = featureId(feature, fallbackId);
  for (const polygon of polygonRings(feature)) {
    const rings = polygon.rings || [];
    // Preserve the historical skip for empty/one-point rings, while using
    // one crossing into the shared C++ integral for all remaining rings.
    const calculable = rings.filter(ring => ring.length > 1);
    const areas = calculable.length ? sphericalSignedAreas(calculable) : [];
    let areaIndex = 0;
    rings.forEach((ring, ringIndex) => {
      const limit = Math.max(0, ring.length - 1);
      if (!limit) return;
      let area = areas[areaIndex++];
      // The common spherical integral may include a full turn around a pole.
      // Use its signed smaller region, without offsetting ordinary tiny areas.
      if (area > 2 * Math.PI) area -= 4 * Math.PI;
      else if (area < -2 * Math.PI) area += 4 * Math.PI;
      // Spherical winding has the opposite sign to the former planar area.
      const interiorSide = -Math.sign(area) * (ringIndex ? -1 : 1);
      // The long-lived shared-boundary Worker only needs one copy of the
      // country/ring/winding metadata. Keep immutable per-edge identities and
      // original coordinate ARRAY references in ordinary JS objects.
      // Editing-domain callers still receive their original complete records.
      // Keep inherited fields visible through property reads; consumers that
      // persist a contact ref must snapshot those fields into own properties.
      const shared = compactPrepared
        ? { featureId: id, polygonIndex: polygon.polygonIndex, ringIndex, interiorSide } : null;
      for (let index = 0; index < limit; index++) {
        if (!shared) {
          rows.push({ featureId: id, polygonIndex: polygon.polygonIndex, ringIndex,
            segmentIndex: index, endVertexIndex: (index + 1) % limit,
            a: ring[index], b: ring[index + 1], interiorSide });
          continue;
        }
        const row = Object.create(shared);
        row.segmentIndex = index;
        row.endVertexIndex = (index + 1) % limit;
        row.a = ring[index];
        row.b = ring[index + 1];
        rows.push(row);
      }
    });
  }
  return rows;
}

export function prepareBoundaryFeature(feature) {
  const segments = boundarySourceSegments(feature, 0, { compactPrepared: true });
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  const spatialIndex = createBoundarySpatialIndex();
  const boxes = segments.length
    ? sharedCalculationCore.boundaryEdgeBoxesBatch(segments.map(({ a, b }) => [a, b])) : [];
  for (const rowBoxes of boxes) for (const box of rowBoxes) for (let axis = 0; axis < 2; axis++) {
    bounds[axis] = Math.min(bounds[axis], box[axis]);
    bounds[axis + 2] = Math.max(bounds[axis + 2], box[axis + 2]);
  }
  // Source segments belong to this immutable geometry revision. Bulk-loading
  // removes per-edge JS Map/Set/key retention while preserving ordered source refs.
  spatialIndex.loadPacked(segments, boxes);
  return { id: String(feature.id), feature, geometry: feature.geometry, segments, bounds, spatialIndex,
    renderableSegments: createRenderableBoundarySegmentView(feature.geometry) };
}

/** The Worker owns this derived index; only a changed geometry is prepared. */
export function createPreparedBoundaryStore() {
  const byId = new Map(), spatialIndex = createBoundarySpatialIndex();
  let preparationCount = 0;
  function put(feature) {
    const id = String(feature.id), previous = byId.get(id);
    // Caller keys include geometry identity and revision. A bare revision such
    // as 0 is insufficient when a timeline replaces one geometry with another.
    if (feature.boundaryGeometryRevision !== undefined && typeof feature.boundaryGeometryRevision !== 'string')
      throw new Error('Boundary geometry revision must include geometry identity and mutable revision');
    const key = feature.boundaryGeometryRevision !== undefined
      ? `identity:${feature.boundaryGeometryRevision}` : `digest:${countryGeometrySignature(feature)}`;
    if (previous?.geometryKey === key) {
      previous.feature = feature;
      return false;
    }
    const prepared = { ...prepareBoundaryFeature(feature), geometryKey: key };
    byId.set(id, prepared);
    spatialIndex.remove(id);
    if (prepared.segments.length) spatialIndex.insert(id, prepared, prepared.bounds);
    preparationCount++;
    return true;
  }
  function patch(features = [], removedIds = []) {
    const changed = new Set();
    for (const value of removedIds) {
      const id = String(value);
      if (byId.delete(id)) changed.add(id);
      spatialIndex.remove(id);
    }
    for (const feature of features) if (put(feature)) changed.add(String(feature.id));
    return changed;
  }
  function replace(features = []) {
    const ids = new Set(features.map(feature => String(feature.id)));
    return patch(features, [...byId.keys()].filter(id => !ids.has(id)));
  }
  return { patch, replace, get: id => byId.get(String(id)), values: () => [...byId.values()],
    nearby: bounds => spatialIndex.query(padBoundaryBounds(bounds)), stats: () => ({ preparationCount }) };
}

export function buildBoundaryTopology(features = [], options = {}) {
  return buildBoundaryTopologyFromSegments(features.flatMap(boundarySourceSegments), options);
}

// The existing source-ref objects and Worker cache remain JS-owned.
// C++ now produces source-contact candidates, shared segments and seam pieces.
export function buildCountrySharedBoundaryContact(left, right) {
  return computeCountrySharedContacts([[left, right]])[0];
}

// Worker source identities remain JS-owned after C++ contact discovery.
// Both static cache assembly and incremental patches must merge the same refs
// without duplicating owner/reference union logic or mutating input rows.
export function mergeSharedBoundaryContributions(segments) {
  if (!segments.length) return null;
  if (segments.length === 1) return segments[0];
  const refs = [];
  for (const segment of segments) for (const ref of segment.refs) {
    if (!refs.some(other => other.featureId === ref.featureId
      && other.polygonIndex === ref.polygonIndex
      && other.ringIndex === ref.ringIndex && other.segmentIndex === ref.segmentIndex)) refs.push(ref);
  }
  return { ...segments[0], ownerIds: [...new Set(segments.flatMap(segment => segment.ownerIds))].sort(), refs };
}

export function buildCountrySharedBoundarySegments(features = [], { preparedStore } = {}) {
  const store = preparedStore || createPreparedBoundaryStore();
  if (!preparedStore) store.replace(features);
  const rows = features.map(feature => store.get(feature.id));
  const order = new Map(rows.map((row, index) => [row.id, index]));
  const pairs = [];
  for (let leftIndex = 0; leftIndex < rows.length; leftIndex++) {
    const left = rows[leftIndex];
    if (!left.segments.length) continue;
    const nearby = store.nearby(left.bounds).filter(right => order.get(right.id) > leftIndex)
      .sort((a, b) => order.get(a.id) - order.get(b.id));
    for (const right of nearby) pairs.push([left, right]);
  }
  const shared = new Map();
  for (const segments of computeCountrySharedContacts(pairs))
    for (const segment of segments) {
      const key = segmentKey(segment.start, segment.end, 7);
      const previous = shared.get(key);
      shared.set(key, previous ? mergeSharedBoundaryContributions([previous, segment]) : segment);
    }
  return [...shared.values()];
}

// Static cache and rendering packets store coordinates/owners; live source refs
// are attached once by the Worker and never cloned into every render packet.
export function serializeCountrySharedBoundarySegments(segments) {
  return segments.map(({ start, end, ownerIds }) => ({ start, end, ownerIds }));
}

export function attachBoundarySegmentReferences(segment, preparedStore) {
  if (segment.refs) return segment;
  const refs = [];
  for (const id of segment.ownerIds) {
    const prepared = preparedStore.get(id);
    if (!prepared) throw new Error(`공유 경계의 원본 객체가 없습니다: ${id}`);
    const candidates = prepared.spatialIndex.query(padBoundaryBounds(segmentBounds({ a: segment.start, b: segment.end })));
    const splits = candidates.length ? sharedCalculationCore.boundarySplitCandidatesBatch(
      candidates.map(({ a, b }) => [a, b]), [segment.start, segment.end], 1e-7) : [];
    const edge = candidates.find((_, index) => splits[index].some(([node]) => node === 0)
      && splits[index].some(([node]) => node === 1));
    if (!edge) throw new Error(`공유 경계의 원본 구간이 없습니다: ${id}`);
    refs.push(edge);
  }
  return { ...segment, refs };
}

// Topology snapshots must include inherited ring metadata, while preserving
// all custom own fields of edit-time source rows (id, bounds, etc.).
function snapshotSourceRow(row) {
  const own = { ...row };
  if (!Object.hasOwn(row, 'featureId')) {
    own.featureId = row.featureId;
    own.polygonIndex = row.polygonIndex;
    own.ringIndex = row.ringIndex;
    own.interiorSide = row.interiorSide;
  }
  return own;
}

export function buildBoundaryTopologyFromSegments(rawSegments, { precision = 7, epsilon = 1e-7 } = {}) {
  const nodes = new Map();
  for (const raw of rawSegments) {
    for (const [coordinate, vertexIndex] of [[raw.a, raw.segmentIndex], [raw.b, raw.endVertexIndex]]) {
      const key = topologyNodeKey(coordinate, precision);
      if (!nodes.has(key)) nodes.set(key, { key, coordinate: cloneCoordinate(coordinate), ownerIds: new Set(), refs: [], virtualRefs: [] });
      const node = nodes.get(key);
      node.ownerIds.add(raw.featureId);
      if (!node.refs.some(ref => ref.featureId === raw.featureId && ref.polygonIndex === raw.polygonIndex
        && ref.ringIndex === raw.ringIndex && ref.vertexIndex === vertexIndex)) node.refs.push({
        featureId: raw.featureId, polygonIndex: raw.polygonIndex, ringIndex: raw.ringIndex, vertexIndex,
      });
    }
  }

  const nodeValues = [...nodes.values()];
  // One compiled C++ crossing owns geographic node buckets, epsilon
  // projections and stable split ordering. JS retains edit references and
  // object-key Map identities, not a second arithmetic implementation.
  const splitRows = rawSegments.length
    ? sharedCalculationCore.boundarySplitCandidatesBatch(
      rawSegments.map(({ a, b }) => [a, b]), nodeValues.map(node => node.coordinate), epsilon) : [];
  if (!Array.isArray(splitRows) || splitRows.length !== rawSegments.length
    || splitRows.some(row => !Array.isArray(row))) {
    throw Object.assign(new Error('Incomplete compiled boundary topology split result.'),
      { code: 'PL-BOUNDARY-SPLIT' });
  }
  const segments = new Map();
  for (const [rawIndex, raw] of rawSegments.entries()) {
    const split = splitRows[rawIndex].map(([nodeIndex, t]) => ({ node: nodeValues[nodeIndex], t }));
    for (const item of split) {
      item.node.ownerIds.add(raw.featureId);
      if (item.t > epsilon && item.t < 1 - epsilon && !item.node.virtualRefs.some(ref => ref.featureId === raw.featureId
        && ref.polygonIndex === raw.polygonIndex && ref.ringIndex === raw.ringIndex && ref.segmentIndex === raw.segmentIndex)) {
        item.node.virtualRefs.push({
          featureId: raw.featureId,
          polygonIndex: raw.polygonIndex,
          ringIndex: raw.ringIndex,
          segmentIndex: raw.segmentIndex,
          t: item.t,
        });
      }
    }
    for (let index = 1; index < split.length; index += 1) {
      const start = split[index - 1];
      const end = split[index];
      if (end.t - start.t <= epsilon) continue;
      const key = segmentKey(start.node.coordinate, end.node.coordinate, precision);
      if (!segments.has(key)) segments.set(key, {
        key,
        a: cloneCoordinate(start.node.coordinate),
        b: cloneCoordinate(end.node.coordinate),
        ownerIds: new Set(),
        refs: [],
      });
      const segment = segments.get(key);
      segment.ownerIds.add(raw.featureId);
      segment.refs.push({ ...snapshotSourceRow(raw), startT: start.t, endT: end.t });
    }
  }

  for (const node of nodes.values()) node.kind = node.ownerIds.size >= 3 ? 'multi-owner' : node.ownerIds.size === 2 ? 'shared' : 'coast';
  for (const segment of segments.values()) segment.kind = segment.ownerIds.size >= 2 ? 'shared' : 'coast';
  return { precision, epsilon, nodes, segments };
}

function ringForRef(feature, ref) {
  if (feature?.geometry?.type === 'Polygon') return feature.geometry.coordinates?.[ref.ringIndex] || null;
  return feature?.geometry?.coordinates?.[ref.polygonIndex]?.[ref.ringIndex] || null;
}

export function moveTopologyNodes(featureMap, moves, { precision = 7 } = {}) {
  const replacements = new Map(moves.map(({node,coordinate}) => [topologyNodeKey(node.coordinate,precision),coordinate]));
  const virtualByRing = new Map();
  for (const {node} of moves) for (const ref of node.virtualRefs || []) {
    const key = JSON.stringify([ref.featureId,ref.polygonIndex,ref.ringIndex]);
    if (!virtualByRing.has(key)) virtualByRing.set(key,[]);
    virtualByRing.get(key).push({...ref,coordinate:node.coordinate});
  }
  for (const refs of virtualByRing.values()) {
    refs.sort((a,b)=>b.segmentIndex-a.segmentIndex || b.t-a.t);
    const ring=ringForRef(featureMap.get(String(refs[0].featureId)),refs[0]);
    if (!ring) throw new Error('Missing boundary owner ring');
    const existing=new Set(ring.map(p=>topologyNodeKey(p,precision)));
    for(const ref of refs) {
      const key=topologyNodeKey(ref.coordinate,precision);
      if(!existing.has(key)){ring.splice(ref.segmentIndex+1,0,cloneCoordinate(ref.coordinate));existing.add(key);}
    }
  }
  const changed=new Set();
  for(const [id,feature] of featureMap) for(const polygon of polygonRings(feature)) for(const ring of polygon.rings || []) {
    for(let i=0;i<ring.length;i++) {
      const next=replacements.get(topologyNodeKey(ring[i],precision));
      if(next){ring[i]=cloneCoordinate(next);changed.add(id);}
    }
  }
  return changed;
}

function selectedTopologySegmentKeys(topology, predicate) {
  const keys = new Set();
  for (const segment of topology?.segments?.values?.() || []) {
    if (predicate(segment)) keys.add(segment.key);
  }
  return keys;
}

function endpointNodeKeys(topology, segmentKeys) {
  const keys = new Set();
  for (const key of segmentKeys) {
    const segment = topology?.segments?.get?.(key);
    if (!segment) continue;
    keys.add(topologyNodeKey(segment.a, topology.precision));
    keys.add(topologyNodeKey(segment.b, topology.precision));
  }
  return keys;
}

export function planSharedBoundaryEdit(topology, selectedCountryIds = []) {
  const selectedIds = [...new Set(selectedCountryIds.map(String).filter(Boolean))];
  const selected = new Set(selectedIds);
  const segmentKeys = selectedTopologySegmentKeys(topology, segment => segment.kind === 'shared'
    && segment.ownerIds.size >= 2
    && [...segment.ownerIds].every(ownerId => selected.has(String(ownerId))));
  const nodeKeys = endpointNodeKeys(topology, segmentKeys);
  const editableNodeKeys = new Set();
  const fixedNodeKeys = new Set();
  const participantIds = new Set();

  for (const key of segmentKeys) {
    for (const ownerId of topology.segments.get(key)?.ownerIds || []) participantIds.add(String(ownerId));
  }
  for (const key of nodeKeys) {
    const node = topology?.nodes?.get?.(key);
    const editable = node?.ownerIds?.size >= 2 && [...node.ownerIds].every(ownerId => selected.has(String(ownerId)));
    (editable ? editableNodeKeys : fixedNodeKeys).add(key);
  }

  const isolatedIds = selectedIds.filter(id => !participantIds.has(id));
  return {
    selectedIds,
    segmentKeys,
    editableNodeKeys,
    fixedNodeKeys,
    participantIds,
    isolatedIds,
    valid: selectedIds.length >= 2 && segmentKeys.size > 0 && isolatedIds.length === 0,
  };
}

export function planCoastEdit(topology, countryId) {
  const ownerId = String(countryId || '');
  const segmentKeys = selectedTopologySegmentKeys(topology, segment => segment.kind === 'coast'
    && segment.ownerIds.size === 1
    && segment.ownerIds.has(ownerId));
  const nodeKeys = endpointNodeKeys(topology, segmentKeys);
  const editableNodeKeys = new Set();
  const fixedNodeKeys = new Set();
  for (const key of nodeKeys) {
    const node = topology?.nodes?.get?.(key);
    const editable = node?.kind === 'coast' && node.ownerIds.size === 1 && node.ownerIds.has(ownerId);
    (editable ? editableNodeKeys : fixedNodeKeys).add(key);
  }
  return { countryId: ownerId, segmentKeys, editableNodeKeys, fixedNodeKeys };
}

function topologyFeature(feature, prefix, index) {
  const id = featureId(feature, index);
  return {
    ...feature,
    id: `${prefix}:${id}`,
  };
}

function pointSegmentDistance(point, a, b) {
  const dx = Number(b[0]) - Number(a[0]);
  const dy = Number(b[1]) - Number(a[1]);
  const length2 = dx * dx + dy * dy;
  if (!length2) return Math.hypot(Number(point[0]) - Number(a[0]), Number(point[1]) - Number(a[1]));
  const t = Math.max(0, Math.min(1, ((Number(point[0]) - Number(a[0])) * dx + (Number(point[1]) - Number(a[1])) * dy) / length2));
  return Math.hypot(Number(point[0]) - (Number(a[0]) + dx * t), Number(point[1]) - (Number(a[1]) + dy * t));
}

// Keep source-reference selection in JavaScript; shared C++ alone owns the
// signed interior/direction calculation. Inputs are untouched source edges,
// not seam-split or refined display strokes.
export function boundaryInteriorComparison(segment, ownerIds = segment.ownerIds) {
  const refs = ownerIds.map(id => {
    const edge = segment.refs?.find(ref => String(ref.featureId) === String(id));
    if (!edge) throw new Error('공유 경계의 원본 구간이 없습니다: ' + id);
    return [edge.a, edge.b, edge.interiorSide];
  });
  return [[segment.start, segment.end], refs];
}

export function hasOpposingBoundaryInteriors(segment, ownerIds = segment.ownerIds) {
  return sharedCalculationCore.boundaryOpposingInteriors(...boundaryInteriorComparison(segment, ownerIds));
}

export function buildTerritorialInternalBoundarySegments(countries = [], units = [], { precision = 7, epsilon = 1e-7 } = {}) {
  // No unit can own an internal boundary: do not even inspect country geometry.
  if (!(units || []).some(feature => ['Polygon', 'MultiPolygon'].includes(feature?.geometry?.type))) return [];
  const rootIds = new Set((countries || [])
    .filter(feature => feature?.geometry?.type === 'Polygon' || feature?.geometry?.type === 'MultiPolygon')
    .map((feature, index) => featureId(feature, index)));
  const unitFeatures = (units || [])
    .filter(feature => feature?.geometry?.type === 'Polygon' || feature?.geometry?.type === 'MultiPolygon')
    .map((feature, index) => topologyFeature(feature, 'unit', index));
  const entities = new Map([...countries, ...units].map(feature => [String(feature.id), feature]));
  const unitMeta = new Map(unitFeatures.map(feature => [feature.id, {
    id: featureId(feature).replace(/^unit:/, ''),
    entityKind: feature.properties?.entityKind || '',
    rootId: territorialRootId(entities.get(featureId(feature).replace(/^unit:/, '')), id => entities.get(id)),
  }]));
  // A root's editable polygon may exclude its children (including islands).
  // Only the exterior of the complete general hierarchy is a coast; using the
  // root polygon alone hid land contacts and painted child coastlines dashed.
  // Derive the exclusion geometry with the shared polygon kernel, without
  // replacing canonical entity geometry or including independent regions.
  const countryFeatures = (countries || [])
    .filter(feature => rootIds.has(String(feature.id)))
    .map((feature, index) => {
      const members = unitFeatures.filter(unit => {
        const meta = unitMeta.get(unit.id);
        return meta.entityKind === 'general' && meta.rootId === String(feature.id);
      });
      const geometry = members.length ? { type: 'MultiPolygon', coordinates: sharedCalculationCore.polygonOperation('union',
        [feature, ...members].map(item => multiCoordinates(item.geometry)), false) } : feature.geometry;
      return topologyFeature({ ...feature, geometry }, 'country', index);
    });
  const topology = buildBoundaryTopology([...countryFeatures, ...unitFeatures], { precision, epsilon });
  const countryEdges = [...topology.segments.values()].filter(segment => [...segment.ownerIds].some(ownerId => ownerId.startsWith('country:')));
  const boundaryTolerance = Math.max(1e-4, epsilon * 1000);
  const bucketSize = 1;
  const countryBuckets = new Map();
  const bucketKey = (x, y) => `${x}:${y}`;
  for (const edge of countryEdges) {
    const minX = Math.floor(Math.min(edge.a[0], edge.b[0]) / bucketSize);
    const maxX = Math.floor(Math.max(edge.a[0], edge.b[0]) / bucketSize);
    const minY = Math.floor(Math.min(edge.a[1], edge.b[1]) / bucketSize);
    const maxY = Math.floor(Math.max(edge.a[1], edge.b[1]) / bucketSize);
    if ((maxX - minX + 1) * (maxY - minY + 1) > 4096) continue;
    for (let x = minX; x <= maxX; x += 1) for (let y = minY; y <= maxY; y += 1) {
      const key = bucketKey(x, y);
      if (!countryBuckets.has(key)) countryBuckets.set(key, []);
      countryBuckets.get(key).push(edge);
    }
  }
  const nearCountryExterior = segment => {
    const minX = Math.floor((Math.min(segment.a[0], segment.b[0]) - boundaryTolerance) / bucketSize);
    const maxX = Math.floor((Math.max(segment.a[0], segment.b[0]) + boundaryTolerance) / bucketSize);
    const minY = Math.floor((Math.min(segment.a[1], segment.b[1]) - boundaryTolerance) / bucketSize);
    const maxY = Math.floor((Math.max(segment.a[1], segment.b[1]) + boundaryTolerance) / bucketSize);
    const candidates = [];
    const seen = new Set();
    for (let x = minX; x <= maxX; x += 1) for (let y = minY; y <= maxY; y += 1) {
      for (const edge of countryBuckets.get(bucketKey(x, y)) || []) {
        if (seen.has(edge.key)) continue;
        seen.add(edge.key);
        candidates.push(edge);
      }
    }
    return candidates.some(edge => pointSegmentDistance(segment.a, edge.a, edge.b) <= boundaryTolerance
      && pointSegmentDistance(segment.b, edge.a, edge.b) <= boundaryTolerance);
  };
  const output = [];
  for (const segment of topology.segments.values()) {
    const unitOwners = [...segment.ownerIds].filter(ownerId => ownerId.startsWith('unit:'));
    if (!unitOwners.length || [...segment.ownerIds].some(ownerId => ownerId.startsWith('country:')) || nearCountryExterior(segment)) continue;
    const metadata = unitOwners.map(ownerId => unitMeta.get(ownerId)).filter(Boolean);
    if (!metadata.length) continue;
    const validRootIds = new Set(metadata
      .map(item => item.rootId)
      .filter(rootId => rootId && rootIds.has(rootId)));
    if (validRootIds.size > 1) continue;
    const allRootsValid = metadata.every(item => item.rootId && rootIds.has(item.rootId));
    const sameRootChildren = metadata.every(item => item.entityKind === 'general')
      && allRootsValid
      && validRootIds.size === 1;
    const styleType = metadata.some(item => item.entityKind === 'regional')
      ? 'region'
      : sameRootChildren ? 'subunit-internal' : 'subunit';
    // Preserve editable source segments for classification. Only the
    // accepted, visible edges become refined display geometry.
    const pieces = buildRefinedBoundarySegments({ type: 'LineString', coordinates: [segment.a, segment.b] });
    const displayOwners = metadata.map(item => ({ id: item.id, entityKind: item.entityKind, rootId: item.rootId }));
    pieces.forEach(([a, b], index) => output.push({
      key: `${segment.key}:${index}`,
      a, b, unitOwners: displayOwners, styleType,
    }));
  }
  return output;
}
