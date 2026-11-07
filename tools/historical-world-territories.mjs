import "../shared/frontend/js/vendor/polygon-clipping.min.js";
import './load-spherical-core.mjs';
import "../shared/frontend/js/modules/polygon-geometry.js";
import {area as polygonArea} from '../shared/frontend/js/modules/map-edit-geometry.js';
import { normalizeTemporalInterval, compareTemporal, sharedCalculationCore } from "../shared/frontend/js/modules/temporal.js";

// One deterministic, native Boolean owner for historical compilation. The
// shared Core uses robust orientation arithmetic and accepts the original
// double-precision vertices; its coarse precision-retry mode stays disabled.
export const historicalWorldClipper = Object.freeze(Object.fromEntries(
  ['union','intersection','difference','xor'].map(method=>
    [method,(...operands)=>sharedCalculationCore.polygonOperation(method,operands,false)])
));
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
    if(discardedPrecisionComponents>10||discardedPrecisionAreaM2>0.5){
      const error=new Error(`HISTORICAL_CLIP_PRECISION_BUDGET_EXCEEDED: count=${discardedPrecisionComponents}, areaM2=${discardedPrecisionAreaM2}, operation=${row.operation}`);
      error.code='HISTORICAL_CLIP_PRECISION_BUDGET_EXCEEDED';
      throw error;
    }
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
      // Precision-budget errors have a different owner than malformed rings.
      // Keep their exact count/area instead of disguising them as bad shells.
      if(error.code==='HISTORICAL_CLIP_PRECISION_BUDGET_EXCEEDED')throw error;
      // Clipper failures need source-level evidence. Do not silently discard
      // invalid output or round a historical coordinate to hide the fault.
      const failing = value.flatMap((polygon, pi) => polygon.map((ring, ri) => ({
        polygon: pi, ring: ri, vertices: ring.length,
      }))).filter(part => part.vertices < 4);
      let invalidComponentIndex=-1;
      // The Core retry reports "component 0" for an individual component,
      // not necessarily component 0 of the full Boolean output.
      for(let index=0;index<value.length;index++){
        try{globalThis.PandoLabPolygonGeometry.normalizeClippedPolygonGeometry([value[index]],{
          onPrecisionDiscard(){},
        });}catch{invalidComponentIndex=index;break;}
      }
      const reported=invalidComponentIndex<0?[0,1,2]:
        [invalidComponentIndex-1,invalidComponentIndex,invalidComponentIndex+1]
          .filter(index=>index>=0&&index<value.length);
      const diagnostic=reported.flatMap(pi=>value[pi].slice(0,2).map((ring,ri)=>{
        const first=ring[0]||[0,0],bounds=[Infinity,Infinity,-Infinity,-Infinity];
        let twiceArea=0,minimumEdge=Infinity,zeroEdges=0,nearAdjacent=0,repeatedVertices=0;
        const seenVertices=new Set();
        for(let i=0;i<ring.length;i++){
          const point=ring[i],next=ring[(i+1)%ring.length]||point;
          if(i+1<ring.length){const key=point.join(',');if(seenVertices.has(key))repeatedVertices++;else seenVertices.add(key);}
          bounds[0]=Math.min(bounds[0],point[0]);bounds[1]=Math.min(bounds[1],point[1]);
          bounds[2]=Math.max(bounds[2],point[0]);bounds[3]=Math.max(bounds[3],point[1]);
          twiceArea+=(point[0]-first[0])*(next[1]-first[1])-(next[0]-first[0])*(point[1]-first[1]);
          const edge=Math.hypot(next[0]-point[0],next[1]-point[1]);
          if(i+1<ring.length){
            minimumEdge=Math.min(minimumEdge,edge);
            if(edge===0)zeroEdges++;
            if(Math.abs(next[0]-point[0])<=1e-10&&Math.abs(next[1]-point[1])<=1e-10)nearAdjacent++;
          }
        }
        return {polygon:pi,ring:ri,vertices:ring.length,bounds,
          areaDegreesSquared:Math.abs(twiceArea)/2,minimumEdge,zeroEdges,nearAdjacent,repeatedVertices,
          first:ring.slice(0,3),last:ring.slice(-3),
          completeRing:ring.length<=16?ring:null};
      }));
      throw new Error(`HISTORICAL_CLIP_INVALID: ${operation}, components=${value.length}, invalidComponentIndex=${invalidComponentIndex}, shortRings=${JSON.stringify(failing.slice(0,8))}, ringDiagnostic=${JSON.stringify(diagnostic)}: ${error.message}`,{cause:error});
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
  // Contact along a zero-area bbox edge cannot change a land difference.
  // Exact strict comparison avoids pointless Boolean sweeps on touching borders.
  const touches=(a,b)=>a[0]<b[2]&&a[2]>b[0]&&a[1]<b[3]&&a[3]>b[1];
  const componentDifference=(left,right)=>{
    // Clip independent subject polygons against only the overlapping portion
    // of the already-computed peer intersection union. This bounds each
    // Boolean sweep without reprocessing unrelated original boundaries.
    const rightEnvelopes=right.map(envelope),pieces=[];
    for(const polygon of left){
      const bounds=envelope(polygon);
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
        && inputs[0].length+inputs[1].length>16;
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
      // The intersection is the only geometry this peer can subtract.
      // Do not combine unrelated source boundaries in the same difference
      // sweep: real shared borders can create numerical backtracking slivers.
      overlaps.get(row.entityId).push({ geometry: overlap, entityId: peer.entityId });
    }
  }
  for (const row of candidates) if (overlaps.has(row.entityId)) {
    const parts = overlaps.get(row.entityId);
    const union=evaluate('union',parts.map(part=>part.geometry),`overlap-union ${row.entityId}`);
    replace(row,difference(row.geometry,union),'unknown-peer-overlap',parts.map(part=>part.entityId).sort());
  }
  clipChildren();
  return { candidates: candidates.filter(row => row.geometry), adjustments };
}
