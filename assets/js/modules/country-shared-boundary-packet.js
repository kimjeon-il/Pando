import { buildGpuStrokeInstances } from './gpu-stroke-geometry.js';
import { buildCountrySharedBoundarySegments, hasOpposingBoundaryInteriors } from './boundary-topology.js';
import { buildRenderableBoundarySegments } from './geographic-boundary.js';
import { createBoundarySpatialIndex, segmentBounds } from './boundary-spatial-index.js';

export function shouldShowSharedCountryBorders(settings) {
  return settings?.terrainVisible === true && settings?.terrainStyle === 'physical';
}

export function visibleCountrySharedSegments(segments = [], isVisible = () => true) {
  return segments.filter(segment => segment.ownerIds.some(isVisible));
}

export function reconcileCountrySharedBoundarySegments(previous, features, changedIds) {
  const changed = new Set([...changedIds].map(String));
  if (!changed.size) return previous;
  const current = [...features];
  const bounds = new Map(current.map(feature => {
    const value = [Infinity, Infinity, -Infinity, -Infinity];
    const visit = item => {
      if (!Array.isArray(item)) return;
      if (typeof item[0] === 'number' && typeof item[1] === 'number') {
        value[0] = Math.min(value[0], item[0]); value[1] = Math.min(value[1], item[1]);
        value[2] = Math.max(value[2], item[0]); value[3] = Math.max(value[3], item[1]);
      } else for (const child of item) visit(child);
    };
    visit(feature?.geometry?.coordinates);
    return [String(feature.id), value];
  }));
  const keyOf = segment => [segment.start, segment.end]
    .map(point => `${Math.round(point[0] * 1e7)},${Math.round(point[1] * 1e7)}`)
    .sort().join('|');
  const merged = new Map();
  const add = segment => {
    const key = keyOf(segment);
    const prior = merged.get(key);
    if (prior) prior.ownerIds = [...new Set([...prior.ownerIds, ...segment.ownerIds])].sort();
    else merged.set(key, { ...segment, ownerIds: [...segment.ownerIds].sort() });
  };
  for (const segment of previous) {
    const remaining = segment.ownerIds.filter(id => !changed.has(id));
    if (remaining.length >= 2) add({ ...segment, ownerIds: remaining });
  }
  const pairKeys = new Set();
  for (const feature of current) {
    const id = String(feature.id);
    if (!changed.has(id)) continue;
    for (const other of current) {
      const otherId = String(other.id);
      if (id === otherId) continue;
      const pairKey = [id, otherId].sort().join('|');
      if (pairKeys.has(pairKey)) continue;
      pairKeys.add(pairKey);
      const left = bounds.get(id), right = bounds.get(otherId);
      if (left[0] > right[2] + 1e-7 || right[0] > left[2] + 1e-7
        || left[1] > right[3] + 1e-7 || right[1] > left[3] + 1e-7) continue;
      for (const segment of buildCountrySharedBoundarySegments([feature, other])) add(segment);
    }
  }
  return [...merged.values()];
}

// Keep each owner set contiguous so the GPU can apply the same per-country
// visibility rule as Canvas without rebuilding geometry when visibility flips.
export function prepareCountrySharedBoundaryPacket(segments = [], features = []) {
  const byId = new Map(features.map(feature => [String(feature.id), feature]));
  const internalOwners = {};
  const excluded = createBoundarySpatialIndex();
  // Child perimeters already belong to territorial scene strokes. The native
  // country mesh remains a fill optimization and must never repaint them solid.
  const outlineIds = new Set(features.filter(feature => feature.boundaryRootId && String(feature.id) !== feature.boundaryRootId)
    .map(feature => String(feature.id)));
  const exteriorSegments = new Set();
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
    if (!hasOpposingBoundaryInteriors(segment, owners)) {
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
    for (const [start, end] of buildRenderableBoundarySegments(byId.get(id).geometry)) {
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
  const packet = prepareStrokePacket(segments.filter(segment => !exteriorSegments.has(segment)));
  return { ...packet, ownerIds: [...new Set([...packet.ownerIds, ...byId.keys()])], internalOwners,
    outlineOverrides: prepareStrokePacket(outlines), outlineOwnerIds: [...outlineIds].sort() };
}

function prepareStrokePacket(segments) {
  const ordered = [...segments].sort((left, right) =>
    left.ownerIds.join('|').localeCompare(right.ownerIds.join('|')));
  const startsEnds = new Float32Array(ordered.length * 4);
  const ownerRanges = {};
  ordered.forEach((segment, index) => {
    const key = segment.ownerIds.join('|');
    const range = ownerRanges[key] || (ownerRanges[key] = { first: index, count: 0 });
    range.count++;
    startsEnds.set([...segment.start, ...segment.end], index * 4);
  });
  return {
    segments: ordered,
    startsEnds,
    ownerRanges,
    ownerIds: [...new Set(ordered.flatMap(segment => segment.ownerIds))],
    preparedGeometry: buildGpuStrokeInstances(startsEnds, null, ownerRanges),
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
