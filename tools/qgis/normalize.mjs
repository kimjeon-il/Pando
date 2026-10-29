// QGIS exchange normalization; Pando retains ownership of imported identities.
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';

const geometries=new Set(['Point','MultiPoint','LineString','MultiLineString','Polygon','MultiPolygon']);
const geographicCrs=new Set(['EPSG:4326','urn:ogc:def:crs:OGC:1.3:CRS84','urn:ogc:def:crs:EPSG::4326']);

// JSON can contain integer QGIS identifiers wider than JavaScript's safe range.
function parseJson(text){
  return JSON.parse(text.replace(/^\ufeff/,''),(key,value,context)=>{
    if(typeof value==='number'&&!Number.isSafeInteger(value)&&/^-?(?:0|[1-9]\d*)$/.test(context?.source||''))
      return BigInt(context.source);
    return value;
  });
}
function serialize(value){
  return JSON.stringify(value,(key,item)=>{
    if(typeof item==='bigint')return JSON.rawJSON(item.toString());
    if(typeof item==='number'&&!Number.isFinite(item))throw Error('Nonfinite value in QGIS exchange');
    return item;
  },2)+'\n';
}
function coordinates(value){
  if(!Array.isArray(value)||!value.length)throw Error('Invalid geometry coordinate array');
  if(typeof value[0]==='number'||typeof value[0]==='bigint'){
    if(value.length!==2||value.some(item=>typeof item!=='number'||!Number.isFinite(item))||
      value[0]<-180||value[0]>180||value[1]<-90||value[1]>90)throw Error('Invalid RFC7946 coordinate; export EPSG:4326 and XY');
  }else for(const child of value)coordinates(child);
}
export function normalizeExchange(collection){
  const result=structuredClone(collection);
  if(!result||result.type!=='FeatureCollection'||!Array.isArray(result.features))throw Error('A GeoJSON FeatureCollection is required');
  const crs=result.crs;delete result.crs;
  if(crs&&!geographicCrs.has(crs.properties?.name))throw Error('QGIS must export EPSG:4326 / RFC7946 first');
  for(const feature of result.features){
    const geometry=feature?.geometry;
    if(feature?.type!=='Feature'||!geometry||!geometries.has(geometry.type))throw Error('Unsupported or missing feature geometry');
    coordinates(geometry.coordinates);
    if(feature.properties===null||feature.properties===undefined)feature.properties={};
    const properties=feature.properties;
    if(!properties||typeof properties!=='object'||Array.isArray(properties))throw Error('Feature properties must be an object');
    if(typeof properties.source==='string'&&properties.source.trimStart().startsWith('{')){
      const source=parseJson(properties.source);
      if(source&&typeof source==='object'&&!Array.isArray(source)&&source.schemaVersion===1)properties.source=source;
    }
  }
  return result;
}
export function normalizeFile(input,output){
  if(!input||!output)throw Error('An input and a new output are required');
  const result=normalizeExchange(parseJson(readFileSync(resolve(input),'utf8')));
  writeFileSync(resolve(output),serialize(result),{encoding:'utf8',flag:'wx'});
  return {output:resolve(output)};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const {values,positionals}=parseArgs({allowPositionals:true,options:{output:{type:'string'}}});
    if(positionals.length!==1||!values.output)throw Error('Usage: node tools/qgis/normalize.mjs INPUT --output NEW_OUTPUT');
    console.log(JSON.stringify(normalizeFile(positionals[0],values.output)));
  }catch(error){console.error('qgis-normalize: '+error.message);process.exitCode=1;}
}
