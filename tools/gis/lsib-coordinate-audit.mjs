/** Coordinate correspondence only. No boundary generation or country validation. */
import {createHash} from 'node:crypto';
const key=(p,digits)=>digits==null?`${p[0]},${p[1]}`:`${Number(p[0].toFixed(digits))},${Number(p[1].toFixed(digits))}`;
export function coordinateChainHash(points){const a=JSON.stringify(points),b=JSON.stringify([...points].reverse());return createHash('sha256').update(a<b?a:b).digest('hex');}
export function polygonRings(geometry){
 const parts=geometry?.type==='Polygon'?[geometry.coordinates]:geometry?.type==='MultiPolygon'?geometry.coordinates:null;
 if(!parts)throw Error('Explicit polygon geometry required');return parts.flatMap((p,polygonIndex)=>p.map((coordinates,ringIndex)=>({polygonIndex,ringIndex,coordinates})));
}
export function targetCoordinateKeys(geometries,digits=null){const keys=new Set();for(const g of geometries)for(const r of polygonRings(g))for(const p of r.coordinates)keys.add(key(p,digits));return keys;}
export function indexLsibCoordinates(features,targetKeys,{digits=null,excludeCountries=['MCO']}={}){
 const vertices=new Map(),parts=new Map();let sourceVertices=0,excluded=0;
 for(const f of features){const pair=[f.properties.CC1_GENC3,f.properties.CC2_GENC3];if(pair.some(c=>excludeCountries.includes(c))){excluded++;continue;}
 const lines=f.geometry.type==='LineString'?[f.geometry.coordinates]:f.geometry.type==='MultiLineString'?f.geometry.coordinates:null;if(!lines)throw Error('Unexpected LSIB line type');
 lines.forEach((coordinates,part)=>{const id=f.properties.ID+':'+part;parts.set(id,{featureId:f.properties.ID,part,countries:pair,status:f.properties.STATUS,notes:f.properties.NOTES,coordinates,sourceCoordinateHash:coordinateChainHash(coordinates)});sourceVertices+=coordinates.length;
 coordinates.forEach((p,index)=>{const k=key(p,digits);if(!targetKeys.has(k))return;if(!vertices.has(k))vertices.set(k,[]);vertices.get(k).push({id,index});});});
 }return {vertices,parts,digits,sourceVertices,excluded};
}
function consecutiveRuns(matches,stepTest){const runs=[];let run=[];for(const m of matches){if(run.length&&!stepTest(run.at(-1),m,run)){if(run.length>=3)runs.push(run);run=[];}run.push(m);}if(run.length>=3)runs.push(run);return runs;}
export function auditLsibGeometry(geometry,index){
 const chains=[],contacts=[];let ambiguousVertices=0;
 for(const ring of polygonRings(geometry)){
  const groups=new Map();ring.coordinates.forEach((p,targetIndex)=>{for(const match of index.vertices.get(key(p,index.digits))||[]){if(!groups.has(match.id))groups.set(match.id,new Map());const positions=groups.get(match.id);if(!positions.has(targetIndex))positions.set(targetIndex,[]);positions.get(targetIndex).push(match.index);}});
  for(const[id,positions]of groups){const ref=index.parts.get(id),last=ref.coordinates.length-1,closed=key(ref.coordinates[0],index.digits)===key(ref.coordinates[last],index.digits),count=closed?last:last+1;
   const matches=[];for(const[targetIndex,raw]of positions){const options=[...new Set(raw.map(x=>closed&&x===last?0:x))];if(options.length!==1){ambiguousVertices++;continue;}matches.push({targetIndex,referenceIndex:options[0]});}matches.sort((a,b)=>a.targetIndex-b.targetIndex);
   const delta=(a,b)=>{const d=b.referenceIndex-a.referenceIndex;if(closed&&d===count-1)return -1;if(closed&&d===1-count)return 1;return d;};
   const emit=(run,kind)=>{const retainedCoordinates=run.map(m=>ring.coordinates[m.targetIndex]),coordinates=ring.coordinates.slice(run[0].targetIndex,run.at(-1).targetIndex+1),referenceCoordinates=run.map(m=>ref.coordinates[m.referenceIndex]),exactNumeric=retainedCoordinates.every((p,n)=>p[0]===referenceCoordinates[n][0]&&p[1]===referenceCoordinates[n][1]);
    if(index.digits!=null&&exactNumeric)return;
    chains.push({featureId:ref.featureId,part:ref.part,countries:ref.countries,status:ref.status,notes:ref.notes,kind,normalization:index.digits==null?'strict-numeric':`decimal-${index.digits}`,exactNumeric,polygonIndex:ring.polygonIndex,ringIndex:ring.ringIndex,targetStart:run[0].targetIndex,targetEnd:run.at(-1).targetIndex,vertices:coordinates.length,retainedOriginalVertices:run.length,insertedOrDifferentVertices:coordinates.length-run.length,targetMatchedIndices:run.map(m=>m.targetIndex),referenceIndices:run.map(m=>m.referenceIndex),referencePartVertices:ref.coordinates.length,coordinateHash:coordinateChainHash(coordinates),referenceRetainedCoordinateHash:coordinateChainHash(referenceCoordinates),referencePartCoordinateHash:ref.sourceCoordinateHash,coordinates,referenceCoordinates});};
   const raw=consecutiveRuns(matches,(a,b,run)=>b.targetIndex===a.targetIndex+1&&Math.abs(delta(a,b))===1&&(run.length<2||Math.sign(delta(run.at(-2),a))===Math.sign(delta(a,b))));for(const run of raw)emit(run,'consecutive-original-chain');
   const subset=consecutiveRuns(matches,(a,b,run)=>delta(a,b)!==0&&(run.length<2||Math.sign(delta(run.at(-2),a))===Math.sign(delta(a,b))));for(const run of subset)if(run.slice(1).some((m,n)=>Math.abs(delta(run[n],m))>1||m.targetIndex!==run[n].targetIndex+1))emit(run,'retained-original-subsequence');
   if(!raw.length&&!subset.length&&matches.length)contacts.push({featureId:ref.featureId,part:ref.part,countries:ref.countries,matchedVertices:matches.length,interpretation:'isolated points / two-point edges / interrupted or ambiguous order; not counted as an original-detail chain'});
  }
 }
 return {chains,contacts,ambiguousVertices};
}
