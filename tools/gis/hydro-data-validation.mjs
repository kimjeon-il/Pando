// Scoped checks are the default; a complete catalogue requires an explicit CLI flag.
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {loadCompleteHydroFeatures,loadSelectedHydroFeatures} from './hydro-selected-data.mjs';
import {hydroGeometryCoordinates,verifyHydroCoreDelivery,verifyHydroKoreaCoverage,verifyHydroManifestPolicy,verifyHydroRiverGroups,verifyHydroSelectedLakes} from './hydro-pack-decoder.mjs';
import {lineParts,verifyHydroBorderFragments} from './hydro-point-screen-native.mjs';
import {HYDRO_DATA_VERSION} from "../../src/rendering/physical-layer-service.js";

const korea=[124,33,131,43];
function inKorea(row){const b=row?.metadata?.bounds;if(!Array.isArray(b)||b.length!==4||b.some(value=>!Number.isFinite(value)))
  throw Error('Invalid Hydro feature bounds');return !(b[2]/1e6<korea[0]||b[0]/1e6>korea[2]||b[3]/1e6<korea[1]||b[1]/1e6>korea[3]);}
function countryMap(countries,needed){if(!Array.isArray(countries))throw Error('Explicit Natural Earth countries required');
  const result=new Map();for(const country of countries)if(needed.has(country?.id)){if(!country.geometry||result.has(country.id))
    throw Error('Invalid or duplicate selected Natural Earth country');result.set(country.id,country.geometry);}return result;}
