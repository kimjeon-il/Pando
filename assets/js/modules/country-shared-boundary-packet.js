import { buildGpuStrokeInstances } from './gpu-stroke-geometry.js';
import { buildCountrySharedBoundaryContact, boundaryInteriorComparison, createPreparedBoundaryStore,
  attachBoundarySegmentReferences, serializeCountrySharedBoundarySegments, topologyNodeKey } from './boundary-topology.js';
import { createBoundarySpatialIndex, segmentBounds } from './boundary-spatial-index.js';
import { connectBoundarySegments } from './boundary-lines.js';
import { buildRefinedBoundarySegments, MAX_BOUNDARY_EDGE_DEGREES } from './geographic-boundary.js';
import { sharedCalculationCore } from './temporal.js';

export function shouldShowSharedCountryBorders(settings) {
  return settings?.terrainVisible === true && settings?.terrainStyle === 'physical';
}

export function visibleCountrySharedSegments(segments = [], isVisible = () => true) {
  return segments.filter(segment => segment.ownerIds.some(isVisible));
}

const sharedSegmentKey = segment => [topologyNodeKey(segment.start), topologyNodeKey(segment.end)].sort().join('|');
const contactKey = ids => JSON.stringify([...ids].sort());

/** Prepared features and contact adjacency survive Worker patch messages. */
export function createCountrySharedBoundaryState() {
  const preparedStore = createPreparedBoundaryStore();
  const contacts = new Map(), contactsByOwner = new Map(), edges = new Map();
  let contactComputationCount = 0;
  function updateEdge(key) {
    const record = edges.get(key);
    if (!record.contributions.size) { edges.delete(key); return; }
    const segments = [...record.contributions.values()];
    if (segments.length === 1) { record.value = segments[0]; return; }
    const refs = [];
    for (const segment of segments) for (const ref of segment.refs) {
      if (!refs.some(previous => previous.featureId === ref.featureId && previous.polygonIndex === ref.polygonIndex
        && previous.ringIndex === ref.ringIndex && previous.segmentIndex === ref.segmentIndex)) refs.push(ref);
    }
    record.value = { ...segments[0], ownerIds: [...new Set(segments.flatMap(segment => segment.ownerIds))].sort(), refs };
  }
  function removeContact(key) {
    const contact = contacts.get(key);
    if (!contact) return;
    for (const id of contact.ids) {
      const adjacent = contactsByOwner.get(id);
      adjacent.delete(key);
      if (!adjacent.size) contactsByOwner.delete(id);
    }
    for (const segment of contact.segments) {
      const edgeKey = sharedSegmentKey(segment);
      const record = edges.get(edgeKey);
      if (!record) continue;
      record.contributions.delete(key);
      updateEdge(edgeKey);
    }
    contacts.delete(key);
  }
  function addContact(ids, segments) {
    if (!segments.length) return;
    const key = contactKey(ids);
    contacts.set(key, { ids, segments });
    for (const id of ids) {
      if (!contactsByOwner.has(id)) contactsByOwner.set(id, new Set());
      contactsByOwner.get(id).add(key);
    }
    for (const segment of segments) {
      const edgeKey = sharedSegmentKey(segment);
      if (!edges.has(edgeKey)) edges.set(edgeKey, { contributions: new Map(), value: segment });
      edges.get(edgeKey).contributions.set(key, segment);
      updateEdge(edgeKey);
    }
  }
  function reconcile(changed) {
    const obsolete = new Set([...changed].flatMap(id => [...(contactsByOwner.get(id) || [])]));
    for (const key of obsolete) removeContact(key);
    const visited = new Set();
    for (const id of changed) {
      const left = preparedStore.get(id);
      if (!left?.segments.length) continue;
      for (const right of preparedStore.nearby(left.bounds)) {
        if (left.id === right.id) continue;
        const ids = [left.id, right.id].sort(), key = contactKey(ids);
        if (visited.has(key)) continue;
        visited.add(key);
        contactComputationCount++;
        addContact(ids, buildCountrySharedBoundaryContact(left, right));
      }
    }
  }
  function seed(segments, changed) {
    contacts.clear(); contactsByOwner.clear(); edges.clear();
    const pairs = new Map();
    for (const source of segments) {
      const ownerIds = source.ownerIds.filter(id => preparedStore.get(id) && !changed.has(id));
      if (ownerIds.length < 2) continue;
      const segment = attachBoundarySegmentReferences({ ...source, ownerIds,
        ...(source.refs ? { refs: source.refs.filter(ref => ownerIds.includes(String(ref.featureId))) } : {}) }, preparedStore);
      for (let left = 0; left < ownerIds.length; left++) for (let right = left + 1; right < ownerIds.length; right++) {
        const ids = [ownerIds[left], ownerIds[right]].sort(), key = contactKey(ids);
        if (!pairs.has(key)) pairs.set(key, { ids, segments: [] });
        pairs.get(key).segments.push({ ...segment, ownerIds: ids,
          refs: segment.refs.filter(ref => ids.includes(String(ref.featureId))) });
      }
    }
    for (const pair of pairs.values()) addContact(pair.ids, pair.segments);
    reconcile(changed);
  }
  function replace(features, { cachedSegments, changedIds } = {}) {
    const changed = preparedStore.replace(features);
    if (cachedSegments) seed(cachedSegments, changedIds === undefined ? changed : new Set([...changedIds].map(String)));
    else reconcile(changed);
    return changed;
  }
  function patch(features = [], removedIds = []) {
    const changed = preparedStore.patch(features, removedIds);
    reconcile(changed);
    return changed;
  }
  return { preparedStore, replace, patch,
    segments: () => [...edges.values()].map(record => record.value),
    features: () => preparedStore.values().map(prepared => prepared.feature),
    stats: () => ({ ...preparedStore.stats(), contactComputationCount, contactCount: contacts.size }) };
}

