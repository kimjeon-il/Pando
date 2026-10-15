import { buildGpuStrokeInstances } from './gpu-stroke-geometry.js';
import { boundaryInteriorComparison, createPreparedBoundaryStore,
  attachBoundarySegmentReferences, topologyNodeKey, mergeSharedBoundaryContributions } from './boundary-topology.js';
import { createBoundarySpatialIndex, segmentBounds } from './boundary-spatial-index.js';
import { MAX_BOUNDARY_EDGE_DEGREES } from './geographic-boundary.js';
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
  function updateEdge(key) {
    const record = edges.get(key);
    if (!record.contributions.size) { edges.delete(key); return; }
    record.value = mergeSharedBoundaryContributions([...record.contributions.values()]);
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
  // Indexing/owner selection stays Worker-local; a single C++ call owns
  // all collinearity projections, interval union and remaining source edges.
  const pendingOutlines = [];
  for (const id of [...outlineIds].sort()) {
    if (byId.get(id).boundaryRootId !== id) continue;
    for (const [start, end] of store.get(id).renderableSegments) {
      const row = { a: start, b: end };
      const bounds = segmentBounds(row).map((value, index) => value + (index < 2 ? -1e-7 : 1e-7));
      const blocked = excluded.query(bounds).filter(edge => edge.ownerIds.includes(id))
        .map(edge => [edge.a, edge.b]);
      pendingOutlines.push({ id, start, end, blocked });
    }
  }
  const clipped = pendingOutlines.length
    ? sharedCalculationCore.boundarySubtractOverlapsBatch(
      pendingOutlines.map(({ start, end, blocked }) => [[start, end], blocked])) : [];
  if (!Array.isArray(clipped) || clipped.length !== pendingOutlines.length
    || clipped.some(pieces => !Array.isArray(pieces))) {
    throw Object.assign(new Error('Incomplete compiled outline overlap subtraction.'),
      { code: 'PL-BOUNDARY-OVERLAP' });
  }
  const outlines = pendingOutlines.flatMap(({ id }, index) => clipped[index]
    .map(([start, end]) => ({ start, end, ownerIds: [id] })));

  const packet = prepareStrokePacket(segments.filter(segment => !exteriorSegments.has(segment)), maxEdgeDegrees);
  return { ...packet, ownerIds: [...new Set([...packet.ownerIds, ...byId.keys()])], internalOwners,
    outlineOverrides: prepareStrokePacket(outlines, maxEdgeDegrees), outlineOwnerIds: [...outlineIds].sort() };
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