async function verifyBorders(features,countries,{pointScreen={},signal}={},requiredPairs=[]){
  const aligned=features.filter(row=>row.metadata.category==='river'&&(row.metadata.flags&1)!==0),groups=new Map();
  for(const row of aligned){const match=typeof row.metadata.source==='string'&&row.metadata.source.match(/Natural Earth border ([A-Z]{3}\/[A-Z]{3})$/);
    if(!match||row.metadata.flags!==1)throw Error('Invalid Hydro border source or flags');
    if(!groups.has(match[1]))groups.set(match[1],[]);groups.get(match[1]).push(row);}
  for(const pair of requiredPairs)if(!aligned.some(row=>inKorea(row)&&row.metadata.source.endsWith(' '+pair)))throw Error('Required Korea Hydro border pair missing: '+pair);
  const geometries=countryMap(countries,new Set([...groups.keys()].flatMap(pair=>pair.split('/'))));
  const results=[];for(const [pair,rows] of [...groups].sort(([a],[b])=>a.localeCompare(b))){const [left,right]=pair.split('/');
    if(!geometries.has(left)||!geometries.has(right))throw Error('Hydro border country is missing');
    let batch=[],points=0,total=0,maximum=0;const flush=async()=>{if(!batch.length)return;
      const result=await verifyHydroBorderFragments({left:geometries.get(left),right:geometries.get(right),pair,features:batch},{...pointScreen,signal});
      total+=result.points;maximum=Math.max(maximum,result.maxDistanceDegrees);batch=[];points=0;};
    for(const row of rows)for(const part of lineParts(row.geometry)){if(!Array.isArray(part)||!part.length)throw Error('Border fragment points required');
      for(let at=0;at<part.length;at+=200000){const coordinates=part.slice(at,at+200000);if(points+coordinates.length>200000)await flush();
        batch.push({metadata:row.metadata,geometry:{type:'LineString',coordinates}});points+=coordinates.length;}}
    await flush();results.push({pair,fragments:rows.length,points:total,maxDistanceDegrees:maximum});}
  return {results,count:aligned.length};
}
export async function verifyHydroCompleteCatalog({dataset,originalLakes,countries,version,expectedLakeCount=1355,expectedLakeCoordinateCount=162852}={},options={}){
  options.signal?.throwIfAborted();const {manifest,manifestBytes,features,packCount,logicalCount,core}=dataset??{};
  if(!manifest||!Array.isArray(features)||!Buffer.isBuffer(core)||!Buffer.isBuffer(originalLakes))throw Error('Explicit complete Hydro data and original lakes required');
  const delivery=verifyHydroManifestPolicy({manifest,version,manifestBytes,packCount,logicalCount});
  const coreResult=await verifyHydroCoreDelivery({data:core,sha256:manifest.metadata.core.sha256,featureCount:manifest.metadata.featureCount},
    {gzip:options.gzip,directory:options.encodingDirectory,signal:options.signal});
  const lakes=verifyHydroSelectedLakes({features:features.filter(row=>row.metadata.category==='lake'),original:originalLakes,
    sha256:manifest.sources?.naturalEarthLakes?.sha256,expectedLakeCount,expectedCoordinateCount:expectedLakeCoordinateCount});
  const rivers=verifyHydroRiverGroups(features.filter(row=>row.metadata.category==='river')),koreaResult=verifyHydroKoreaCoverage(features);
  if(features.length!==manifest.stats.featureCount||new Set(features.map(row=>row.metadata.fid)).size!==features.length||
    new Set(features.map(row=>row.metadata.logicalFid)).size!==manifest.stats.logicalFeatureCount)throw Error('Hydro feature or logical count differs');
  if(features.reduce((sum,row)=>sum+hydroGeometryCoordinates(row.geometry),0)!==manifest.stats.coordinateCount)
    throw Error('Hydro coordinate count differs');
  const border=await verifyBorders(features,countries,options,['CHN/PRK','PRK/RUS']);
  if(!border.count||!Number.isFinite(manifest.stats.borderAlignedReachCount)||manifest.stats.borderAlignedReachCount<border.count)
    throw Error('Hydro border alignment count differs');
  options.signal?.throwIfAborted();return {delivery,core:coreResult,lakes,rivers,korea:koreaResult,borders:border.results};
}
export async function verifySelectedKoreaHydro({directory,countries}={},options={}){
  const selected=await loadSelectedHydroFeatures({directory,bounds:korea,signal:options.signal});
  if(selected.version!==HYDRO_DATA_VERSION)throw Error('Hydro dataset version differs from the active viewer');
  const koreaResult=verifyHydroKoreaCoverage(selected.features),rivers=verifyHydroRiverGroups(selected.features.filter(row=>row.metadata.category==='river'));
  const local=selected.features.filter(inKorea),border=await verifyBorders(local,countries,options,['CHN/PRK','PRK/RUS']);
  return {selectedFeatures:selected.features.length,logicalSystems:selected.logicalFids.length,shards:selected.shards,korea:koreaResult,rivers,borders:border.results};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const controller=new AbortController(),abort=()=>controller.abort();process.once('SIGINT',abort);process.once('SIGTERM',abort);
  try{const {values,positionals}=parseArgs({allowPositionals:true,options:{directory:{type:'string'},countries:{type:'string'},
    lakes:{type:'string'},all:{type:'boolean'},korea:{type:'boolean'}}});
    if(positionals.length||!values.directory||!values.countries||Boolean(values.all)===Boolean(values.korea)||values.all&&!values.lakes)
      throw Error('Specify --directory, --countries and exactly one of --korea or --all; --all also requires --lakes');
    const source=JSON.parse(await readFile(values.countries,{encoding:'utf8',signal:controller.signal}));
    if(source?.type!=='FeatureCollection'||!Array.isArray(source.features))throw Error('Invalid Natural Earth countries');
    const pointScreen={};if(process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY)pointScreen.directory=process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY;
    if(process.env.PANDO_HYDRO_RUNTIME_ROOT)pointScreen.runtimeRoot=process.env.PANDO_HYDRO_RUNTIME_ROOT;
    const options={pointScreen,encodingDirectory:process.env.PANDO_HYDRO_ENCODING_DIRECTORY,signal:controller.signal};let result;
    if(values.korea)result=await verifySelectedKoreaHydro({directory:values.directory,countries:source.features},options);
    else{const dataset=await loadCompleteHydroFeatures({directory:values.directory,acknowledgeWholeCatalog:true,signal:controller.signal});
      result=await verifyHydroCompleteCatalog({dataset,originalLakes:await readFile(values.lakes,{signal:controller.signal}),
        countries:source.features,version:HYDRO_DATA_VERSION},options);}
    console.log(JSON.stringify(result));
  }catch(error){console.error('hydro-data-validation: '+error.message);process.exitCode=1;}
  finally{process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);}
}
