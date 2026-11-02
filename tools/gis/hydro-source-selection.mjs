// Select a region's source topology before geometry assembly and outlet repair.
import {prepareHydroReferenceGuides} from './hydro-reference-guides.mjs';
import {findHydroReferenceGuides,longestHydroSourceLines,scoreHydroGuidedBranches,selectHydroUpstreams} from './hydro-point-screen-native.mjs';

export async function selectHydroSourceTopology({selection,reader,references}={},options={}){
  options.signal?.throwIfAborted();
  if(!selection?.roots||typeof selection.records!=='function'||typeof selection.candidates!=='function'||
    typeof reader?.read!=='function'||!Array.isArray(references))throw Error('Explicit Hydro selection, indexed reader and references required');
  const {seeds,continuityRoots,namedCandidates,mediumRoots}=selection.roots;
  if([seeds,continuityRoots,namedCandidates,mediumRoots].some(ids=>!Array.isArray(ids)))throw Error('Invalid Hydro topology roots');
  const geometryOptions={...options.pointScreen};if(options.signal)geometryOptions.signal=options.signal;
  const referenceLines=prepareHydroReferenceGuides(references).lines,cache=new Map();
  const records=async ids=>{const output=[];for(let at=0;at<ids.length;at+=4096)output.push(...await selection.records(ids.slice(at,at+4096)));return output;};
  const sourceLines=async rows=>{
    const missing=[],seen=new Set();for(const row of rows)if(row&&!cache.has(row.id)&&!seen.has(row.id)){missing.push(row);seen.add(row.id);}
    for(let at=0;at<missing.length;at+=1000){const batch=missing.slice(at,at+1000),shapes=await reader.read(batch.map(row=>({id:row.id,recordIndex:row.recordIndex})));
      if(shapes.length!==batch.length||shapes.some((shape,index)=>shape.id!==batch[index].id))throw Error('Hydro indexed source shape differs');
      const lines=await longestHydroSourceLines(shapes.map(shape=>shape.parts),geometryOptions);
      for(let i=0;i<batch.length;i++){cache.set(batch[i].id,lines[i]);if(cache.size>12000)cache.delete(cache.keys().next().value);}}
    return rows.map(row=>row?cache.get(row.id)??null:null);
  };
  const named=[];
  for(let at=0;referenceLines.length&&at<namedCandidates.length;at+=1000){const ids=namedCandidates.slice(at,at+1000),rows=await records(ids);
    if(rows.some(row=>!row))throw Error('Hydro named root metadata missing');
    const lines=await sourceLines(rows),matches=await findHydroReferenceGuides({references:referenceLines,
      queries:lines.map(line=>line??[]),maxDistance:.06},geometryOptions);
    for(let i=0;i<ids.length;i++)if(matches[i])named.push(ids[i]);}
  const selected=new Set(seeds),continuity=[...continuityRoots,...named];
  const choose=async ids=>{
    if(ids.length>1000){const result=[];for(let at=0;at<ids.length;at+=1000)result.push(...await choose(ids.slice(at,at+1000)));return result;}
    const groups=await selection.candidates(ids);
    if(groups.some(group=>!group.current))throw Error('Hydro upstream source metadata missing');
    const lines=referenceLines.length?await sourceLines(groups.map(group=>group.current)):groups.map(()=>null);
    const matches=referenceLines.length?await findHydroReferenceGuides({references:referenceLines,queries:lines.map(line=>line??[]),maxDistance:.22},geometryOptions):groups.map(()=>null);
    const scoredRows=[];for(let i=0;i<groups.length;i++){const group=groups[i],same=group.candidates.some(row=>row.mainRiver===group.current.mainRiver);
      const pool=group.candidates.filter(row=>!same||row.mainRiver===group.current.mainRiver);
      const largest=pool.reduce((value,row)=>Math.max(value,row.upstreamArea),-Infinity);
      if(matches[i]&&lines[i])for(const row of pool)if(row.upstreamArea>=largest*.10)scoredRows.push({group:i,row});}
    const candidateLines=await sourceLines(scoredRows.map(item=>item.row)),branches=[],owners=[];
    for(let i=0;i<scoredRows.length;i++)if(candidateLines[i]){const item=scoredRows[i];branches.push({current:lines[item.group],candidate:candidateLines[i],
      reference:referenceLines[matches[item.group].index]});owners.push(item);}
    const scores=new Map();for(let at=0;at<branches.length;at+=1000){const batch=await scoreHydroGuidedBranches(branches.slice(at,at+1000),geometryOptions);
      for(let i=0;i<batch.length;i++)scores.set(owners[at+i].group+':'+owners[at+i].row.id,batch[i]);}
    const inputs=[],ownersByGroup=[];
    for(let i=0;i<groups.length;i++){const group=groups[i];if(!group.candidates.length)continue;
      inputs.push({basin:group.current.mainRiver,candidates:group.candidates.map(row=>({id:row.id,basin:row.mainRiver,order:row.order,
        area:row.upstreamArea,flow:row.flow,...(scores.get(i+':'+row.id)??{score:null,alignment:null})}))});ownersByGroup.push(i);}
    const choices=Array(groups.length).fill(0);for(let at=0;at<inputs.length;at+=1000){const chosen=await selectHydroUpstreams(inputs.slice(at,at+1000),
      {...geometryOptions,kind:'guided'});for(let i=0;i<chosen.length;i++)choices[ownersByGroup[at+i]]=chosen[i];}return choices;
  };
  let frontier=continuity;
  while(frontier.length){options.signal?.throwIfAborted();const choices=await choose(frontier),next=[];
    for(const id of choices)if(id&&!selected.has(id)){selected.add(id);next.push(id);}frontier=next;}
  let mediumAdded=0;frontier=[...mediumRoots];const mediumVisited=new Set();
  while(frontier.length){options.signal?.throwIfAborted();const active=[];for(const id of frontier)if(!mediumVisited.has(id)){
      mediumVisited.add(id);active.push(id);if(!selected.has(id)){selected.add(id);mediumAdded++;}}
    frontier=active.length?(await choose(active)).filter(Boolean):[];}
  let downstreamAdded=0;frontier=[...selected];
  while(frontier.length){options.signal?.throwIfAborted();const rows=await records(frontier);if(rows.some(row=>!row))throw Error('Hydro selected source metadata missing');
    const wanted=[...new Set(rows.map(row=>row.next).filter(id=>id&&!selected.has(id)))],nextRows=await records(wanted),next=[];
    for(const row of nextRows)if(row&&!selected.has(row.id)){selected.add(row.id);next.push(row.id);downstreamAdded++;}frontier=next;}
  const finalRows=await records([...selected]);if(finalRows.some(row=>!row))throw Error('Hydro selected source metadata missing');
  finalRows.sort((a,b)=>a.recordIndex-b.recordIndex);
  return {ids:finalRows.map(row=>row.id),stats:{seedReachCount:seeds.length,continuityRootCount:continuity.length,namedContinuityRootCount:named.length,
    mediumMainstemRootCount:mediumRoots.length,mediumMainstemReachCount:mediumAdded,downstreamClosureReachCount:downstreamAdded}};
}
