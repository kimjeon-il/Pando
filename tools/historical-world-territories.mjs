import '../assets/js/vendor/polygon-clipping.min.js';
import './load-spherical-core.mjs';
import '../assets/js/modules/polygon-geometry.js';
import '../assets/js/modules/territorial-edit-plan.js';
import { normalizeTemporalInterval, compareTemporal } from '../assets/js/modules/temporal.js';

export const historicalWorldClipper = globalThis.polygonClipping;
// Geometry versions are immutable; one compilation owns and releases this
// in-memory cache. Dates, policy decisions and precision budgets remain local
// to each adjustment call.
export function createHistoricalTerritoryCache(clipper=historicalWorldClipper){
  return {clipper,wrapped:new WeakMap(),areas:new WeakMap(),keys:new WeakMap(),nextKey:0,operations:new Map()};
}
function intersects(a, b) {
  const left = normalizeTemporalInterval(a.validFrom, a.validTo), right = normalizeTemporalInterval(b.validFrom, b.validTo);
  return !(left.end && right.start && compareTemporal(left.end, right.start, { leftBoundary: 'end' }) < 0)
    && !(right.end && left.start && compareTemporal(right.end, left.start, { leftBoundary: 'end' }) < 0);
}

/** Resolve source ambiguity without assigning ownership by array order. */
export function adjustHistoricalTerritories(input, policy, clipper = historicalWorldClipper, cache=createHistoricalTerritoryCache(clipper)) {
  if (policy.schemaVersion !== 1 || policy.unknownPeerOverlap !== 'exclude-from-all' || !Array.isArray(policy.replacements)) throw new Error('Invalid historical territory policy');
  if(cache.clipper!==clipper)throw new Error('Historical territory cache belongs to another clipper');
  const kernel = globalThis.PandoLabTerritorialEdit.createKernel(clipper);
  const wrapped = cache.wrapped;
  const coordinates = geometry => {
    if (!wrapped.has(geometry)) wrapped.set(geometry, globalThis.PandoLabPolygonGeometry.wrapPolygonGeometry(geometry, clipper));
    const value = wrapped.get(geometry);
    return value.type === 'Polygon' ? [value.coordinates] : value.coordinates;
  };
  const owners = new WeakMap(input.filter(row => row.geometry).map(row => [row.geometry, row.entityId]));
  const owner = geometry => owners.get(geometry) || 'intermediate';
  let discardedPrecisionAreaM2 = 0, discardedPrecisionComponents = 0;
  const recordPrecision=row=>{
    discardedPrecisionAreaM2+=row.areaM2;discardedPrecisionComponents++;
    if(discardedPrecisionComponents>10||discardedPrecisionAreaM2>0.5)throw new Error('HISTORICAL_CLIP_PRECISION_BUDGET_EXCEEDED');
    adjustments.push({...row});
  };
  const shape = (value, operation) => {
    if (!value.length) return null;
    try {
      return globalThis.PandoLabPolygonGeometry.normalizeClippedPolygonGeometry(value, {
        onPrecisionDiscard({ polygonIndex, areaM2 }) {
          const relation = operation.startsWith('difference ') || operation.startsWith('intersection ')
            ? operation.slice(operation.indexOf(' ') + 1).split(' / ') : [];
          recordPrecision({
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
  const evaluate=(name,geometries,operation)=>{
    const ids=geometries.map(geometry=>{if(!cache.keys.has(geometry))cache.keys.set(geometry,++cache.nextKey);return cache.keys.get(geometry);});
    const key=JSON.stringify([name,ids,operation]),previous=cache.operations.get(key);
    if(previous){for(const row of previous.precision)recordPrecision(row);return previous.geometry;}
    const offset=adjustments.length,geometry=shape(clipper[name](...geometries.map(coordinates)),operation);
    cache.operations.set(key,{geometry,precision:adjustments.slice(offset)});
    return geometry;
  };
  const intersection = (a, b) => evaluate('intersection',[a,b],`intersection ${owner(a)} / ${owner(b)}`);
  const difference = (a, b) => evaluate('difference',[a,b],`difference ${owner(a)} / ${owner(b)}`);
  const area=geometry=>{if(!cache.areas.has(geometry))cache.areas.set(geometry,kernel.area(geometry));return cache.areas.get(geometry);};
  const significant = (geometry, reference) => geometry && area(geometry) > Math.max(1e-10, area(reference) * 1e-9);
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
      // Match the kernel's containment test using this pipeline's audited
      // difference normalizer. The kernel's private difference would otherwise
      // reject even a certified sub-millimetre Boolean sliver before reporting it.
      else if (changed.has(parent.entityId) && significant(difference(row.geometry, parent.geometry), row.geometry))
        replace(row, intersection(row.geometry, parent.geometry), 'parent-clipping', [parent.entityId]);
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
    const union = evaluate('union',parts.map(part=>part.geometry),`overlap-union ${row.entityId}`);
    replace(row, difference(row.geometry, union), 'unknown-peer-overlap', parts.map(part => part.entityId).sort());
  }
  clipChildren();
  return { candidates: candidates.filter(row => row.geometry), adjustments };
}
