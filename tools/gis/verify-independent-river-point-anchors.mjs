// Independent named-point screen; distances are not river-name approval.
// Geometry calculations are provided by the separately verified native tool.
import {lstatSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {screenHydroPoints} from './hydro-point-screen-native.mjs';
const anchors={
  finnish_nls_oulujoki:{name:'Oulujoki',lon:25.56374,lat:64.99977,kind:'Finland National Land Survey geographical names register',source:'https://finto.fi/yso-paikat/fi/page/p204727'},
  finnish_nls_siikajoki:{name:'Siikajoki',lon:24.74333,lat:64.83728,kind:'Finland National Land Survey geographical names register',source:'https://finto.fi/yso-paikat/en/page/p139542'},
  kazakh_emba_atlas_location:{name:'Zhem/Emba',lon:56+23/60+59/3600,lat:47+52/60+26/3600,kind:'Secondary transcription of Kazakhstan encyclopedias (1990/1983); not an official GIS line',source:'https://silkadv.com/ru/node/4653'},
  kazakh_ural_atlas_location:{name:'Zhaiyk/Ural',lon:51+35/60+18/3600,lat:49+34/60+38/3600,kind:'Secondary transcription of river monograph (1987); not an official GIS line',source:'https://silkadv.com/en/content/ural-river-kazakhstan'},
  russian_sulak_2024_field_mouth:{name:'Sulak',lon:47.537988,lat:43.259126,kind:'Independent academic field sampling of Sulak on 12 August 2024',source:'https://www.mdpi.com/2073-4441/17/23/3390'},
  russian_sulak_2024_field_upstream:{name:'Sulak',lon:47.1130054,lat:43.3657051,kind:'Independent academic field sampling of Sulak on 12 August 2024',source:'https://www.mdpi.com/2073-4441/17/23/3390'},
  russian_terek_register_mouth:{name:'Terek',lon:47+33/60+35/3600,lat:43+35/60+43/3600,kind:'Secondary hydrological gazetteer giving Russian GVR ID 07020000212108200002513',source:'https://waterresources.ru/reki/terek/'},
};
const groups={
  '20071308':['finnish_nls_oulujoki','finnish_nls_siikajoki'],
  '20075401':['finnish_nls_oulujoki','finnish_nls_siikajoki'],
  '20456598':['kazakh_emba_atlas_location','kazakh_ural_atlas_location'],
  '20532766':['russian_sulak_2024_field_mouth','russian_sulak_2024_field_upstream','russian_terek_register_mouth'],
  '20540915':['russian_sulak_2024_field_mouth','russian_sulak_2024_field_upstream','russian_terek_register_mouth'],
};

// Python rounds the exact binary float to nearest decimal, ties to even.
function roundPython(value,digits){
  if(!Number.isFinite(value))throw Error('Nonfinite native point-screen result');
  const bytes=new DataView(new ArrayBuffer(8));bytes.setFloat64(0,Math.abs(value));
  const high=bytes.getUint32(0),low=bytes.getUint32(4),exponent=(high>>>20)&0x7ff;
  let numerator=(BigInt(high&0xfffff)<<32n)|BigInt(low),power;
  if(exponent===0)power=-1074;else{numerator|=1n<<52n;power=exponent-1075;}
  numerator*=10n**BigInt(digits);let denominator=1n;
  if(power>=0)numerator<<=BigInt(power);else denominator<<=BigInt(-power);
  let quotient=numerator/denominator;const rest=numerator%denominator;
  if(rest*2n>denominator||(rest*2n===denominator&&quotient%2n!==0n))quotient++;
  return (value<0?-1:1)*Number(quotient)/10**digits;
}
function lineParts(geometry){
  if(geometry?.type==='LineString')return [geometry.coordinates];
  if(geometry?.type==='MultiLineString')return geometry.coordinates;
  throw Error('Unrecognized line geometry type: '+geometry?.type);
}
export async function buildIndependentPointScreen(decoded,screen){
  if(String(decoded?.manifest?.version)!=='0.13.2')throw Error('Expected pinned HydroRIVERS v0.13.2');
  if(!Array.isArray(decoded.features)||typeof screen!=='function')throw Error('Decoded Hydro features and native screen are required');
  const systems=new Map(Object.keys(groups).map(id=>[id,[]]));
  for(const feature of decoded.features){const id=String(feature?.metadata?.systemId||'');
    if(systems.has(id)&&feature.metadata.role==='mainstem')systems.get(id).push(feature.geometry);
  }
  const missing=[...systems].filter(([,features])=>!features.length).map(([id])=>id);
  if(missing.length)throw Error('Missing mainstem system: '+missing.join(', '));
  const items=[];
  for(const [id,features] of systems){
    const lines=[];for(const geometry of features)for(const line of lineParts(geometry))if(Array.isArray(line)&&line.length>=2)lines.push(line);
    if(!lines.length)throw Error('No mainstem lines for '+id);
    const keys=groups[id],crs=['20071308','20075401'].includes(id)?'EPSG:32635':['20532766','20540915'].includes(id)?'EPSG:32638':'EPSG:32640';
    const result=await screen({crs,lines,points:keys.map(key=>[anchors[key].lon,anchors[key].lat])});
    if(!result||!Array.isArray(result.lineLengthsMeters)||result.lineLengthsMeters.length!==lines.length||
      result.lineLengthsMeters.some(value=>!Number.isFinite(value)||value<0)||!Array.isArray(result.points)||result.points.length!==keys.length||
      result.points.some(item=>!item||!Number.isFinite(item.distanceMeters)||item.distanceMeters<0||
        !Array.isArray(item.nearestLonLat)||item.nearestLonLat.length!==2||item.nearestLonLat.some(value=>!Number.isFinite(value))))
      throw Error('Invalid native point-screen result');
    const pointChecks={};
    for(let i=0;i<keys.length;i++){
      const key=keys[i],anchor=anchors[key],point=result.points[i];
      pointChecks[key]={river:anchor.name,publishedPointLonLat:[anchor.lon,anchor.lat],closestHydroMainstemKm:roundPython(point.distanceMeters/1000,3),
        nearestHydroLonLat:point.nearestLonLat.map(value=>roundPython(value,5)),sourceType:anchor.kind,source:anchor.source};
    }
    items.push({systemId:id,mainstemFeatureCount:features.length,mainstemSegmentCount:lines.length,
      mainstemTotalLengthKm:roundPython(result.lineLengthsMeters.reduce((sum,value)=>sum+value,0)/1000,3),pointChecks});
  }
  return {schema:'pando-independent-hydronym-point-screen-v1',referenceHydroVersion:'v0.13.2',
    evidenceType:'independent-named-point-vs-published-mainstem-distance',nameIdentityVerified:false,geometryCopiedToRuntime:false,
    caveat:'A named register point does not represent the entire river; full independent vector alignment and topology are needed before name changes.',items};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const {values}=parseArgs({options:{decoded:{type:'string'},output:{type:'string'},'native-directory':{type:'string'},'osgeo-root':{type:'string'}}});
    if(!values.decoded||!values.output)throw Error('--decoded INPUT --output NEW_OUTPUT [--native-directory DIR] [--osgeo-root DIR] required');
    const output=resolve(values.output);
    try{lstatSync(output);throw Error('Output already exists; preserve it');}catch(error){if(error.code!=='ENOENT')throw error;}
    const decoded=JSON.parse(readFileSync(resolve(values.decoded),'utf8'));
    const result=await buildIndependentPointScreen(decoded,input=>screenHydroPoints(input,{directory:values['native-directory'],runtimeRoot:values['osgeo-root']}));
    mkdirSync(dirname(output),{recursive:true});
    writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));
  }catch(error){console.error('independent-river-point-screen: '+error.message);process.exitCode=1;}
}
