import { buildGpuStrokeInstances } from './gpu-stroke-geometry.js';
import { buildCountrySharedBoundarySegments } from './boundary-topology.js';

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
export function prepareCountrySharedBoundaryPacket(segments = []) {
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
