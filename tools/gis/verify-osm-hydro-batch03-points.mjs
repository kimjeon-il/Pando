// Read-only named-point screen for the final eleven Hydro systems. Neither
// an unavailable query nor proximity is a river-identity approval.
import {lstatSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {batch03Anchors} from './hydro-osm-batch03-anchors.mjs';
import {lineParts,screenHydroPoints,validatePointScreenResult} from './hydro-point-screen-native.mjs';
import {pythonRound} from './hydro-numeric.mjs';
import {probeNgaBatch03} from './probe-nga-streams.mjs';

export async function buildBatch03Screen(decoded,{receipts,screen,signal}={}){
  signal?.throwIfAborted();const manifest=decoded?.manifest;
  if(manifest?.version!=='0.13.2'||manifest.metadata?.featureCount!==16548)throw Error('Unexpected published Hydro geometry baseline');
  if(!Array.isArray(decoded.features)||typeof screen!=='function')throw Error('Decoded Hydro features and native screen are required');
  const expected=[...batch03Anchors.ids.map(id=>[id,'name-and-competing-names']),
    ...['41386179','41386700'].map(id=>[id,'all-streams-in-small-bbox'])];
  if(!Array.isArray(receipts)||receipts.length!==expected.length||receipts.some((row,index)=>!row||
    row.systemId!==expected[index][0]||row.kind!==expected[index][1]||!['queried','not-confirmed'].includes(row.status)||!Array.isArray(row.features)))
    throw Error('Invalid NGA query receipts');
  const systems=new Map(batch03Anchors.ids.map(id=>[id,[]]));
  for(const feature of decoded.features){const id=String(feature?.metadata?.systemId||'');
    if(systems.has(id)&&feature.metadata.role==='mainstem')systems.get(id).push(feature);
  }
  if([...systems.values()].some(features=>!features.length))throw Error('Missing any Hydro mainstem from eleven selected systems');
  const bySystem=new Map(batch03Anchors.ids.map(id=>[id,[]]));
  for(const receipt of receipts)bySystem.get(receipt.systemId).push(...receipt.features);
  const items=[];
  for(const [id,features] of systems){
    signal?.throwIfAborted();const unique=new Map();
    for(const anchor of [...(batch03Anchors.external[id]||[]),...bySystem.get(id)]){
      if(!anchor||typeof anchor.id!=='string'||!Number.isFinite(anchor.lon)||!Number.isFinite(anchor.lat))throw Error('Invalid independent point');
      const key=JSON.stringify([anchor.id,pythonRound(anchor.lon,6),pythonRound(anchor.lat,6)]);
      if(!unique.has(key))unique.set(key,{...anchor,...(Array.isArray(anchor.names)?{names:[...anchor.names]}:{})});
      else if(Array.isArray(anchor.names)&&anchor.names.length){const prior=unique.get(key);prior.names??=[];
        for(const name of anchor.names)if(!prior.names.includes(name))prior.names.push(name);}
    }
    const anchors=[...unique.values()],lines=[];
    for(const feature of features)for(const line of lineParts(feature.geometry))if(Array.isArray(line)&&line.length>=2)lines.push(line);
    if(!lines.length)throw Error('No Hydro lines for '+id);
    const native=await screen({crs:batch03Anchors.crs[id],mode:'tree',lines,points:anchors.map(anchor=>[anchor.lon,anchor.lat])},{signal});
    validatePointScreenResult(native,lines.length,anchors.length,{allowFilteredLines:true});
    const observations=anchors.map((anchor,index)=>({pointId:anchor.id,names:Array.isArray(anchor.names)&&anchor.names.length?anchor.names:[anchor.name??null],
      publishedLonLat:[pythonRound(anchor.lon,6),pythonRound(anchor.lat,6)],nearestHydroLonLat:native.points[index].nearestLonLat.map(value=>pythonRound(value,6)),
      distanceKm:pythonRound(native.points[index].distanceMeters/1000,3),featureUfi:anchor.ufi??null,sourceRole:anchor.role,source:anchor.source}));
    observations.sort((a,b)=>a.distanceKm-b.distanceKm);
    items.push({systemId:id,originalNameKo:features[0].metadata.name,mainstemFeatures:features.length,mainstemLineSegments:native.lineLengthsMeters.length,
      mainstemLengthKm:pythonRound(native.lineLengthsMeters.reduce((sum,value)=>sum+value,0)/1000,3),independentPointChecks:observations,
      pointCount:observations.length,pointCountWithin1km:observations.filter(point=>point.distanceKm<=1).length,
      pointCountWithin5km:observations.filter(point=>point.distanceKm<=5).length,candidateIdentityConfirmed:false,riverGeometryEdited:false});
  }
  return {schema:'pando-hydro-osm-remaining-last11-ngo-government-point-screen-v1',baseline:'HydroRIVERS v0.13.2',
    originalBundleSha256:manifest.container.sha256,independentDataSource:'NGA GNS and named agency gazetteer endpoints',
    governmentQueryCount:receipts.length,governmentQueryReceipts:receipts,systemsReviewed:items.length,
    comparedIndependentPoints:items.reduce((sum,item)=>sum+item.pointCount,0),geoDataNotChanged:true,sourceOnlyScreen:true,approvalCount:0,
    limitations:[
      'GNS designated STM named points do not describe full source-to-mouth geometry.',
      'No GNS matches or unavailable queries prove neither nonexistence nor any name conflict.',
      'All-stream searches can reach resultRecordCount limit; record exceededTransferLimit and do not call them exhaustive.',
      'Nearby named rivers at confluences are not proof that all a grouped mainstem has that name.',
      'Official MONRE 2017 Ba Lai termini are river endpoints, NOT Hydro mainstem endpoints.',
      'MLIT Iwabuchi facility is a rainfall gauge on a building roof, NOT a river gauge or centerline.',
    ],items};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const controller=new globalThis.AbortController(),interrupt=()=>controller.abort(Error('Hydro point screen cancelled'));
  process.once('SIGINT',interrupt);
  try{
    const {values}=parseArgs({options:{decoded:{type:'string'},output:{type:'string'},'native-directory':{type:'string'},'osgeo-root':{type:'string'}}});
    if(!values.decoded||!values.output)throw Error('--decoded INPUT --output NEW_OUTPUT [--native-directory DIR] [--osgeo-root DIR] required');
    const output=resolve(values.output);
    try{lstatSync(output);throw Error('Output already exists; preserve it');}catch(error){if(error.code!=='ENOENT')throw error;}
    const decoded=JSON.parse(readFileSync(resolve(values.decoded),'utf8')),receipts=await probeNgaBatch03({signal:controller.signal});
    const result=await buildBatch03Screen(decoded,{receipts,signal:controller.signal,
      screen:(input,options)=>screenHydroPoints(input,{directory:values['native-directory'],runtimeRoot:values['osgeo-root'],...options})});
    controller.signal.throwIfAborted();mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
    console.log('OSM_BATCH03_AUDIT='+JSON.stringify({systems:result.systemsReviewed,pointsCompared:result.comparedIndependentPoints,
      queryStates:receipts.map(row=>({id:row.systemId,kind:row.kind,status:row.status,raw:row.rawFeatureCount??0,unique:row.uniqueRiverPointCount??0,
        limit:row.exceededTransferLimit??false,failureClass:row.failureClass??null})),
      items:result.items.map(row=>({id:row.systemId,currentName:row.originalNameKo,lengthKm:row.mainstemLengthKm,pointCount:row.pointCount,
        within1km:row.pointCountWithin1km,within5km:row.pointCountWithin5km,nearest:row.independentPointChecks.slice(0,14)}))}));
  }catch(error){console.error('hydro-batch03-point-screen: '+error.message);process.exitCode=1;}
  finally{process.removeListener('SIGINT',interrupt);}
}
