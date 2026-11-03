import { padBoundaryBounds } from './boundary-spatial-index.js';

// A conservative spatial broad phase for the existing C++ contact kernel.
// Each native pair consumes only source edges whose already-verified C++
// geographic edge boxes intersect the opposing feature's entire bounds.
// Never simplify, resample, reorder or modify a source edge.
const safeBounds = bounds => Array.isArray(bounds) && bounds.length===4 &&
  bounds.every(value=>Number.isFinite(value)) &&
  bounds[0]<=bounds[2] && bounds[1]<=bounds[3];

export function selectCountryContactRows(features,activePairs) {
  const selections=features.map(()=>new Set()), full=new Set();
  let queries=0, fallbackPairs=0, emptyPairs=0;
  for(const [leftIndex,rightIndex] of activePairs) {
    const left=features[leftIndex],right=features[rightIndex];
    if(full.has(leftIndex)&&full.has(rightIndex))continue;
    let fromLeft=null,fromRight=null;
    if (safeBounds(left?.bounds) && safeBounds(right?.bounds) &&
      typeof left?.spatialIndex?.query==='function' &&
      typeof right?.spatialIndex?.query==='function') {
      // source bounds may be conservative across +/-180, but must never be
      // narrowed to only a new sovereign's rendered rectangle.
      fromLeft=left.spatialIndex.query(padBoundaryBounds(right.bounds));
      fromRight=right.spatialIndex.query(padBoundaryBounds(left.bounds));
      queries+=2;
    }
    // Missing/invalid query metadata is not proof of disjoint geometry.
    // An empty *verified spatial query*, in contrast, proves that no source
    // edge in this pair can intersect the other's entire geographic bounds.
    // Keep other pairs in the same batch independent rather than making one
    // distant candidate force both countries' full coastlines into native.
    if(!Array.isArray(fromLeft) || !Array.isArray(fromRight)) {
      full.add(leftIndex);full.add(rightIndex);fallbackPairs++;
      continue;
    }
    if(!fromLeft.length || !fromRight.length) {
      emptyPairs++;
      continue;
    }
    if(!full.has(leftIndex))for(const row of fromLeft)selections[leftIndex].add(row);
    if(!full.has(rightIndex))for(const row of fromRight)selections[rightIndex].add(row);
  }
  const selected=features.map((feature,index)=>full.has(index)?feature.segments:
    feature.segments.filter(row=>selections[index].has(row)));
  return {rows:selected,stats:{
    sourceEdges:features.reduce((n,f)=>n+f.segments.length,0),
    selectedEdges:selected.reduce((n,rows)=>n+rows.length,0),
    featureCount:features.length,candidatePairs:activePairs.length,
    spatialQueries:queries,fallbackPairs,emptyPairs,
  }};
}
