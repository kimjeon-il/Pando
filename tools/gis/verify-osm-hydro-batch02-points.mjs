// Named-point proximity screen for Hydro systems 11–20. It does not authorize
// river names, geometry replacement, or source-license conclusions.
import {lstatSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {batch02Anchors} from './hydro-osm-batch02-anchors.mjs';
import {lineParts,roundPython,screenHydroPoints,validatePointScreenResult} from './hydro-point-screen-native.mjs';

function independentSources(gauges,nga){
  const external={},named={};
  if(gauges!==undefined){
    if(gauges?.provenance!=='2023-CA-discharge')throw Error('External gauge provenance mismatch');
    if(!Array.isArray(gauges.gauges))throw Error('External gauges must be an array');
    for(const point of gauges.gauges){const sid=point.candidateSystem;
      if(!['20628098','40188382'].includes(sid))continue;
      if(!Number.isFinite(point.latitude)||!Number.isFinite(point.longitude)||Math.abs(point.latitude)>90||Math.abs(point.longitude)>180)continue;
      (external[sid]??=[]).push({id:'cad_'+String(point.code),name:point.river,lon:point.longitude,lat:point.latitude,
        kind:'CA-discharge-scientific-2023-located-hydromet-gauge',source:'https://zenodo.org/records/7743778'});
    }
  }
  if(nga!==undefined){
    if(!Array.isArray(nga?.features))throw Error('NGA features must be an array');
    const seen=new Set();
    for(const feature of nga.features){const sid=String(feature.candidateSystem||'');
      if(!(sid in batch02Anchors.ngaTargets))continue;
      if(feature.ufi===undefined||feature.ufi===null)throw Error('NGA feature needs its source UFI');
      const id=String(feature.ufi),key=JSON.stringify([sid,id]);if(seen.has(key))continue;seen.add(key);
      if(!Number.isFinite(feature.longitude)||!Number.isFinite(feature.latitude))continue;
      (named[sid]??=[]).push({id:'nga_'+id,name:feature.name||feature.ufi,lon:feature.longitude,lat:feature.latitude,
        kind:'US-NGA-GNS-named-stream-feature-point',source:batch02Anchors.ngaUrl});
    }
  }
  return {external,named};
}
export async function buildBatch02Screen(decoded,{screen,gauges,nga}={}){
  const manifest=decoded?.manifest;
  if(manifest?.version!=='0.13.2'||manifest.metadata?.featureCount!==16548)throw Error('Unexpected published Hydro version or geometry population');
  if(!Array.isArray(decoded.features)||typeof screen!=='function')throw Error('Decoded Hydro features and native screen are required');
  const systems=new Map(batch02Anchors.ids.map(id=>[id,[]]));
  for(const feature of decoded.features){const id=String(feature?.metadata?.systemId||'');
    if(systems.has(id)&&feature.metadata.role==='mainstem')systems.get(id).push(feature);
  }
  if([...systems.values()].some(features=>!features.length))throw Error('Missing original mainstem systems');
  const {external,named}=independentSources(gauges,nga),items=[];
  for(const [id,features] of systems){
    const live=named[id]||[],staticPoints=(batch02Anchors.static[id]||[])
      .filter(point=>!(live.length&&point.kind==='US-NGA-GNS-named-stream-location-not-centerline'));
    const seen=new Set(),anchors=[...staticPoints,...(external[id]||[]),...live].filter(point=>{
      const key=JSON.stringify([point.id,point.lon,point.lat]);if(seen.has(key))return false;seen.add(key);return true;
    });
    const lines=[];for(const feature of features)for(const line of lineParts(feature.geometry))if(Array.isArray(line)&&line.length>=2)lines.push(line);
    if(!lines.length)throw Error('No nonempty mainstem for '+id);
    const native=await screen({crs:batch02Anchors.crs[id],mode:'parts',lines,points:anchors.map(point=>[point.lon,point.lat])});
    validatePointScreenResult(native,lines.length,anchors.length,{allowFilteredLines:true});
    const independentPoints=anchors.map((point,index)=>({id:point.id,designatedName:point.name,sourceKind:point.kind,independentSource:point.source,
      referenceLonLat:[point.lon,point.lat],distanceToPublishedMainstemKm:roundPython(native.points[index].distanceMeters/1000,3),
      nearestHydroLonLat:native.points[index].nearestLonLat.map(value=>roundPython(value,6))}));
    items.push({mainstemFeatureCount:features.length,lineSegments:native.lineLengthsMeters.length,
      mainstemTotalLengthKm:roundPython(native.lineLengthsMeters.reduce((sum,value)=>sum+value,0)/1000,3),independentPoints,
      systemId:id,publishedNameKo:features[0].metadata.name,pointScreenHasWholeRiverAuthority:false});
  }
  return {schema:'pando-independent-osm-hydro-batch02-point-screen-v1',originalVersion:'0.13.2',originalBundleSha256:manifest.container.sha256,
    publishedRiverNameMetadataChanged:false,publishedHydroGeometryChanged:false,osmRelationUsedAsReference:false,
    studyCount:items.length,pointsCompared:items.reduce((sum,item)=>sum+item.independentPoints.length,0),
    method:'Original published HydroRIVERS mainstem -> independent named points, metric local UTM nearest-geodesic approximation',
    caveat:'Only proximity. NGA points may be mouth-level approximate; SCA marinas are off-center facilities; ecological area centroid is NOT a gauging site. No rename authorization.',
    externalGaugesAvailable:Object.keys(external).length>0,externalGaugeCounts:Object.fromEntries(Object.entries(external).map(([id,points])=>[id,points.length])),
    ngaResultsAvailable:Object.keys(named).length>0,ngaCounts:Object.fromEntries(Object.entries(named).map(([id,points])=>[id,points.length])),items};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const {values}=parseArgs({options:{decoded:{type:'string'},output:{type:'string'},'native-directory':{type:'string'},'osgeo-root':{type:'string'},
      'external-gauges':{type:'string'},nga:{type:'string'}}});
    if(!values.decoded||!values.output)throw Error('--decoded INPUT --output NEW_OUTPUT [--external-gauges FILE] [--nga FILE] required');
    const output=resolve(values.output);
    try{lstatSync(output);throw Error('Output already exists; preserve it');}catch(error){if(error.code!=='ENOENT')throw error;}
    const read=path=>path===undefined?undefined:JSON.parse(readFileSync(resolve(path),'utf8'));
    const result=await buildBatch02Screen(read(values.decoded),{gauges:read(values['external-gauges']),nga:read(values.nga),
      screen:input=>screenHydroPoints(input,{directory:values['native-directory'],runtimeRoot:values['osgeo-root']})});
    mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
    console.log('HYDRO_BATCH02_PROOF='+JSON.stringify({points:result.pointsCompared,externalGaugesAvailable:result.externalGaugesAvailable,
      externalGaugeCounts:result.externalGaugeCounts,ngaResultsAvailable:result.ngaResultsAvailable,ngaCounts:result.ngaCounts,
      items:result.items.map(item=>({id:item.systemId,name:item.publishedNameKo,lengthKm:item.mainstemTotalLengthKm,
        points:item.independentPoints.map(point=>[point.id,point.distanceToPublishedMainstemKm,point.designatedName]),
        closestPoints:item.independentPoints.map(point=>({id:point.id,distanceKm:point.distanceToPublishedMainstemKm,name:point.designatedName,
          referenceLonLat:point.referenceLonLat,sourceKind:point.sourceKind,url:point.independentSource})).sort((a,b)=>a.distanceKm-b.distanceKm).slice(0,12)}))}));
  }catch(error){console.error('hydro-batch02-point-screen: '+error.message);process.exitCode=1;}
}
