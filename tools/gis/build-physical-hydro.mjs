// Natural Earth physical-vector production; source coordinates and record order are retained.
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,readdirSync,realpathSync,writeFileSync} from 'node:fs';
import {basename,dirname,isAbsolute,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {withLibraryOutputs} from '../library-data.mjs';

const rootDefault=fileURLToPath(new URL('../../',import.meta.url));
const sources=[['rivers_base','river','ne_10m_rivers_lake_centerlines_scale_rank'],['rivers_australia','river','ne_10m_rivers_australia'],
  ['rivers_europe','river','ne_10m_rivers_europe'],['rivers_north_america','river','ne_10m_rivers_north_america'],
  ['lakes_base','lake','ne_10m_lakes'],['lakes_australia','lake','ne_10m_lakes_australia'],
  ['lakes_europe','lake','ne_10m_lakes_europe'],['lakes_north_america','lake','ne_10m_lakes_north_america']];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function pyNumber(value,integer=false){
  if(value===null||value===undefined||typeof value==='object')return null;
  if(typeof value==='string'&&(!value.trim()||(integer&&!/^[+-]?\d+$/.test(value.trim()))))return null;
  const n=Number(value);return Number.isFinite(n)?(integer?Math.trunc(n):n):null;
}
export function physicalHydroProperties(record,layer,category,index){
  if(!record||typeof record!=='object'||Array.isArray(record)||typeof layer!=='string'||!['river','lake'].includes(category)||!Number.isSafeInteger(index)||index<0)
    throw Error('Explicit physical hydro record identity required');
  const sourceId=record.ne_id||record.id||record.objectid||index,nameKo=record.name_ko||'',nameEn=record.name_en||record.name||'';
  const rank=pyNumber(record.scalerank,true)??10,minZoom=pyNumber(record.min_zoom)??Math.max(0,Math.min(12,rank));
  const stroke=pyNumber(record.strokeweig)??Math.max(.35,2.7-rank*.18);
  return {pandolab_id:`${layer}:${sourceId}`,layer_id:layer,category,name:nameKo||nameEn||record.name||`${category}-${index+1}`,
    name_ko:nameKo,name_en:nameEn,name_original:record.name||'',feature_class:record.featurecla||'',scale_rank:rank,min_zoom:minZoom,
    stroke_width:stroke,source_id:sourceId,wikidata_id:record.wikidataid||'',note:record.note||'',source:'Natural Earth 5.0.0 1:10m'};
}
export function physicalHydroCollection(document,layer,category){
  if(document?.type!=='FeatureCollection'||!Array.isArray(document.features))throw Error('Expected physical hydro features');
  let coordinateCount=0,skippedNullShapes=0;const features=[];
  const count=value=>{
    if(!Array.isArray(value)||!value.length)throw Error('Invalid physical hydro geometry coordinates');
    if(typeof value[0]==='number'){
      if(value.length<2||value.some(v=>typeof v!=='number'||!Number.isFinite(v)))throw Error('Invalid physical hydro coordinate');
      coordinateCount++;return;
    }
    for(const child of value)count(child);
  };
  for(let index=0;index<document.features.length;index++){
    const row=document.features[index],geometry=row?.geometry;
    if(geometry===null){skippedNullShapes++;continue;}
    const allowed=category==='river'?['LineString','MultiLineString']:['Polygon','MultiPolygon'];
    if(!geometry||!allowed.includes(geometry.type))throw Error(`Expected physical hydro ${category==='river'?'line':'polygon'} geometry`);
    count(geometry.coordinates);const properties=physicalHydroProperties(row.properties||{},layer,category,index);
    features.push({type:'Feature',id:properties.pandolab_id,properties,geometry});
  }
  return {collection:{type:'FeatureCollection',features},coordinateCount,skippedNullShapes};
}
function findSources(root,names){
  const found=new Map(),wanted=new Set(names),pending=[root];
  while(pending.length){const directory=pending.pop();for(const row of readdirSync(directory,{withFileTypes:true})){
    const path=resolve(directory,row.name);if(row.isDirectory())pending.push(path);
    else if(row.isFile()&&wanted.has(row.name)){
      if(found.has(row.name))throw Error('Expected exactly one '+row.name+', found more than one');found.set(row.name,path);
    }
  }}
  for(const name of names)if(!found.has(name))throw Error(`Expected exactly one ${name}, found 0`);
  return names.map(name=>found.get(name));
}
function futureRealpath(path){
  const tail=[];let current=path;
  while(!existsSync(current)){
    const parent=dirname(current);if(parent===current)throw Error('Cannot resolve physical hydro output');
    tail.unshift(basename(current));current=parent;
  }
  return resolve(realpathSync(current),...tail);
}
export function buildPhysicalHydro({sourceRoot,outputRoot,gdal=process.env.PANDO_GDAL_OGR2OGR||'ogr2ogr',root=rootDefault}){
  if(!sourceRoot||!outputRoot||typeof gdal!=='string'||!gdal)throw Error('Explicit source and candidate output roots required');
  sourceRoot=resolve(sourceRoot);outputRoot=resolve(outputRoot);const hydro=resolve(outputRoot,'hydro');
  const paths=[...sources.map(([layer])=>resolve(hydro,layer+'.geojson')),resolve(hydro,'manifest.json')];
  if(paths.some(existsSync))throw Error('Physical hydro output exists; preserve the prior evidence');
  const rel=relative(realpathSync(sourceRoot),futureRealpath(outputRoot));
  if(!rel||(!rel.startsWith('..'+sep)&&rel!=='..'&&!isAbsolute(rel)))throw Error('Candidate output must be outside the source root');
  const inputs=findSources(sourceRoot,sources.map(([,,stem])=>stem+'.shp'));
  const manifest={version:'0.12.6',dataset:'Natural Earth 5.0.0 1:10m physical vectors',crs:'EPSG:4326',
    coordinatePolicy:'source coordinates retained without simplification',layers:[]};
  const outputs=[];
  for(let i=0;i<sources.length;i++){
    const [layer,category]=sources[i],source=inputs[i];
    const sourceFiles=[source,source.slice(0,-4)+'.dbf',source.slice(0,-4)+'.shx'];
    const sourceHashes=sourceFiles.map(path=>sha(readFileSync(path)));
    const env={...process.env,SHAPE_ENCODING:'UTF-8'};if(isAbsolute(gdal))env.PATH=dirname(gdal)+(process.platform==='win32'?';':':')+(env.PATH||'');
    const processResult=spawnSync(gdal,['-f','GeoJSON','/vsistdout/',source,'-lco','RFC7946=NO','-lco','COORDINATE_PRECISION=17'],
      {encoding:'utf8',windowsHide:true,timeout:180000,maxBuffer:256*1024*1024,env});
    if(processResult.error)throw processResult.error;
    if(processResult.status!==0)throw Error('GDAL physical hydro read failed: '+processResult.stderr.trim());
    if(sourceFiles.some((path,index)=>sha(readFileSync(path))!==sourceHashes[index]))throw Error('Physical hydro source changed while reading');
    const result=physicalHydroCollection(JSON.parse(processResult.stdout),layer,category),bytes=Buffer.from(JSON.stringify(result.collection));
    manifest.layers.push({id:layer,category,url:`hydro/${layer}.geojson`,featureCount:result.collection.features.length,
      coordinateCount:result.coordinateCount,skippedNullShapes:result.skippedNullShapes,sourceFile:basename(source),
      sourceSha256:sourceHashes[0],outputSha256:sha(bytes)});outputs.push(bytes);
  }
  outputs.push(Buffer.from(JSON.stringify(manifest,null,2)));
  withLibraryOutputs({root,paths},()=>{
    if(paths.some(existsSync))throw Error('Physical hydro output exists; preserve the prior evidence');
    mkdirSync(hydro,{recursive:true});for(let i=0;i<paths.length;i++)writeFileSync(paths[i],outputs[i],{flag:'wx'});
  });
  return manifest;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const {values}=parseArgs({options:{source:{type:'string'},output:{type:'string'},gdal:{type:'string'}}});
    const manifest=buildPhysicalHydro({sourceRoot:values.source,outputRoot:values.output,...(values.gdal?{gdal:values.gdal}:{})});
    console.log(JSON.stringify({layers:manifest.layers.length,output:resolve(values.output)}));
  }catch(error){console.error('build-physical-hydro: '+error.message);process.exitCode=1;}
}