// Keep each owner set contiguous so the GPU can apply the same per-country
// visibility rule as Canvas without rebuilding geometry when visibility flips.
export function prepareCountrySharedBoundaryPacket(segments = [], features = [], { preparedStore, maxEdgeDegrees = MAX_BOUNDARY_EDGE_DEGREES } = {}) {
  const store = preparedStore || createPreparedBoundaryStore();
  if (!preparedStore) store.replace(features);
  segments = segments.map(segment => segment.refs || !features.length ? segment : attachBoundarySegmentReferences(segment, store));
  const byId = new Map(features.map(feature => [String(feature.id), feature]));
  const internalOwners = {};
  const excluded = createBoundarySpatialIndex();
  // Child perimeters already belong to territorial scene strokes. The native
  // country mesh remains a fill optimization and must never repaint them solid.
  const outlineIds = new Set(features.filter(feature => feature.boundaryRootId && String(feature.id) !== feature.boundaryRootId)
    .map(feature => String(feature.id)));
  const exteriorSegments = new Set();
  // Classify mixed parent/child contacts in one WASM crossing. Cached
  // source references remain Worker-owned; source geometry is not revisited.
  const mixedContacts = [];
  segments.forEach((segment, index) => {
    const owners = segment.ownerIds.map(id => byId.get(id));
    if (!owners.length || owners.some(owner => !owner?.boundaryRootId)
      || new Set(owners.map(owner => owner.boundaryRootId)).size !== 1) return;
    const children = owners.filter(owner => owner.id !== owner.boundaryRootId);
    if (children.length && children.length !== owners.length)
      mixedContacts.push({ index, comparison: boundaryInteriorComparison(segment, segment.ownerIds) });
  });
  const flags = mixedContacts.length
    ? sharedCalculationCore.boundaryOpposingInteriorsBatch(mixedContacts.map(item => item.comparison)) : [];
  // An incomplete native result must never silently turn an internal shared
  // country edge into an exterior or suppress the country's dashed boundary.
  if (!Array.isArray(flags) || flags.length !== mixedContacts.length
    || flags.some(value => typeof value !== 'boolean')) {
    throw Object.assign(new Error('Incomplete compiled country boundary interior classifications.'),
      { code: 'PL-BOUNDARY-INTERIOR' });
  }
  const opposingSegments = new Set(mixedContacts.filter((_, i) => flags[i]).map(item => item.index));
  segments.forEach((segment, index) => {
    const owners = segment.ownerIds.map(id => byId.get(id));
    if (!owners.length || owners.some(owner => !owner?.boundaryRootId)
      || new Set(owners.map(owner => owner.boundaryRootId)).size !== 1) return;
    const children = owners.filter(owner => owner.id !== owner.boundaryRootId).map(owner => String(owner.id));
    if (!children.length) return;
    if (children.length === owners.length) {
      exteriorSegments.add(segment); // The territorial stroke already owns sibling contacts.
      return;
    }
    if (!opposingSegments.has(index)) {
      exteriorSegments.add(segment);
      children.forEach(id => outlineIds.add(id));
      const row = { a: segment.start, b: segment.end, ownerIds: children };
      excluded.insert(index, row, segmentBounds(row));
      return;
    }
    internalOwners[segment.ownerIds.join('|')] = children;
    segment.ownerIds.forEach(id => outlineIds.add(id));
    const row = { a: segment.start, b: segment.end, ownerIds: segment.ownerIds };
    excluded.insert(index, row, segmentBounds(row));
  });
  const outlines = [];
  for (const id of [...outlineIds].sort()) {
    if (byId.get(id).boundaryRootId !== id) continue;
    for (const [start, end] of store.get(id).renderableSegments) {
      const row = { a: start, b: end };
      const bounds = segmentBounds(row).map((value, index) => value + (index < 2 ? -1e-7 : 1e-7));
      const dx = end[0] - start[0], dy = end[1] - start[1];
      const length2 = dx * dx + dy * dy;
      const intervals = excluded.query(bounds).filter(edge => edge.ownerIds.includes(id)).flatMap(edge => {
        const project = point => ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / length2;
        const aligned = point => Math.abs((point[0] - start[0]) * dy - (point[1] - start[1]) * dx) <= 1e-7 * Math.sqrt(length2);
        if (!aligned(edge.a) || !aligned(edge.b)) return [];
        const a = project(edge.a), b = project(edge.b);
        const first = Math.max(0, Math.min(a, b)), last = Math.min(1, Math.max(a, b));
        return last > first ? [[first, last]] : [];
      }).sort((a, b) => a[0] - b[0]);
      const point = t => [start[0] + dx * t, start[1] + dy * t];
      let cursor = 0;
      for (const [first, last] of intervals) {
        if (first > cursor + 1e-9) outlines.push({ start: point(cursor), end: point(first), ownerIds: [id] });
        cursor = Math.max(cursor, last);
      }
      if (cursor < 1 - 1e-9) outlines.push({ start: point(cursor), end, ownerIds: [id] });
    }
  }
  const packet = prepareStrokePacket(segments.filter(segment => !exteriorSegments.has(segment)), maxEdgeDegrees);
  return { ...packet, ownerIds: [...new Set([...packet.ownerIds, ...byId.keys()])], internalOwners,
    outlineOverrides: prepareStrokePacket(outlines, maxEdgeDegrees), outlineOwnerIds: [...outlineIds].sort() };
}

