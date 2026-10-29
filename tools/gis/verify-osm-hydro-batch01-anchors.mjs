// Independent named-station screen for the first ten Hydro systems. Results
// are evidence for review and never alter production geometry or names.
import {lstatSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {batch01Anchors} from './hydro-osm-batch01-anchors.mjs';
import {lineParts,screenHydroPoints,validatePointScreenResult} from './hydro-point-screen-native.mjs';
import {pythonRound} from './hydro-numeric.mjs';

export async function buildBatch01Screen(decoded,screen){
  const manifest=decoded?.manifest;
  if(manifest?.version!=='0.13.2'||manifest.metadata?.featureCount!==16548)throw Error('Expected original 0.13.2 published feature set');
  if(!Array.isArray(decoded.features)||typeof screen!=='function')throw Error('Decoded Hydro features and native screen are required');
  const systems=new Map(batch01Anchors.batch.map(id=>[id,[]]));
  for(const feature of decoded.features){const id=String(feature?.metadata?.systemId||'');
    if(systems.has(id)&&feature.metadata.role==='mainstem')systems.get(id).push(feature);
  }
  if([...systems.values()].some(features=>!features.length))throw Error('One or more first-ten mainstems missing');
  const items=[];
  for(const [id,features] of systems){
    const lines=[];for(const feature of features)for(const line of lineParts(feature.geometry))if(Array.isArray(line)&&line.length>=2)lines.push(line);
    if(!lines.length)throw Error('No line segments for '+id);
    const keys=batch01Anchors.groups[id],info=batch01Anchors.points;
    const native=await screen({crs:batch01Anchors.crs[id],mode:'parts',lines,points:keys.map(key=>[info[key].lon,info[key].lat])});
    validatePointScreenResult(native,lines.length,keys.length,{allowFilteredLines:true});
    const stations=keys.map((key,index)=>{
      const row=info[key],point=native.points[index];return {id:key,river:row.river,
        publishedPointLonLat:[pythonRound(row.lon,7),pythonRound(row.lat,7)],distanceToMainstemKm:pythonRound(point.distanceMeters/1000,3),
        nearestHydroLonLat:point.nearestLonLat.map(value=>pythonRound(value,6)),independentSource:row.source,stationDescription:row.description};
    });
    const minima={};for(const name of [...new Set(stations.map(station=>station.river))].sort())
      minima[name]=Math.min(...stations.filter(station=>station.river===name).map(station=>station.distanceToMainstemKm));
    items.push({systemId:id,publishedNameKo:features[0].metadata.name,mainstemFeatureCount:features.length,
      linePartCount:native.lineLengthsMeters.length,mainstemLengthKm:pythonRound(native.lineLengthsMeters.reduce((sum,value)=>sum+value,0)/1000,3),
      independentStations:stations,minDistanceKmByRiver:minima});
  }
  return {schema:'pando-hydro-osm-remaining-first10-point-check-v1',baselineHydroVersion:'v0.13.2',
    publishedHydroBundleSha256:manifest.container.sha256,metadataNotModified:true,osmSourcesNotUsed:true,
    method:'independent named-station/point to all preexisting Pando Hydro mainstem polyline segments in local UTM',
    limits:[
      'Point-to-line proximity is a screening metric, not whole river identity or a license substitution.',
      'Multiple named tributaries may belong to one grouped logical Hydro basin.',
      'NLS register locations are named point references, not whole 107km Oulujoki or 194km Siikajoki vectors.',
      'Terek/Ural comparison points came from secondary gazetteers; country official polyline is pending.',
      'Chad Manda is listed under Chari basin by a 2021 paper, but Bahr Sara by national hydrometeorology.',
    ],items};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const {values}=parseArgs({options:{decoded:{type:'string'},output:{type:'string'},'native-directory':{type:'string'},'osgeo-root':{type:'string'}}});
    if(!values.decoded||!values.output)throw Error('--decoded INPUT --output NEW_OUTPUT [--native-directory DIR] [--osgeo-root DIR] required');
    const output=resolve(values.output);
    try{lstatSync(output);throw Error('Output already exists; preserve it');}catch(error){if(error.code!=='ENOENT')throw error;}
    const decoded=JSON.parse(readFileSync(resolve(values.decoded),'utf8'));
    const result=await buildBatch01Screen(decoded,input=>screenHydroPoints(input,{directory:values['native-directory'],runtimeRoot:values['osgeo-root']}));
    mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
    console.log('OSM_BATCH01_ANCHORS='+JSON.stringify({items:result.items.map(row=>({systemId:row.systemId,publishedNameKo:row.publishedNameKo,
      mainstemLengthKm:row.mainstemLengthKm,minDistanceKmByRiver:row.minDistanceKmByRiver,
      stations:row.independentStations.map(item=>[item.id,item.distanceToMainstemKm])}))}));
  }catch(error){console.error('hydro-batch01-point-screen: '+error.message);process.exitCode=1;}
}
