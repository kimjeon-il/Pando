import "../shared/frontend/js/vendor/polygon-clipping.min.js";
import './load-spherical-core.mjs';
import "../shared/frontend/js/modules/polygon-geometry.js";
import {area as polygonArea} from '../shared/frontend/js/modules/map-edit-geometry.js';
import { normalizeTemporalInterval, compareTemporal } from "../shared/frontend/js/modules/temporal.js";

// The historical compiler retains the source-coordinate Boolean owner proven
// by the P2 artifact build. Independent subject components are clipped below;
// never round historical coordinates or switch owners on a Boolean failure.
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
  // A large MultiPolygon Boolean must not combine unrelated distant pieces
  // in one sweep-line. Disjoint source components can be subtracted exactly
  // and independently: (A1 ∪ A2) \\ B = (A1 \\ B) ∪ (A2 \\ B).
  // The clipping engine still owns all intersection geometry; no rounding,
  // simplification, or invented boundaries are introduced.
  const envelope=polygon=>{
    let west=Infinity,south=Infinity,east=-Infinity,north=-Infinity;
    for(const ring of polygon)for(const point of ring){
      west=Math.min(west,point[0]);south=Math.min(south,point[1]);
      east=Math.max(east,point[0]);north=Math.max(north,point[1]);
    }
    return [west,south,east,north];
  };
  const touches=(a,b)=>a[0]<=b[2]&&a[2]>=b[0]&&a[1]<=b[3]&&a[3]>=b[1];
  const componentDifference=(left,right)=>{
    const rightEnvelopes=right.map(envelope),pieces=[];
    for(const polygon of left){
      const bounds=envelope(polygon);
      // Only one subject is swept at a time. Group every cutter that can
      // intersect that subject, rather than creating intermediary split
      // rings whose next sweep can break the exact shared-border ordering.
      const near=right.filter((candidate,index)=>touches(bounds,rightEnvelopes[index]));
      if(!near.length)pieces.push(polygon);
      else pieces.push(...clipper.difference([polygon],near));
    }
    return pieces;
  };
  const evaluate=(name,geometries,operation)=>{
    const ids=geometries.map(geometry=>{if(!cache.keys.has(geometry))cache.keys.set(geometry,++cache.nextKey);return cache.keys.get(geometry);});
    const key=JSON.stringify([name,ids,operation]),previous=cache.operations.get(key);
    if(previous){for(const row of previous.precision)recordPrecision(row);return previous.geometry;}
    const offset=adjustments.length,inputs=geometries.map(coordinates);
    let raw;
    try {
      const complexDifference=name==='difference' && geometries.length===2
        && (inputs[0].length+inputs[1].length>16);
      raw=complexDifference?componentDifference(inputs[0],inputs[1]):clipper[name](...inputs);
    }catch(error){
      throw new Error('HISTORICAL_CLIP_BOOLEAN_FAILED: '+operation+': '+error.message,{cause:error});
    }
    const geometry=shape(raw,operation);
    cache.operations.set(key,{geometry,precision:adjustments.slice(offset)});
    return geometry;
  };
  const intersection = (a, b) => evaluate('intersection',[a,b],`intersection ${owner(a)} / ${owner(b)}`);
  const difference = (a, b) => evaluate('difference',[a,b],`difference ${owner(a)} / ${owner(b)}`);
  const area=geometry=>{if(!cache.areas.has(geometry))cache.areas.set(geometry,
    polygonArea(globalThis.PandoLabPolygonGeometry.wrapPolygonGeometry(geometry,clipper)));return cache.areas.get(geometry);};
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
