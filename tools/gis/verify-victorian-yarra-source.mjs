// Read-only comparison against the Victorian government's named Yarra vector.
// Source geometry is never copied into runtime assets or treated as approval.
import {createHash} from 'node:crypto';
import {lstatSync,mkdirSync,readFileSync,statSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath,URLSearchParams} from 'node:url';
import {parseArgs} from 'node:util';
import {fetchBoundedBytes} from './bounded-source-json.mjs';
import {pythonRound} from './hydro-numeric.mjs';
import {lineParts,screenHydroPoints} from './hydro-point-screen-native.mjs';

const officialLayer='https://spatial.planning.vic.gov.au/server/rest/services/yarra_river_land/MapServer/0';
const sourceUrl=officialLayer+'/query?'+new URLSearchParams({where:'1=1',outFields:'OBJECTID_1,NAME',returnGeometry:'true',outSR:'4326',f:'geojson'});
export async function fetchYarraVector({fetcher=fetch,signal}={}){
  signal?.throwIfAborted();
  const bytes=await fetchBoundedBytes(sourceUrl,{fetcher,signal,timeoutMs:90000,limit:24000000,
    headers:{'User-Agent':'PandoLab-independent-geometry-research/1.0',Accept:'application/geo+json,application/json'}});
  if(!bytes.length)throw Error('Empty government GeoJSON');return bytes;
}
function summarize(values){
  const distances=values.map(value=>value/1000),ordered=[...distances].sort((a,b)=>a-b),length=distances.length;
  const within=limit=>pythonRound(distances.filter(value=>value<=limit).length/length,4);
  return {samples:length,within0_5km:within(0.5),within1km:within(1),within2km:within(2),
    p90DistanceKm:pythonRound(ordered[Math.floor(0.9*(length-1))],3),maxDistanceKm:pythonRound(ordered.at(-1),3)};
}
export async function compareYarraVector(decoded,bytes,screen){
  if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>24000000||typeof screen!=='function')throw Error('Bounded government source bytes and native screen are required');
  const reference=JSON.parse(bytes.toString('utf8'));
  if(reference.error)throw Error('Official ArcGIS service error: '+JSON.stringify(reference.error));
  const hydro=(decoded?.features||[]).filter(feature=>String(feature?.metadata?.systemId||'')==='50798885'&&feature.metadata.role==='mainstem');
  if(!hydro.length)throw Error('Current HydroYarra mainstem missing');
  if(reference.type!=='FeatureCollection'||!Array.isArray(reference.features)||!reference.features.length)throw Error('Government returned no GeoJSON features');
  const hydroLines=[],referenceLines=[];
  for(const feature of hydro)for(const line of lineParts(feature.geometry))if(Array.isArray(line)&&line.length>=2)hydroLines.push(line);
  for(const feature of reference.features){
    const name=String(feature?.properties?.NAME||'');
    if(name&&!/yarra|birrarung/i.test(name))throw Error('Unexpected government river name: '+name);
    for(const line of lineParts(feature.geometry))if(Array.isArray(line)&&line.length>=2)referenceLines.push(line);
  }
  if(!hydroLines.length)throw Error('HydroYarra mainstem has no usable lines');
  if(!referenceLines.length)throw Error('Victoria published an empty Yarra river centerline');
  const native=await screen({crs:'EPSG:32755',mode:'vector',lines:hydroLines,referenceLines,points:[],samples:161});
  const finiteArray=(value,length)=>Array.isArray(value)&&value.length===length&&value.every(item=>Number.isFinite(item)&&item>=0);
  if(!native||!finiteArray(native.lineLengthsMeters,hydroLines.length)||!finiteArray(native.referenceLengthsMeters,referenceLines.length)||
    !finiteArray(native.hydroToReferenceMeters,161)||!finiteArray(native.referenceToHydroMeters,161)||
    !Array.isArray(native.referenceBoundsMeters)||native.referenceBoundsMeters.length!==4||!native.referenceBoundsMeters.every(Number.isFinite))
    throw Error('Invalid native vector-screen result');
  const bounds=native.referenceBoundsMeters.map(value=>pythonRound(value,1));
  if(!(100000<=bounds[0]&&bounds[0]<=bounds[2]&&bounds[2]<=900000&&5700000<=bounds[1]&&bounds[1]<=bounds[3]&&bounds[3]<=6500000))
    throw Error('Government Yarra source outside Victoria UTM55 bounds: '+bounds.join(','));
  return {schema:'pando-government-vector-hydronym-v1',systemId:'50798885',currentNameKo:hydro[0].metadata.name,
    source:{provider:'State Government of Victoria - Department of Transport and Planning',referenceLayer:officialLayer,
      sourceGeoJSONSha256:createHash('sha256').update(bytes).digest('hex'),license:'CC BY 4.0',
      licenseSource:'https://discover.data.vic.gov.au/en_AU/dataset/vicmap-hydro-watercourse-line',
      independentHydrology:'https://www.melbournewater.com.au/water-and-environment/water-management/rivers-and-creeks/yarra-river'},
    governmentFeatures:reference.features.length,governmentSegmentCount:referenceLines.length,hydroMainstemFeatures:hydro.length,
    hydroMainstemSegmentCount:hydroLines.length,hydroMainstemTotalLengthKm:pythonRound(native.lineLengthsMeters.reduce((a,b)=>a+b,0)/1000,3),
    governmentRiverTotalLengthKm:pythonRound(native.referenceLengthsMeters.reduce((a,b)=>a+b,0)/1000,3),
    hydroSamplesToNamedGovernmentRiver:summarize(native.hydroToReferenceMeters),governmentSamplesToHydroMainstem:summarize(native.referenceToHydroMeters),
    assessment:'independent-geometry-screen-only',publishedToRuntime:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const controller=new globalThis.AbortController(),interrupt=()=>controller.abort(Error('Yarra vector screen cancelled'));
  process.once('SIGINT',interrupt);
  try{
    const {values}=parseArgs({options:{decoded:{type:'string'},output:{type:'string'},reference:{type:'string'},'expected-sha256':{type:'string'},
      'native-directory':{type:'string'},'osgeo-root':{type:'string'}}});
    if(!values.decoded||!values.output||Boolean(values.reference)!==Boolean(values['expected-sha256']))
      throw Error('--decoded INPUT --output NEW_OUTPUT [--reference FILE --expected-sha256 SHA] required');
    const output=resolve(values.output);
    try{lstatSync(output);throw Error('Output already exists; preserve it');}catch(error){if(error.code!=='ENOENT')throw error;}
    const decoded=JSON.parse(readFileSync(resolve(values.decoded),'utf8'));
    if(values.reference){const source=statSync(resolve(values.reference));if(!source.isFile()||source.size>24000000)throw Error('Government source must be a bounded regular file');}
    const bytes=values.reference?readFileSync(resolve(values.reference)):await fetchYarraVector({signal:controller.signal});
    if(values.reference&&createHash('sha256').update(bytes).digest('hex')!==values['expected-sha256'])throw Error('Government source SHA-256 mismatch');
    const result=await compareYarraVector(decoded,bytes,input=>screenHydroPoints(input,{directory:values['native-directory'],runtimeRoot:values['osgeo-root'],signal:controller.signal}));
    controller.signal.throwIfAborted();mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
    console.log('YARRA_GOVERNMENT_VECTOR_PROOF='+JSON.stringify(result));
  }catch(error){console.error('yarra-government-vector-screen: '+error.message);process.exitCode=1;}
  finally{process.removeListener('SIGINT',interrupt);}
}
