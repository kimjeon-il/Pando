#!/usr/bin/env node
/** Pinned-scope Harvard HGIS 1914 states: source acquisition only, not a border reconstruction. */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeLibraryOutput } from './library-data.mjs';

export const ROOT=fileURLToPath(new URL('../',import.meta.url));
export const OUTPUT=resolve(ROOT,'tools/historical-library/sources/german-empire-1914/hgis-germany-states-1914.geojson');
export const EXPECTED_FEATURES=26;
export const LAYER='vector_public:GHGIS1914GERMANY';
export const CATALOG='https://geo.nyu.edu/catalog/harvard-ghgis1914germany';
export const ENDPOINTS=[
 'https://geodata-proxy.lib.harvard.edu/geoserver/proxy/requestfile/wfs',
 'https://geodata.lib.harvard.edu/vector_public/wfs',
];
const assert=(ok,message)=>{if(!ok)throw Error(message);};
const sorted=value=>Array.isArray(value)?value.map(sorted):
  value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort()
    .map(key=>[key,sorted(value[key])])):value;
export function wfsUrl(base){
 const url=new URL(base);
 for(const [key,value] of Object.entries({service:'WFS',version:'1.0.0',
   request:'GetFeature',typeName:LAYER,outputFormat:'application/json',srsName:'EPSG:4326'}))
   url.searchParams.set(key,value);
 return url.toString();
}
function coordinateTree(value){
 assert(Array.isArray(value)&&value.length>0,'Invalid HGIS coordinate tree');
 if(typeof value[0]==='number'){
   assert(value.length>=2&&value.every(Number.isFinite)&&Math.abs(value[0])<=180
     &&Math.abs(value[1])<=90,'Invalid HGIS longitude/latitude');
   return;
 }
 for(const child of value)coordinateTree(child);
}
export function normalizeHgisSource(value){
 assert(value?.type==='FeatureCollection'&&Array.isArray(value.features),
  'HGIS source is not a FeatureCollection');
 const features=[];
 for(const item of value.features){
   const geometry=item?.geometry;
   if(!['Polygon','MultiPolygon'].includes(geometry?.type))continue;
   coordinateTree(geometry.coordinates);
   features.push({type:'Feature',properties:{...(item.properties||{})},geometry});
 }
 assert(features.length===EXPECTED_FEATURES,
  'Expected '+EXPECTED_FEATURES+' HGIS state polygons; got '+features.length);
 return {type:'FeatureCollection',name:'HGIS1914GERMANY-local',
   crs:{type:'name',properties:{name:'EPSG:4326'}},features};
}
export function canonicalHgis(value){
 // The original Python source collector uses sorted GeoJSON keys and compact UTF-8 JSON.
 return JSON.stringify(sorted(normalizeHgisSource(value)))+'\n';
}
export function preserveHgis(payload,{output=OUTPUT,writer=writeLibraryOutput}={}){
 const target=resolve(output),data=canonicalHgis(payload);
 if(existsSync(target)){
   assert(readFileSync(target,'utf8')===data,'Existing HGIS original differs; do not overwrite');
   return {output:target,unchanged:true};
 }
 mkdirSync(dirname(target),{recursive:true});
 writer(target,data,{flag:'wx'});
 return {output:target,unchanged:false,
   sha256:createHash('sha256').update(data).digest('hex')};
}
export async function downloadHgis(url,fetcher=fetch){
 const response=await fetcher(url,{headers:{'User-Agent':'PandoLab HGIS 1914 source/1'},
   signal:AbortSignal.timeout(120000)});
 assert(response.ok,'HGIS WFS status '+response.status);
 const advertised=Number(response.headers?.get?.('content-length')||0);
 assert(!advertised||advertised<=64*1024*1024,'HGIS source larger than 64 MiB');
 const bytes=Buffer.from(await response.arrayBuffer());
 assert(bytes.length<=64*1024*1024,'HGIS source larger than 64 MiB');
 return JSON.parse(bytes.toString('utf8'));
}
export async function main(argv=process.argv.slice(2),{fetcher=fetch}={}){
 let fromFile=null,url=null,output=OUTPUT,check=false;
 for(let i=0;i<argv.length;i++){
   const arg=argv[i];
   if(arg==='--check')check=true;
   else if(arg==='--from-file'&&argv[i+1]&&!fromFile)fromFile=argv[++i];
   else if(arg==='--url'&&argv[i+1]&&!url)url=argv[++i];
   else if(arg==='--output'&&argv[i+1])output=argv[++i];
   else throw Error('Unknown HGIS argument: '+arg);
 }
 assert(!(fromFile&&url),'Choose one HGIS source input');
 if(check)assert(fromFile,'--check requires --from-file');
 const save=payload=>{
   if(check){
     assert(existsSync(output)&&readFileSync(output,'utf8')===canonicalHgis(payload),
       'Stored HGIS original differs');
     return {check:true};
   }
   return preserveHgis(payload,{output});
 };
 if(fromFile)return save(JSON.parse(readFileSync(resolve(fromFile),'utf8')));
 if(url)return save(await downloadHgis(url,fetcher));
 const failures=[];
 for(const endpoint of ENDPOINTS){
   try{return save(await downloadHgis(wfsUrl(endpoint),fetcher));}
   catch(error){failures.push(endpoint+': '+error.message);}
 }
 throw Error('HGIS WFS unavailable; obtain licensed GeoJSON from '+CATALOG+
   ' and use node tools/fetch-german-empire-1914-source.mjs --from-file PATH\n'+failures.join('\n'));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().then(result=>console.log(JSON.stringify(result)))
   .catch(error=>{console.error('HGIS source: '+error.message);process.exitCode=1;});
