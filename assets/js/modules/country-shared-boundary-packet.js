import { buildGpuStrokeInstances } from './gpu-stroke-geometry.js';
import { boundaryInteriorComparison, buildTerritorialInternalBoundarySegments, createPreparedBoundaryStore,
  attachBoundarySegmentReferences, topologyNodeKey, mergeSharedBoundaryContributions } from './boundary-topology.js';
import { createBoundarySpatialIndex, segmentBounds } from './boundary-spatial-index.js';
import { MAX_BOUNDARY_EDGE_DEGREES, forEachRenderableBoundarySegment } from './geographic-boundary.js';
import { sharedCalculationCore } from './temporal.js';
import { computeCountrySharedContacts } from './country-contact-core.js';

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
  // Each key normally has one country-pair contributor. Keep that path
  // Map-free; promote/demote only when coincident multi-owner borders require it.
  function updateEdge(key) {
    const record = edges.get(key);
    const contributions = record.contributions;
    if (!contributions?.size) { edges.delete(key); return; }
    if (contributions.size === 1) {
      // A once-shared edge has become single-owner again. Release its Map.
      const [contact, value] = contributions.entries().next().value;
      record.value = value;
      record.contact = contact;
      record.contributions = null;
      return;
    }
    record.value = mergeSharedBoundaryContributions([...contributions.values()]);
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
      if (!record.contributions) {
        // Most world edges have exactly one contact: no per-edge Map needed.
        if (record.contact === key) edges.delete(edgeKey);
        continue;
      }
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
      const existing = edges.get(edgeKey);
      if (!existing) {
        edges.set(edgeKey, { contact: key, value: segment });
        continue;
      }
      if (!existing.contributions) {
        if (existing.contact === key) {
          existing.value = segment;
          continue;
        }
        // Only actual multiple-contact collisions pay for a contribution Map.
        existing.contributions = new Map([[existing.contact, existing.value]]);
        existing.contact = null;
      }
      existing.contributions.set(key, segment);
      updateEdge(edgeKey);
    }
  }
  function reconcile(changed) {
    const obsolete = new Set([...changed].flatMap(id => [...(contactsByOwner.get(id) || [])]));
    for (const key of obsolete) removeContact(key);
    const visited = new Set(), pairs = [], owners = [];
    for (const id of changed) {
      const left = preparedStore.get(id);
      if (!left?.segments.length) continue;
      for (const right of preparedStore.nearby(left.bounds)) {
        if (left.id === right.id) continue;
        const ids = [left.id, right.id].sort(), key = contactKey(ids);
        if (visited.has(key)) continue;
        visited.add(key);
        pairs.push([left, right]);
        owners.push(ids);
      }
    }
    const contacts = computeCountrySharedContacts(pairs);
    contacts.forEach((segments, index) => {
      contactComputationCount++;
      addContact(owners[index], segments);
    });
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
const boundaryGeometryCache = new WeakMap();
// Keep each WASM transfer below its source/candidate limits. Each subtraction
// row is independent, so chunking preserves the source order and exact pieces.
const OUTLINE_BATCH_EDGES = 16_384;
const OUTLINE_BATCH_CANDIDATES = 1_000_000;
export function prepareCountrySharedBoundaryPacket(segments = [], features = [], { preparedStore, maxEdgeDegrees = MAX_BOUNDARY_EDGE_DEGREES, includeOutlines = true } = {}) {
  const store = preparedStore || createPreparedBoundaryStore();
  if (!preparedStore) store.replace(features);
  const byId = new Map(features.map(feature => [String(feature.id), feature]));
  const rootOf = id => String(byId.get(String(id))?.boundaryRootId || id);
  const childIds = ids => ids.filter(id => rootOf(id) !== String(id));
  const sameHierarchy = segment => new Set(segment.ownerIds.map(rootOf)).size === 1;
  const key = JSON.stringify(features.map(feature => [String(feature.id), rootOf(feature.id), store.get(feature.id).geometryKey]));
  let cached = boundaryGeometryCache.get(store);
  if (cached?.key !== key) {
    const roots = features.filter(feature => rootOf(feature.id) === String(feature.id))
      .map(feature => ({ ...feature, properties: { ...feature.properties, entityKind: 'general', parentId: '' } }));
    const children = features.filter(feature => rootOf(feature.id) !== String(feature.id));
    const internal = [];
    // The common land-contact topology owns child boundaries. These flattened
    // presentation references do not change the canonical document hierarchy.
    for (const root of roots) {
      const members = children.filter(feature => rootOf(feature.id) === String(root.id))
        .map(feature => ({ ...feature, properties: { ...feature.properties, entityKind: 'general', parentId: String(root.id) } }));
      for (const segment of buildTerritorialInternalBoundarySegments([root], members)) internal.push({
        start: segment.a, end: segment.b, ownerIds: [...new Set([String(root.id), ...segment.unitOwners.map(owner => owner.id)])].sort(),
      });
    }
    const hierarchyContacts = segments.filter(segment => sameHierarchy(segment) && childIds(segment.ownerIds).length);
    const opposing = hierarchyContacts.length ? sharedCalculationCore.boundaryOpposingInteriorsBatch(hierarchyContacts.map(segment => boundaryInteriorComparison(segment, segment.ownerIds))) : [];
    if (!Array.isArray(opposing) || opposing.length !== hierarchyContacts.length || opposing.some(value => typeof value !== 'boolean'))
      throw Object.assign(new Error('Incomplete compiled country boundary interior classifications.'), { code: 'PL-BOUNDARY-INTERIOR' });
    const coasts = hierarchyContacts.filter((_, index) => !opposing[index]);
    cached = { key, internal, coasts, outlines: null };
    boundaryGeometryCache.set(store, cached);
  }
  const internalOwners = {};
  const contacts = segments.filter(segment => !sameHierarchy(segment));
  const visible = [...contacts, ...cached.internal];
  for (const segment of visible) {
    const children = childIds(segment.ownerIds);
    if (children.length && sameHierarchy(segment)) internalOwners[segment.ownerIds.join('|')] = children;
  }
  if (includeOutlines && !cached.outlines) {
    const excluded = createBoundarySpatialIndex();
    [...segments, ...cached.internal].forEach((segment, index) => {
      const row = { a: segment.start, b: segment.end, ownerIds: segment.ownerIds };
      excluded.insert(index, row, segmentBounds(row));
    });
    const pending = [], outlines = [];
    let candidateCount = 0;
    function flushOutlines() {
      if (!pending.length) return;
      const clipped = sharedCalculationCore.boundarySubtractOverlapsBatch(pending.map(({ start, end, blocked }) => [[start, end], blocked]));
      if (!Array.isArray(clipped) || clipped.length !== pending.length || clipped.some(pieces => !Array.isArray(pieces)))
        throw Object.assign(new Error('Incomplete compiled outline overlap subtraction.'), { code: 'PL-BOUNDARY-OVERLAP' });
      pending.forEach(({ id }, index) => {
        for (const [start, end] of clipped[index]) outlines.push({ start, end, ownerIds: [id] });
      });
      pending.length = 0;
      candidateCount = 0;
    }
    for (const feature of features) {
      const id = String(feature.id);
      forEachRenderableBoundarySegment(store.get(id).geometry, ([start, end]) => {
        const bounds = segmentBounds({ a: start, b: end }).map((value, index) => value + (index < 2 ? -1e-7 : 1e-7));
        const blocked = excluded.query(bounds).filter(edge => edge.ownerIds.includes(id)).map(edge => [edge.a, edge.b]);
        if (pending.length >= OUTLINE_BATCH_EDGES
          || (pending.length && candidateCount + blocked.length > OUTLINE_BATCH_CANDIDATES)) flushOutlines();
        pending.push({ id, start, end, blocked });
        candidateCount += blocked.length;
      });
    }
    flushOutlines();
    cached.outlines = [...outlines, ...cached.coasts];
  }
  const packet = prepareStrokePacket(visible, maxEdgeDegrees);
  const outlineOverrides = prepareStrokePacket(includeOutlines ? cached.outlines : [], maxEdgeDegrees);
  outlineOverrides.internalOwners = Object.fromEntries([
    ...features.filter(feature => rootOf(feature.id) !== String(feature.id)).map(feature => [String(feature.id), [String(feature.id)]]),
    ...cached.coasts.map(segment => [segment.ownerIds.join('|'), childIds(segment.ownerIds)]),
  ]);
  return { ...packet, ownerIds: [...new Set([...packet.ownerIds, ...byId.keys()])], internalOwners, outlineOverrides,
    outlineOwnerIds: [...byId.keys()].sort() };
}

function prepareStrokePacket(segments, maxEdgeDegrees) {
  // The browser owns only locale-sensitive input ordering and GPU allocation.
  // Country grouping, junction walks, seam splitting, subdivision, phases and
  // owner ranges are calculated in the same native C++ source used by Qt.
  const source = [...segments].sort((left, right) =>
    left.ownerIds.join('|').localeCompare(right.ownerIds.join('|')))
    .map(segment => [segment.start, segment.end, segment.ownerIds]);
  if (typeof sharedCalculationCore.boundaryAssembleStrokePacket !== 'function') {
    throw Object.assign(new Error('Compiled shared-border packet builder unavailable.'),
      { code: 'PL-CORE-WASM-CAPABILITY' });
  }
  const packet = sharedCalculationCore.boundaryAssembleStrokePacket(source, maxEdgeDegrees);
  if (!packet || !Array.isArray(packet.segments) || !Array.isArray(packet.ownerIds)
    || !(packet.startsEnds instanceof Float32Array)
    || !(packet.chainPhase instanceof Float32Array)
    || packet.startsEnds.length !== packet.segments.length * 4
    || packet.chainPhase.length !== packet.segments.length
    || !packet.ownerRanges || typeof packet.ownerRanges !== 'object') {
    throw Object.assign(new Error('Incomplete compiled shared-border render packet.'),
      { code: 'PL-BOUNDARY-PACKET' });
  }
  return { ...packet, preparedGeometry: buildGpuStrokeInstances(
    packet.startsEnds, packet.chainPhase, packet.ownerRanges) };
}
