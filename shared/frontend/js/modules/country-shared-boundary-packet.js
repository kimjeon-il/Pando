import { buildGpuStrokeInstances } from './gpu-stroke-geometry.js';
import { boundaryInteriorComparison, buildTerritorialInternalBoundarySegments, createPreparedBoundaryStore,
  attachBoundarySegmentReferences, topologyNodeKey, mergeSharedBoundaryContributions } from './boundary-topology.js';
import { createBoundarySpatialIndex, segmentBounds } from './boundary-spatial-index.js';
import { MAX_BOUNDARY_EDGE_DEGREES, forEachRenderableBoundarySegment } from './geographic-boundary.js';
import { sharedCalculationCore } from './temporal.js';
import { computeCountrySharedContacts } from './country-contact-core.js';
import { assembleStrokeWithGroupReuse } from './country-stroke-group-reuse.js';

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
  function reconcile(changed, profile) {
    const trace = typeof profile === 'function' ? profile : null;
    let started = trace ? performance.now() : 0;
    const obsolete = new Set([...changed].flatMap(id => [...(contactsByOwner.get(id) || [])]));
    for (const key of obsolete) removeContact(key);
    if (trace) trace('contact-remove', performance.now() - started, {changedIds: changed.size, removedPairs: obsolete.size});
    started = trace ? performance.now() : 0;
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
    if (trace) trace('contact-neighbor-search', performance.now() - started,
      {changedIds: changed.size, candidatePairs: pairs.length});
    const computed = computeCountrySharedContacts(pairs, trace);
    started = trace ? performance.now() : 0;
    computed.forEach((segments, index) => {
      contactComputationCount++;
      addContact(owners[index], segments);
    });
    if (trace) trace('contact-merge', performance.now() - started,
      {candidatePairs: pairs.length, computedSegments: computed.reduce((sum, rows) => sum + rows.length, 0)});

  }
  function seed(segments, changed, profile) {
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
    reconcile(changed, profile);
  }
  function replace(features, { cachedSegments, changedIds, profile } = {}) {
    const started = typeof profile === 'function' ? performance.now() : 0;
    const changed = preparedStore.replace(features);
    if (typeof profile === 'function') profile('prepare-store-replace', performance.now() - started,
      {changedIds: changed.size, totalFeatures: features.length});
    if (cachedSegments) seed(cachedSegments,
      changedIds === undefined ? changed : new Set([...changedIds].map(String)), profile);
    else reconcile(changed, profile);
    return changed;
  }
  function patch(features = [], removedIds = [], {profile} = {}) {
    const started = typeof profile === 'function' ? performance.now() : 0;
    const changed = preparedStore.patch(features, removedIds);
    if (typeof profile === 'function') profile('prepare-store-patch', performance.now() - started,
      {changedIds: changed.size, suppliedFeatures: features.length, removedIds: removedIds.length});
    reconcile(changed, profile);
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
// One previous per-owner compiled stroke set per live prepared-store; all group
// fragments together obey an independent 24MiB budget (see helper).
const compiledStrokeGroupCaches = new WeakMap();
// Keep each WASM transfer below its source/candidate limits. Each subtraction
// row is independent, so chunking preserves the source order and exact pieces.
const OUTLINE_BATCH_EDGES = 16_384;
const OUTLINE_BATCH_CANDIDATES = 1_000_000;
export function prepareCountrySharedBoundaryPacket(segments = [], features = [], { preparedStore, maxEdgeDegrees = MAX_BOUNDARY_EDGE_DEGREES, includeOutlines = true, profile } = {}) {
  // Optional, non-mutating diagnostic spans. The ordinary viewer does not
  // allocate timing entries or call performance.now() for each source edge.
  const measure = (name, operation, details) => {
    if (typeof profile !== 'function') return operation();
    const started = performance.now();
    try { return operation(); }
    finally { profile(name, performance.now() - started, details); }
  };
  const store = preparedStore || createPreparedBoundaryStore();
  if (!preparedStore) store.replace(features);
  const byId = new Map(features.map(feature => [String(feature.id), feature]));
  const rootOf = id => String(byId.get(String(id))?.boundaryRootId || id);
  const childIds = ids => ids.filter(id => rootOf(id) !== String(id));
  const sameHierarchy = segment => new Set(segment.ownerIds.map(rootOf)).size === 1;
  const key = JSON.stringify(features.map(feature => [String(feature.id), rootOf(feature.id), store.get(feature.id).geometryKey]));
  let cached = boundaryGeometryCache.get(store);
  if (cached?.key !== key) {
    const previous = cached;
    const roots = features.filter(feature => rootOf(feature.id) === String(feature.id))
      .map(feature => ({ ...feature, properties: { ...feature.properties, entityKind: 'general', parentId: '' } }));
    const children = features.filter(feature => rootOf(feature.id) !== String(feature.id));
    const internal = [], rootCache = new Map();
    // A changed sovereign must not force unrelated countries to repeat their
    // C++ union/topology work. Each cache key includes the exact root and
    // ordered child geometry revisions; structural edits invalidate only that
    // root. Retain *one* previous set per Worker, not unbounded time history.
    const membersByRoot = new Map(roots.map(root => [String(root.id), []]));
    for (const child of children) membersByRoot.get(rootOf(child.id))?.push(child);
    const hierarchyStats = {roots: roots.length, children: children.length,
      reusedRoots: 0, recomputedRoots: 0};
    measure('hierarchy-internal', () => {
      for (const root of roots) {
        const id = String(root.id), rawMembers = membersByRoot.get(id) || [];
        const groupKey = JSON.stringify([[id, store.get(id).geometryKey],
          ...rawMembers.map(child => [String(child.id), store.get(child.id).geometryKey])]);
        let group = previous?.rootCache?.get(id);
        if (group?.key === groupKey) hierarchyStats.reusedRoots++;
        else {
          hierarchyStats.recomputedRoots++;
          const groupStarted = typeof profile === 'function' && rawMembers.length ? performance.now() : 0;
          const members = rawMembers.map(feature => ({ ...feature,
            properties: { ...feature.properties, entityKind: 'general', parentId: id } }));
          const segments = buildTerritorialInternalBoundarySegments([root], members).map(segment => ({
            start: segment.a, end: segment.b,
            ownerIds: [...new Set([id, ...segment.unitOwners.map(owner => owner.id)])].sort(),
          }));
          group = {key: groupKey, segments};
          if (groupStarted) profile('hierarchy-root', performance.now() - groupStarted,
            {rootId: id, children: members.length, segments: segments.length});
        }
        rootCache.set(id, group);
        internal.push(...group.segments);
      }
    }, hierarchyStats);
    const coasts = measure('hierarchy-classification', () => {
      const hierarchyContacts = segments.filter(segment => sameHierarchy(segment) && childIds(segment.ownerIds).length);
      const opposing = hierarchyContacts.length ? sharedCalculationCore.boundaryOpposingInteriorsBatch(hierarchyContacts.map(segment => boundaryInteriorComparison(segment, segment.ownerIds))) : [];
      if (!Array.isArray(opposing) || opposing.length !== hierarchyContacts.length || opposing.some(value => typeof value !== 'boolean'))
        throw Object.assign(new Error('Incomplete compiled country boundary interior classifications.'), { code: 'PL-BOUNDARY-INTERIOR' });
      return hierarchyContacts.filter((_, index) => !opposing[index]);
    });
    cached = { key, internal, coasts, outlines: null, rootCache };
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
    measure('outline-index', () => {
      [...segments, ...cached.internal].forEach((segment, index) => {
        const row = { a: segment.start, b: segment.end, ownerIds: segment.ownerIds };
        excluded.insert(index, row, segmentBounds(row));
      });
    }, {segments: segments.length + cached.internal.length});
    const pending = [], outlines = [];
    let candidateCount = 0;
    function flushOutlines() {
      if (!pending.length) return;
      const clipped = measure('outline-wasm-subtract', () =>
        sharedCalculationCore.boundarySubtractOverlapsBatch(pending.map(({ start, end, blocked }) => [[start, end], blocked])),
      {sourceEdges: pending.length, candidates: candidateCount});
      if (!Array.isArray(clipped) || clipped.length !== pending.length || clipped.some(pieces => !Array.isArray(pieces)))
        throw Object.assign(new Error('Incomplete compiled outline overlap subtraction.'), { code: 'PL-BOUNDARY-OVERLAP' });
      pending.forEach(({ id }, index) => {
        for (const [start, end] of clipped[index]) outlines.push({ start, end, ownerIds: [id] });
      });
      pending.length = 0;
      candidateCount = 0;
    }
    measure('outline-scan-including-wasm', () => {
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
    }, {features: features.length});
    cached.outlines = [...outlines, ...cached.coasts];
  }
  const groupCaches = preparedStore
    ? compiledStrokeGroupCaches.get(store) || {} : null;
  const packet = prepareStrokePacket(visible, maxEdgeDegrees, measure, 'contact-stroke',groupCaches,profile);
  const outlineOverrides = prepareStrokePacket(includeOutlines ? cached.outlines : [], maxEdgeDegrees,
    measure, 'outline-stroke',groupCaches,profile);
  if (groupCaches) compiledStrokeGroupCaches.set(store,groupCaches);
  outlineOverrides.internalOwners = Object.fromEntries([
    ...features.filter(feature => rootOf(feature.id) !== String(feature.id)).map(feature => [String(feature.id), [String(feature.id)]]),
    ...cached.coasts.map(segment => [segment.ownerIds.join('|'), childIds(segment.ownerIds)]),
  ]);
  return { ...packet, ownerIds: [...new Set([...packet.ownerIds, ...byId.keys()])], internalOwners, outlineOverrides,
    outlineOwnerIds: [...byId.keys()].sort() };
}

function prepareStrokePacket(segments, maxEdgeDegrees, measure = (_, operation) => operation(),
  label = 'stroke', groupCaches = null, profile = null) {
  // The browser owns only locale-sensitive input ordering and GPU allocation.
  // Country grouping, junction walks, seam splitting, subdivision, phases and
  // owner ranges are calculated in the same native C++ source used by Qt.
  const ordered = measure(label + '-sort', () => [...segments].sort((left, right) =>
    left.ownerIds.join('|').localeCompare(right.ownerIds.join('|'))),
  {segments:segments.length});
  if (typeof sharedCalculationCore.boundaryAssembleStrokePacket !== 'function') {
    throw Object.assign(new Error('Compiled shared-border packet builder unavailable.'),
      { code: 'PL-CORE-WASM-CAPABILITY' });
  }
  // The production C++ kernel remains authoritative. When a prepared-store
  // survives into the next date, only changed owner groups cross the WASM
  // bridge; unchanged output is validated against exact numeric source bytes.
  // Unprepared standalone calls retain the original single native crossing.
  let packet;
  if (groupCaches) {
    const result = assembleStrokeWithGroupReuse(ordered, maxEdgeDegrees,
      (source,quality) => sharedCalculationCore.boundaryAssembleStrokePacket(source,quality),
      groupCaches[label], typeof profile === 'function'
        ? (name,ms,details) => profile(label+'-'+name,ms,details) : null);
    packet = result.packet;
    groupCaches[label] = result.cache;
  } else {
    const source=ordered.map(segment=>[segment.start,segment.end,segment.ownerIds]);
    packet=measure(label+'-wasm-bridge',()=>
      sharedCalculationCore.boundaryAssembleStrokePacket(source,maxEdgeDegrees),
    {segments:source.length});
  }
  if (!packet || !Array.isArray(packet.segments) || !Array.isArray(packet.ownerIds)
    || !(packet.startsEnds instanceof Float32Array)
    || !(packet.chainPhase instanceof Float32Array)
    || packet.startsEnds.length !== packet.segments.length * 4
    || packet.chainPhase.length !== packet.segments.length
    || !packet.ownerRanges || typeof packet.ownerRanges !== 'object') {
    throw Object.assign(new Error('Incomplete compiled shared-border render packet.'),
      { code: 'PL-BOUNDARY-PACKET' });
  }
  return { ...packet, preparedGeometry: measure(label + '-gpu-instances', () =>
    buildGpuStrokeInstances(packet.startsEnds, packet.chainPhase, packet.ownerRanges),
  {segments: packet.segments.length}) };
}
