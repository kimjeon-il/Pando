// Reassemble Natural Earth river rows before selecting their guide lines.
import {buildHydroLogicalChains} from './hydro-connectivity-native.mjs';
import {findHydroReferenceGuides,longestHydroSourceLines,scoreHydroGuidedBranches,scoreHydroReferenceNameCandidates,selectHydroUpstreams} from './hydro-point-screen-native.mjs';
function lineParts(geometry){
  const parts=geometry?.type==='LineString'?[geometry.coordinates]:geometry?.type==='MultiLineString'?geometry.coordinates:[];
  if(!Array.isArray(parts))throw Error('Invalid Hydro reference geometry');
  return parts.map(part=>{
    if(!Array.isArray(part))throw Error('Invalid Hydro reference line');
    return part.map(point=>{
      if(!Array.isArray(point)||point.length<2||!Number.isFinite(Number(point[0]))||!Number.isFinite(Number(point[1])))
        throw Error('Invalid Hydro reference coordinate');
      return [Number(point[0]),Number(point[1])];
    });
  });
}
export function prepareHydroReferenceGuides(rows){
  if(!Array.isArray(rows))throw Error('Explicit Hydro reference rows required');
  const groups=new Map();
  for(let i=0;i<rows.length;i++){
    const row=rows[i],properties=row?.properties??{};
    if(!row||typeof properties!=='object'||Array.isArray(properties))throw Error('Invalid Hydro reference feature');
    const key=String(properties.pandolab_id||row.id||`ne-river-row:${i}`);
    if(!groups.has(key))groups.set(key,{feature:{type:'Feature',id:key,properties:structuredClone(properties),geometry:null},parts:[]});
    const group=groups.get(key),current=group.feature.properties;for(const part of lineParts(row.geometry))group.parts.push(part);
    const currentZoom=Number(current.min_zoom??99),rowZoom=Number(properties.min_zoom??99);
    const currentWidth=Number(current.stroke_width||0),rowWidth=Number(properties.stroke_width||0);
    if([currentZoom,rowZoom,currentWidth,rowWidth].some(value=>!Number.isFinite(value)))throw Error('Invalid Hydro reference display metadata');
    current.min_zoom=Math.min(currentZoom,rowZoom);current.stroke_width=Math.max(currentWidth,rowWidth);
    for(const name of ['name_ko','name_en','name'])if(!current[name]&&properties[name])current[name]=properties[name];
  }
  const features=[],lines=[],names=[];
  for(const {feature,parts} of groups.values()){
    feature.geometry=parts.length===1?{type:'LineString',coordinates:parts[0]}:{type:'MultiLineString',coordinates:parts};
    features.push(feature);const name=String(feature.properties.name_ko||feature.properties.name_en||feature.properties.name||'').trim();
    for(const part of parts)if(part.length>=2){lines.push(part);names.push(name);}
  }
  return {features,lines,names};
}
// Select canonical confluences from explicit selected reaches and reference rows.
export async function assembleHydroCanonicalChains({reaches,references}={},options={}){
  options.signal?.throwIfAborted();
  if(!Array.isArray(reaches)||reaches.length>1000000||!Array.isArray(references))throw Error('Explicit Hydro reaches and references required');
  const byId=new Map(),upstreams=new Map();
  for(const row of reaches){
    if(!Number.isSafeInteger(row?.id)||row.id<=0||byId.has(row.id)||!Number.isSafeInteger(row.next)||row.next<0||
      !Number.isSafeInteger(row.mainRiver)||!Number.isSafeInteger(row.order)||!Number.isFinite(row.flow)||
      !Number.isFinite(row.upstreamArea)||!Array.isArray(row.parts)||
      (row.renderSnap!=null&&(!Array.isArray(row.renderSnap)||row.renderSnap.length!==2||
        row.renderSnap.some((value,i)=>!Number.isFinite(value)||Math.abs(value)>(i===0?180:90)))))
      throw Error('Invalid Hydro canonical reach');
    byId.set(row.id,row);
  }
  for(const row of reaches){if(!row.next)continue;if(!byId.has(row.next))throw Error('Selected Hydro downstream is missing');
    if(!upstreams.has(row.next))upstreams.set(row.next,[]);upstreams.get(row.next).push(row);}
  const ids=[...upstreams.keys()],needed=new Set(ids);
  for(const rows of upstreams.values())for(const row of rows)needed.add(row.id);
  const neededRows=[...needed].map(id=>byId.get(id)),lines=new Map(),geometryOptions={...options.pointScreen};
  if(options.signal)geometryOptions.signal=options.signal;
  for(let at=0;at<neededRows.length;at+=1000){const batch=neededRows.slice(at,at+1000);
    const sourceParts=batch.map(row=>row.parts.map((part,i)=>row.renderSnap!=null&&i===row.parts.length-1&&Array.isArray(part)&&part.length>=2?
      [...part.slice(0,-1),row.renderSnap]:part));
    const selected=await longestHydroSourceLines(sourceParts,geometryOptions);
    for(let i=0;i<batch.length;i++)lines.set(batch[i].id,selected[i]);}
  const guides=prepareHydroReferenceGuides(references),guideById=new Map();
  if(guides.lines.length)for(let at=0;at<ids.length;at+=1000){const batch=ids.slice(at,at+1000);
    const matches=await findHydroReferenceGuides({references:guides.lines,queries:batch.map(id=>lines.get(id)??[]),maxDistance:.22},geometryOptions);
    for(let i=0;i<batch.length;i++)if(matches[i])guideById.set(batch[i],guides.lines[matches[i].index]);}
  const groups=[],branchInputs=[],branchOwners=[];
  for(const id of ids){const downstream=byId.get(id),candidates=upstreams.get(id),same=candidates.some(row=>row.mainRiver===downstream.mainRiver);
    let largest=-Infinity;for(const row of candidates)if(!same||row.mainRiver===downstream.mainRiver)largest=Math.max(largest,row.upstreamArea);
    const group={basin:downstream.mainRiver,candidates:candidates.map(row=>({id:row.id,basin:row.mainRiver,area:row.upstreamArea,
      flow:row.flow,order:row.order,score:null,alignment:null}))};groups.push(group);
    const guide=guideById.get(id),current=lines.get(id);if(!guide||!current)continue;
    for(let i=0;i<candidates.length;i++){const row=candidates[i],candidate=lines.get(row.id);
      if((same&&row.mainRiver!==downstream.mainRiver)||row.upstreamArea<largest*.10||!candidate)continue;
      branchInputs.push({current,candidate,reference:guide});branchOwners.push(group.candidates[i]);}
  }
  for(let at=0;at<branchInputs.length;at+=1000){const scores=await scoreHydroGuidedBranches(branchInputs.slice(at,at+1000),geometryOptions);
    for(let i=0;i<scores.length;i++)Object.assign(branchOwners[at+i],scores[i]);}
  const choices=[];
  for(let at=0;at<groups.length;at+=1000){const batch=groups.slice(at,at+1000);
    const selected=await selectHydroUpstreams(batch,{...geometryOptions,kind:'canonical'});
    for(let i=0;i<selected.length;i++)choices.push({downstream:ids[at+i],upstream:selected[i]});}
  const connectivityOptions={...options.connectivity};if(options.signal)connectivityOptions.signal=options.signal;
  const result=await buildHydroLogicalChains({reaches:reaches.map(row=>({id:row.id,next:row.next})),canonical:choices},connectivityOptions);
  return result.chains;
}
// Natural Earth names are assigned before border alignment, one chain per name.
export async function matchHydroReferenceNames({chains,references,bounds}={},options={}){
  options.signal?.throwIfAborted();if(!Array.isArray(chains)||chains.some(chain=>!Array.isArray(chain))||!Array.isArray(references))
    throw Error('Explicit Hydro chains and reference features required');
  const guides=prepareHydroReferenceGuides(references).features.map(feature=>({
    name:String(feature.properties.name_ko||feature.properties.name_en||feature.properties.name||'').trim(),geometry:feature.geometry})).filter(row=>row.name);
  const input=chains.map((chain,index)=>({index,area:chain.length?chain.reduce((value,row)=>Math.max(value,row.upstreamArea),-Infinity):0,
    parts:chain.flatMap(row=>row.parts.filter(part=>part.length>=2))}));
  if(input.some(row=>!Number.isFinite(row.area)))throw Error('Invalid Hydro naming basin area');
  const best=new Map();for(let at=0;at<input.length;at+=1000){const rows=await scoreHydroReferenceNameCandidates({bounds,references:guides,
    chains:input.slice(at,at+1000)},options);
    for(const row of rows){if(!row)continue;const previous=best.get(row.name);
      if(!previous||row.area>previous.area||(row.area===previous.area&&(row.distance<previous.distance||
        (row.distance===previous.distance&&(row.alignment>previous.alignment||
          (row.alignment===previous.alignment&&row.index<previous.index))))))best.set(row.name,row);}}
  return Object.fromEntries([...best.values()].map(row=>[row.index,row.name]));
}
