import '../assets/js/vendor/polygon-clipping.min.js';
import '../assets/js/modules/polygon-geometry.js';
import '../assets/js/modules/territorial-edit-plan.js';
import { normalizeTemporalInterval, compareTemporal } from '../assets/js/modules/temporal.js';

export const historicalWorldClipper = globalThis.polygonClipping;
function intersects(a, b) {
  const left = normalizeTemporalInterval(a.validFrom, a.validTo), right = normalizeTemporalInterval(b.validFrom, b.validTo);
  return !(left.end && right.start && compareTemporal(left.end, right.start, { leftBoundary: 'end' }) < 0)
    && !(right.end && left.start && compareTemporal(right.end, left.start, { leftBoundary: 'end' }) < 0);
}

/** Resolve source ambiguity without assigning ownership by array order. */
export function adjustHistoricalTerritories(input, policy, clipper = historicalWorldClipper) {
  if (policy.schemaVersion !== 1 || policy.unknownPeerOverlap !== 'exclude-from-all' || !Array.isArray(policy.replacements)) throw new Error('Invalid historical territory policy');
  const kernel = globalThis.PandoLabTerritorialEdit.createKernel(clipper);
  const wrapped = new WeakMap();
  const coordinates = geometry => {
    if (!wrapped.has(geometry)) wrapped.set(geometry, globalThis.PandoLabPolygonGeometry.wrapPolygonGeometry(geometry, clipper));
    const value = wrapped.get(geometry);
    return value.type === 'Polygon' ? [value.coordinates] : value.coordinates;
  };
  const owners = new WeakMap(input.filter(row => row.geometry).map(row => [row.geometry, row.entityId]));
  const owner = geometry => owners.get(geometry) || 'intermediate';
  let discardedPrecisionAreaM2 = 0, discardedPrecisionComponents = 0;
  const shape = (value, operation) => {
    if (!value.length) return null;
    try {
      return globalThis.PandoLabPolygonGeometry.normalizeClippedPolygonGeometry(value, {
        onPrecisionDiscard({ polygonIndex, areaM2 }) {
          discardedPrecisionAreaM2 += areaM2;
          discardedPrecisionComponents += 1;
          if (discardedPrecisionComponents > 10 || discardedPrecisionAreaM2 > 0.5) {
            throw new Error('HISTORICAL_CLIP_PRECISION_BUDGET_EXCEEDED');
          }
          const relation = operation.startsWith('difference ') || operation.startsWith('intersection ')
            ? operation.slice(operation.indexOf(' ') + 1).split(' / ') : [];
          adjustments.push({
            entityId: relation[0] || 'numeric-clipping',
            kind: 'certified-clipping-precision-artifact',
            relatedIds: relation[1] ? [relation[1]] : [],
            polygonIndex, areaM2, operation,
          });
        },
      });
    }
    catch (error) {
      const failing = value.flatMap((polygon, pi) => polygon.map((ring, ri) => ({
        polygon: pi, ring: ri, vertices: ring.length,
      }))).filter(part => part.vertices < 4);
      throw new Error(`HISTORICAL_CLIP_INVALID: ${operation}, components=${value.length}, shortRings=${JSON.stringify(failing.slice(0, 8))}: ${error.message}`, { cause: error });
    }
  };
  const intersection = (a, b) => shape(clipper.intersection(coordinates(a), coordinates(b)), `intersection ${owner(a)} / ${owner(b)}`);
  const difference = (a, b) => shape(clipper.difference(coordinates(a), coordinates(b)), `difference ${owner(a)} / ${owner(b)}`);
  const significant = (geometry, reference) => geometry && kernel.area(geometry) > Math.max(1e-10, kernel.area(reference) * 1e-9);
  const candidates = input.map(row => ({ ...row })).sort((a, b) => a.entityId.localeCompare(b.entityId, 'en'));
  const byId = new Map(candidates.map(row => [row.entityId, row])), changed = new Set(), adjustments = [];
  const replace = (row, geometry, kind, relatedIds) => {
    changed.add(row.entityId); row.geometry = geometry;
    if (geometry) owners.set(geometry, row.entityId);
    adjustments.push({ entityId: row.entityId, kind: geometry ? kind : 'empty-after-adjustment', relatedIds });
  };
  for (const rule of [...policy.replacements].sort((a, b) => `${a.targetEntityId}:${a.priorityEntityId}`.localeCompare(`${b.targetEntityId}:${b.priorityEntityId}`, 'en'))) {
    const target = byId.get(rule.targetEntityId), priority = byId.get(rule.priorityEntityId);
    if (!target?.geometry || !priority?.geometry || !intersects(target, rule)) continue;
    if (significant(intersection(target.geometry, priority.geometry), target.geometry)) replace(target, difference(target.geometry, priority.geometry), 'explicit-replacement', [priority.entityId]);
  }
  const depth = row => {
    const seen = new Set([row.entityId]); let value = 0, current = row;
    while (current.parentId) {
      if (seen.has(current.parentId)) throw new Error(`Cyclic parent: ${row.entityId}`);
      seen.add(current.parentId); current = byId.get(current.parentId);
      if (!current) return Infinity;
      value++;
    }
    return value;
  };
  const children = candidates.filter(row => row.parentId).sort((a, b) => depth(a) - depth(b) || a.entityId.localeCompare(b.entityId, 'en'));
  const clipChildren = () => {
    for (const row of children) {
      if (!row.geometry || row.currentSnapshot) continue;
      const parent = byId.get(row.parentId);
      if (!parent?.geometry) replace(row, null, 'parent-gap', [row.parentId]);
      else if (changed.has(parent.entityId) && !kernel.contains(parent.geometry, row.geometry)) replace(row, intersection(row.geometry, parent.geometry), 'parent-clipping', [parent.entityId]);
    }
  };
  clipChildren();
  // Compute every overlap before subtracting any: three-way intersections stay gaps.
  const overlaps = new Map();
  for (let i = 0; i < candidates.length; i++) for (let j = i + 1; j < candidates.length; j++) {
    const a = candidates[i], b = candidates[j];
    if (!a.geometry || !b.geometry || a.parentId !== b.parentId || (a.currentSnapshot && b.currentSnapshot)) continue;
    const overlap = intersection(a.geometry, b.geometry);
    if (!significant(overlap, a.geometry) || !significant(overlap, b.geometry)) continue;
    for (const [row, peer] of [[a, b], [b, a]]) {
      if (!overlaps.has(row.entityId)) overlaps.set(row.entityId, []);
      overlaps.get(row.entityId).push({ geometry: overlap, entityId: peer.entityId });
    }
  }
  for (const row of candidates) if (overlaps.has(row.entityId)) {
    const parts = overlaps.get(row.entityId);
    const union = shape(clipper.union(...parts.map(part => coordinates(part.geometry))), `overlap-union ${row.entityId}`);
    replace(row, difference(row.geometry, union), 'unknown-peer-overlap', parts.map(part => part.entityId).sort());
  }
  clipChildren();
  return { candidates: candidates.filter(row => row.geometry), adjustments };
}
