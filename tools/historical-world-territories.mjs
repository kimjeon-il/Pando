import "../shared/frontend/js/vendor/polygon-clipping.min.js";
import {createHash} from 'node:crypto';
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
const subtractionCertificates=new WeakMap();
export function createHistoricalTerritoryCache(clipper=historicalWorldClipper){
  const cache={clipper,wrapped:new WeakMap(),areas:new WeakMap(),keys:new WeakMap(),nextKey:0,operations:new Map()};
  // Certificates are private, not caller-editable cache annotations.
  subtractionCertificates.set(cache,{links:new WeakMap(),snapshots:new WeakMap(),recoveries:new Map()});
  return cache;
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
  const certificates=subtractionCertificates.get(cache);
  const fingerprint=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const capture=(geometry,value)=>{
    if(!certificates)return null;
    if(!certificates.snapshots.has(geometry)){
      try{
        certificates.snapshots.set(geometry,Object.freeze({geometry,
          sha256:fingerprint(geometry),coordinatesSha256:fingerprint(value||coordinates(geometry))}));
      }catch{return null;}
    }
    return certificates.snapshots.get(geometry);
  };
  const validateSnapshots=snapshots=>{
    try{
      for(const snapshot of snapshots)if(!snapshot||fingerprint(snapshot.geometry)!==snapshot.sha256
          ||fingerprint(coordinates(snapshot.geometry))!==snapshot.coordinatesSha256)return 'mutated geometry certificate';
    }catch{return 'uncertain geometry certificate';}
    return '';
  };
  const booleanFailure=(error,operation,inputs,rejected='')=>{
    const failure=new Error('HISTORICAL_CLIP_BOOLEAN_FAILED: '+operation+
      ': operandComponents='+inputs.map(value=>value.length).join(',')+': '+error.message,{cause:error});
    if(rejected)failure.recoveryRejected=rejected;
    return failure;
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
  const componentDifference=(left,right,operation)=>{
    // Difference is associative by cutter: A ∖ (B ∪ C) = (A ∖ B) ∖ C.
    // Process each cutter exactly once, normalizing the validated result
    // before it can enter another sweep. This prevents near-zero loops
    // introduced by one overlay from corrupting the next sweep-line tree.
    // The precision budget still covers every certified removed artifact.
    const cutters=right.map(polygon=>({polygon,bounds:envelope(polygon)}));
    const pieces=[];
    for(const polygon of left){
      let remaining=[polygon];
      for(const cutter of cutters){
        if(!remaining.length)break;
        const next=[];
        for(const part of remaining){
          if(!touches(envelope(part),cutter.bounds)){next.push(part);continue;}
          const clipped=shape(clipper.difference([part],[cutter.polygon]),operation);
          if(clipped)next.push(...(clipped.type==='Polygon'?[clipped.coordinates]:clipped.coordinates));
        }
        remaining=next;
      }
      pieces.push(...remaining);
    }
    return pieces;
  };
  const evaluate=(name,geometries,operation)=>{
    const ids=geometries.map(geometry=>{if(!cache.keys.has(geometry))cache.keys.set(geometry,++cache.nextKey);return cache.keys.get(geometry);});
    const key=JSON.stringify([name,ids,operation]),previous=cache.operations.get(key);
    if(previous){
      const recovery=certificates?.recoveries.get(key);
      if(recovery){
        const rejected=recovery.entry!==previous||previous.geometry!==null
          ||recovery.operands.some((geometry,index)=>geometry!==geometries[index])
          ?'uncertain cached certificate':validateSnapshots(recovery.snapshots);
        if(rejected)throw booleanFailure(recovery.error,operation,geometries.map(coordinates),rejected);
      }
      for(const row of previous.precision)recordPrecision(row);
      if(recovery)adjustments.push(structuredClone(recovery.audit));
      return previous.geometry;
    }
    const offset=adjustments.length,precisionOffset=discardedPrecisionComponents,inputs=geometries.map(coordinates);
    // Capture each participating geometry once, before subtraction. Recheck
    // fingerprints only on the rare recovery path or a recovered cache hit.
    const sourceSnapshots=name==='difference'?geometries.map((geometry,index)=>capture(geometry,inputs[index])):null;
    let recovery;
    let raw;
    try {
      // Multiple cutters are independent set subtractions. Never combine
      // their unrelated edges into one fragile sweep, even for a single
      // mainland subject (e.g. CHE against eleven historical peers).
      const complexDifference=name==='difference' && geometries.length===2
        && (inputs[1].length>1 || inputs[0].length>1);
      raw=complexDifference?componentDifference(inputs[0],inputs[1],operation):clipper[name](...inputs);
    }catch(error){
      // A validated difference is a subset of its left operand and excludes
      // its exact right operand. Preserve only zero-discard subtraction
      // identities; clones, unions and other operations cannot borrow them.
      // These set witnesses resolve an empty intersection without trusting a
      // failed sweep of derived edges or manufacturing replacement geometry.
      let provenEmpty=false,rejected='';
      if(name==='intersection'&&geometries.length===2
          &&error.message==='Unable to complete output ring'
          &&error.code!=='HISTORICAL_CLIP_PRECISION_BUDGET_EXCEEDED'
          &&discardedPrecisionComponents===precisionOffset&&certificates){
        const snapshots=new Set(),links=new Set();
        const trace=geometry=>{
          const seen=new Set(),chain=[];
          while(certificates.links.has(geometry)){
            if(seen.has(geometry)){rejected='cyclic subtraction certificate';break;}
            if(chain.length>=64){rejected='subtraction certificate depth limit';break;}
            seen.add(geometry);
            const link=certificates.links.get(geometry);
            if(link.result.geometry!==geometry){rejected='uncertain subtraction certificate';break;}
            for(const snapshot of [link.result,link.left,link.right])snapshots.add(snapshot);
            chain.push(link);links.add(link);geometry=link.left.geometry;
          }
          return {ancestor:geometry,chain};
        };
        const traces=geometries.map(trace);
        const operandSnapshots=geometries.map((geometry,index)=>capture(geometry,inputs[index]));
        operandSnapshots.forEach(snapshot=>snapshots.add(snapshot));
        rejected||=validateSnapshots(snapshots);
        let method='exact-subtraction-cutter';
        if(!rejected)provenEmpty=traces.some((trace,index)=>trace.chain.some(link=>link.right.geometry===geometries[1-index]));
        if(!rejected&&!provenEmpty){
          const ancestors=traces.map(trace=>trace.ancestor);
          if(ancestors.some((geometry,index)=>geometry!==geometries[index])){
            try{
              // Accept only an actually empty native result. A nonempty raw
              // artifact is not evidence, and a failed witness keeps the
              // original operation failed. No normalization or retry follows.
              const witness=clipper.intersection(...ancestors.map(coordinates));
              provenEmpty=Array.isArray(witness)&&witness.length===0;
              method='native-empty-ancestor';
            }catch{/* The original failure below remains authoritative. */}
          }
        }
        // A custom clipper must not mutate an operand while producing its
        // witness. Recheck before accepting the proof as well as on reuse.
        if(provenEmpty){rejected=validateSnapshots(snapshots);provenEmpty=!rejected;}
        if(provenEmpty){
          const relation=operation.slice(operation.indexOf(' ')+1).split(' / ');
          const audit={entityId:relation[0],kind:'certified-empty-intersection-recovery',relatedIds:[relation[1]],operation,
            nativeError:{message:error.message,code:error.code||null},
            proof:{method,operandSha256:operandSnapshots.map(snapshot=>snapshot.sha256),
              ancestorSha256:traces.map(trace=>capture(trace.ancestor).sha256),
              subtractionDepths:traces.map(trace=>trace.chain.length),precisionDiscardCount:0,
              nativeWitnessComponents:method==='native-empty-ancestor'?0:null,
              certificates:[...links].map(link=>({resultSha256:link.result.sha256,leftSha256:link.left.sha256,rightSha256:link.right.sha256}))}};
          recovery={operands:geometries.slice(),snapshots:[...snapshots],audit,error};
          adjustments.push(structuredClone(audit));
        }
      }
      if(provenEmpty)raw=[];
      else{
      // Input dimensions identify the minimal failing source pair without
      // logging private geometry or converting a Boolean failure to an empty map.
        throw booleanFailure(error,operation,inputs,rejected);
      }
    }
    const geometry=shape(raw,operation);
    if(name==='difference'&&geometries.length===2&&geometry&&geometry!==geometries[0]
        &&discardedPrecisionComponents===precisionOffset&&sourceSnapshots.every(Boolean)){
      const result=capture(geometry);
      if(result)certificates.links.set(geometry,Object.freeze({result,left:sourceSnapshots[0],right:sourceSnapshots[1]}));
    }
    const entry={geometry,precision:adjustments.slice(offset).filter(row=>row.kind==='certified-clipping-precision-artifact')};
    cache.operations.set(key,entry);
    if(recovery)certificates.recoveries.set(key,{...recovery,entry});
    else certificates?.recoveries.delete(key);
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
      // Capture immutable original peers before any candidate is changed.
      // The intersection decides significance, not the subtraction boundary:
      // sweeping its calculated border again can fail even for valid inputs.
      overlaps.get(row.entityId).push({ sourceGeometry: peer.geometry, entityId: peer.entityId });
    }
  }
  for (const row of candidates) if (overlaps.has(row.entityId)) {
    const parts = overlaps.get(row.entityId);
    // A \\ union(A intersect B_i) = A \\ union(B_i). Use the same significant
    // original peers from the start instead of re-sweeping intersection
    // fragments and abandoning a failed subtraction. Three-way overlaps stay
    // gaps; component splitting, native arithmetic and every precision record
    // keep their existing owner and budget. A failed operation is not retried.
    const union=evaluate('union',parts.map(part=>part.sourceGeometry),`original-peer-union ${row.entityId}`);
    const geometry=difference(row.geometry,union);
    replace(row,geometry,'unknown-peer-overlap',parts.map(part=>part.entityId).sort());
  }
  clipChildren();
  return { candidates: candidates.filter(row => row.geometry), adjustments };
}