function prepareStrokePacket(segments, maxEdgeDegrees) {
  const sources = [...segments].sort((left, right) =>
    left.ownerIds.join('|').localeCompare(right.ownerIds.join('|')));
  const groups = new Map();
  for (const segment of sources) {
    const key = segment.ownerIds.join('|');
    if (!groups.has(key)) groups.set(key, { ownerIds: segment.ownerIds, edges: [] });
    groups.get(key).edges.push([segment.start, segment.end]);
  }
  // Classification and overlap subtraction use source edges. Only the final
  // display chains are seam-split and refined, retaining a phase across seams.
  const ordered = [], phases = [];
  for (const { ownerIds, edges } of groups.values()) {
    for (const line of connectBoundarySegments(edges)) {
      let phase = 0;
      const renderable = buildRefinedBoundarySegments({ type: 'LineString', coordinates: line }, maxEdgeDegrees);
      for (const [start, end] of renderable) {
        ordered.push({ start, end, ownerIds });
        phases.push(phase);
        phase += Math.hypot(end[0] - start[0], end[1] - start[1]);
      }
    }
  }
  const startsEnds = new Float32Array(ordered.length * 4);
  const chainPhase = new Float32Array(phases);
  const ownerRanges = {};
  ordered.forEach((segment, index) => {
    const key = segment.ownerIds.join('|');
    const range = ownerRanges[key] || (ownerRanges[key] = { first: index, count: 0 });
    range.count++;
    startsEnds.set([...segment.start, ...segment.end], index * 4);
  });
  return {
    segments: serializeCountrySharedBoundarySegments(ordered),
    startsEnds,
    chainPhase,
    ownerRanges,
    ownerIds: [...new Set(ordered.flatMap(segment => segment.ownerIds))],
    preparedGeometry: buildGpuStrokeInstances(startsEnds, chainPhase, ownerRanges),
  };
}

// Subtract complete owner ranges from the already culled mesh submission.
// Do not let a broad-phase full-range fallback restore the excluded solid edge.
export function excludeCountryBoundaryOwners(ranges, mesh, ownerIds) {
  const excluded = new Set(ownerIds);
  const blocked = (mesh?.metadataCountryIds || []).flatMap((id, index) => excluded.has(id)
    ? [{ first: mesh.countryBoundaryRanges[index * 2], count: mesh.countryBoundaryRanges[index * 2 + 1] }] : [])
    .filter(range => range.count).sort((a, b) => a.first - b.first);
  return ranges.flatMap(range => {
    const result = [];
    let cursor = range.first;
    const end = range.first + range.count;
    for (const block of blocked) {
      if (block.first >= end) break;
      if (block.first + block.count <= cursor) continue;
      if (block.first > cursor) result.push({ first: cursor, count: block.first - cursor });
      cursor = Math.min(end, Math.max(cursor, block.first + block.count));
    }
    if (cursor < end) result.push({ first: cursor, count: end - cursor });
    return result;
  });
}
