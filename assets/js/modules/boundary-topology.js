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
  return String(feature?.properties?.editor_id || feature?.id || index);
}

function pointOnSegment(point, a, b, epsilon) {
  const dx = Number(b[0]) - Number(a[0]);
  const dy = Number(b[1]) - Number(a[1]);
  const length2 = dx * dx + dy * dy;
  if (!length2) return null;
  const t = ((Number(point[0]) - Number(a[0])) * dx + (Number(point[1]) - Number(a[1])) * dy) / length2;
  if (t < -epsilon || t > 1 + epsilon) return null;
  const x = Number(a[0]) + dx * t;
  const y = Number(a[1]) + dy * t;
  const distance = Math.hypot(Number(point[0]) - x, Number(point[1]) - y);
  return distance <= epsilon ? Math.max(0, Math.min(1, t)) : null;
}

export function buildBoundaryTopology(features = [], { precision = 7, epsilon = 1e-7 } = {}) {
  const nodes = new Map();
  const rawSegments = [];
  const ensureNode = coordinate => {
    const key = topologyNodeKey(coordinate, precision);
    if (!nodes.has(key)) nodes.set(key, { key, coordinate: cloneCoordinate(coordinate), ownerIds: new Set(), refs: [], virtualRefs: [] });
    return nodes.get(key);
  };

  features.forEach((feature, featureIndex) => {
    const id = featureId(feature, featureIndex);
    for (const polygon of polygonRings(feature)) {
      (polygon.rings || []).forEach((ring, ringIndex) => {
        const limit = Math.max(0, ring.length - 1);
        for (let vertexIndex = 0; vertexIndex < limit; vertexIndex += 1) {
          const coordinate = ring[vertexIndex];
          const node = ensureNode(coordinate);
          node.ownerIds.add(id);
          node.refs.push({ featureId: id, polygonIndex: polygon.polygonIndex, ringIndex, vertexIndex });
          rawSegments.push({
            featureId: id,
            polygonIndex: polygon.polygonIndex,
            ringIndex,
            segmentIndex: vertexIndex,
            a: cloneCoordinate(ring[vertexIndex]),
            b: cloneCoordinate(ring[vertexIndex + 1]),
          });
        }
      });
    }
  });

  const nodeValues = [...nodes.values()];
  // A shared-border vertex may lie inside the opposite owner's longer segment.
  // Looking at every node for every segment turns detailed country geometry into
  // O(n²) work, so query only coarse geographic buckets crossed by the segment.
  const bucketSize = 0.25;
  const bucketKey = (x, y) => `${x}:${y}`;
  const nodeBuckets = new Map();
  for (const node of nodeValues) {
    const key = bucketKey(Math.floor(node.coordinate[0] / bucketSize), Math.floor(node.coordinate[1] / bucketSize));
    if (!nodeBuckets.has(key)) nodeBuckets.set(key, []);
    nodeBuckets.get(key).push(node);
  }
  const nodesNearSegment = raw => {
    const minX = Math.floor((Math.min(raw.a[0], raw.b[0]) - epsilon) / bucketSize);
    const maxX = Math.floor((Math.max(raw.a[0], raw.b[0]) + epsilon) / bucketSize);
    const minY = Math.floor((Math.min(raw.a[1], raw.b[1]) - epsilon) / bucketSize);
    const maxY = Math.floor((Math.max(raw.a[1], raw.b[1]) + epsilon) / bucketSize);
    const cellCount = (maxX - minX + 1) * (maxY - minY + 1);
    if (cellCount > 4096) return nodeValues;
    const output = [];
    const seen = new Set();
    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        for (const node of nodeBuckets.get(bucketKey(x, y)) || []) {
          if (seen.has(node.key)) continue;
          seen.add(node.key);
          output.push(node);
        }
      }
    }
    return output;
  };
  const segments = new Map();
  for (const raw of rawSegments) {
    const split = nodesNearSegment(raw)
      .map(node => ({ node, t: pointOnSegment(node.coordinate, raw.a, raw.b, epsilon) }))
      .filter(item => item.t !== null)
      .sort((left, right) => left.t - right.t);
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
      segment.refs.push({ ...raw, startT: start.t, endT: end.t });
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

export function moveTopologyNode(featureMap, node, nextCoordinate, { precision = 7 } = {}) {
  if (!node || !Array.isArray(nextCoordinate)) return new Set();
  const changed = new Set();
  const oldKey = topologyNodeKey(node.coordinate, precision);
  const virtualByRing = new Map();
  for (const ref of node.virtualRefs || []) {
    const key = `${ref.featureId}:${ref.polygonIndex}:${ref.ringIndex}`;
    if (!virtualByRing.has(key)) virtualByRing.set(key, []);
    virtualByRing.get(key).push(ref);
  }
  for (const refs of virtualByRing.values()) {
    refs.sort((left, right) => right.segmentIndex - left.segmentIndex || right.t - left.t);
    for (const ref of refs) {
      const feature = featureMap.get(String(ref.featureId));
      const ring = ringForRef(feature, ref);
      if (!ring) continue;
      const exists = ring.some(coordinate => topologyNodeKey(coordinate, precision) === oldKey);
      if (!exists) ring.splice(ref.segmentIndex + 1, 0, cloneCoordinate(node.coordinate));
      changed.add(String(ref.featureId));
    }
  }
  for (const ownerId of node.ownerIds || []) {
    const feature = featureMap.get(String(ownerId));
    if (!feature) continue;
    for (const polygon of polygonRings(feature)) {
      for (const ring of polygon.rings || []) {
        let ringChanged = false;
        for (let index = 0; index < ring.length; index += 1) {
          if (topologyNodeKey(ring[index], precision) !== oldKey) continue;
          ring[index] = cloneCoordinate(nextCoordinate);
          ringChanged = true;
        }
        if (ringChanged && ring.length > 1) {
          const firstKey = topologyNodeKey(ring[0], precision);
          const lastKey = topologyNodeKey(ring[ring.length - 1], precision);
          if (firstKey !== lastKey && (firstKey === topologyNodeKey(nextCoordinate, precision) || lastKey === topologyNodeKey(nextCoordinate, precision))) {
            ring[ring.length - 1] = cloneCoordinate(ring[0]);
          }
          changed.add(String(ownerId));
        }
      }
    }
  }
  return changed;
}

export function topologySnapCandidates(topology, { activeOwnerIds = [] } = {}) {
  const active = new Set(activeOwnerIds.map(String));
  const output = [];
  for (const node of topology?.nodes?.values?.() || []) {
    const neighbor = active.size && [...node.ownerIds].some(id => !active.has(String(id)));
    output.push({ kind: 'vertex', coordinate: node.coordinate, ownerIds: [...node.ownerIds], nodeKey: node.key, neighbor });
  }
  for (const segment of topology?.segments?.values?.() || []) {
    const neighbor = active.size && [...segment.ownerIds].some(id => !active.has(String(id)));
    output.push({
      kind: neighbor ? 'neighbor' : segment.kind === 'shared' ? 'boundary' : 'edge',
      a: segment.a,
      b: segment.b,
      ownerIds: [...segment.ownerIds],
      segmentKey: segment.key,
    });
  }
  return output;
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
