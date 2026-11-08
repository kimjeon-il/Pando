import {createHash} from 'node:crypto';
import {applyPhysicalLandPatch,physicalLandPatchSchema,regionalLandLayout} from '../../src/data/physical-land-patch.js';
import {readFileSync,existsSync,mkdirSync,writeFileSync,renameSync,unlinkSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {gunzipSync,gzipSync} from 'node:zlib';
import {defaultRoot,libraryConfig,libraryCheckout,decodeArchiveEntry,gitOptions} from './library-context.mjs';
import {withLibraryOutputs} from './library-runtime.mjs';
import {storeLibraryData} from './library-store.mjs';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Stable anchors preserve existing order even when inserted regions shift every
// later index. Gaps alone become replacements; duplicate coordinates are exact.
function sequenceChanges(before,after,keyFor=digest,onMatch=()=>{}){
 const positions=new Map();after.forEach((value,i)=>{const key=keyFor(value);if(!positions.has(key))positions.set(key,[]);positions.get(key).push(i);});
 const anchors=[[-1,-1]];let last=-1;
 before.forEach((value,i)=>{const candidates=positions.get(keyFor(value));if(!candidates)return;
  let lo=0,hi=candidates.length;while(lo<hi){const mid=(lo+hi)>>1;if(candidates[mid]<=last)lo=mid+1;else hi=mid;}
  if(lo<candidates.length){last=candidates[lo];anchors.push([i,last]);onMatch(i,last);}
 });
 anchors.push([before.length,after.length]);const changes=[];
 for(let i=1;i<anchors.length;i++){
  const [a,b]=anchors[i-1],[x,y]=anchors[i];
  if(x>a+1||y>b+1)changes.push({start:a+1,deleteCount:x-a-1,values:after.slice(b+1,y),beforeSha256:digest(before.slice(a+1,x))});
 }
 return changes;
}

/** Factor an existing approved result without normalization or GIS computation. */
export function createPhysicalLandPatch(base,target,{validFrom,validTo}){
 if(base?.type!=='MultiPolygon'||target?.type!=='MultiPolygon'||!Array.isArray(base.coordinates)||!Array.isArray(target.coordinates)
   ||typeof validFrom!=='string'||typeof validTo!=='string'||validFrom>validTo)throw Error('Approved land inputs and an unambiguous validity window are required');
 const points=new Map();
 base.coordinates.forEach((polygon,p)=>polygon.forEach((ring,r)=>ring.forEach((point,i)=>{
  const key=JSON.stringify(point);if(!points.has(key))points.set(key,[]);points.get(key).push([p,r,i]);
 })));
 function encodeRing(ring){
  const segments=[];let i=0,literals=[];
  const flush=()=>{if(literals.length){segments.push({points:literals});literals=[];}};
  while(i<ring.length){
   let best=null;
   for(const [polygon,r,start]of points.get(JSON.stringify(ring[i]))||[])for(const step of [1,-1]){
    const original=base.coordinates[polygon][r];let count=1;
    while(i+count<ring.length&&start+count*step>=0&&start+count*step<original.length
     &&JSON.stringify(original[start+count*step])===JSON.stringify(ring[i+count]))count++;
    if(count>=3&&(!best||count>best.count))best={polygon,ring:r,start,count,step};
   }
   if(best){flush();segments.push({base:best});i+=best.count;}else{literals.push(ring[i]);i++;}
  }
  flush();return segments;
 }
 const patch={schema:physicalLandPatchSchema,validFrom,validTo,baseContentSha256:digest(base),resultContentSha256:digest(target),
  basePolygonCount:base.coordinates.length,resultPolygonCount:target.coordinates.length,replacements:[],ringReplacements:[]};
 const changes=sequenceChanges(base.coordinates,target.coordinates,polygon=>digest(polygon[0]),(i,j)=>{
  const rings=sequenceChanges(base.coordinates[i],target.coordinates[j]);
  if(rings.length)patch.ringReplacements.push({polygon:i,replacements:rings.map(({values,...row})=>({...row,rings:values.map(encodeRing)}))});
 });
 for(const {values,...change}of changes)patch.replacements.push({...change,polygons:values.map(polygon=>({rings:polygon.map(encodeRing)}))});
 if(JSON.stringify(applyPhysicalLandPatch(base,patch))!==JSON.stringify(target))throw Error('Regional storage changed the approved ordered land result');
 return patch;
}

/** Publish only the exact storage representation of the pinned physical results. */
export function factorPhysicalLandFiles({root=defaultRoot,apply=false,push=false}={}){
 if(push&&!apply)throw Error('Physical publication requires an applied verified conversion');
 const config=libraryConfig(root),checkout=libraryCheckout(root),manifestPath='assets/data/physical-land/v1/manifest.json';
 const archive=JSON.parse(execFileSync('git',[...gitOptions,'show',config.revision+':archive/index.json'],{cwd:checkout,maxBuffer:16*1024*1024}));
 const read=p=>decodeArchiveEntry(checkout,archive.files[p],config.revision),original=read(manifestPath),manifest=JSON.parse(original);
 const targets=new Map();
 for(const row of manifest.waterObjects.geometries){if(row.land.sha256===manifest.asset.sha256||row.land.storageLayout===regionalLandLayout)continue;
  const group=targets.get(row.land.sha256)||{spec:row.land,rows:[]};group.rows.push(row);targets.set(row.land.sha256,group);
 }
 if(!targets.size)return {unchanged:true,revision:config.revision};
 const readGeometry=spec=>{const bytes=read(spec.url);if(bytes.length!==spec.compressedBytes||createHash('sha256').update(bytes).digest('hex')!==spec.sha256)throw Error('Pinned land transfer differs: '+spec.url);
  const decoded=spec.encoding==='gzip'?gunzipSync(bytes):bytes;if(decoded.length!==spec.decodedBytes)throw Error('Pinned land decoded size differs');return JSON.parse(decoded);};
 const base=readGeometry(manifest.asset),files=new Map(),changes=[];
 for(const {spec,rows}of targets.values()){
  const refs=new Set(rows.map(row=>JSON.stringify(row.geometryRef))),bindings=manifest.waterObjects.timelineRecords.geometryBindings.filter(row=>refs.has(JSON.stringify(row.geometryRef)));
  const windows=[...new Set(bindings.map(row=>JSON.stringify([row.validFrom,row.validTo])))];
  if(windows.length!==1)throw Error('Regional land requires an unambiguous shared validity window');
  const [validFrom,validTo]=JSON.parse(windows[0]),patch=createPhysicalLandPatch(base,readGeometry(spec),{validFrom,validTo}),decoded=Buffer.from(JSON.stringify(patch)+'\n'),bytes=gzipSync(decoded,{level:9});bytes[9]=10;
  const sha256=createHash('sha256').update(bytes).digest('hex'),url='assets/data/physical-land/v1/replacements/sha256-'+sha256+'.json.gz';
  files.set(url,bytes);
  const next={...spec,storageLayout:regionalLandLayout,base:manifest.asset,replacement:{url,encoding:'gzip',sha256,compressedBytes:bytes.length,decodedBytes:decoded.length},contentSha256:patch.resultContentSha256};
  for(const row of rows)row.land=next;
  changes.push({originalSha256:spec.sha256,baseContentSha256:patch.baseContentSha256,resultContentSha256:patch.resultContentSha256,
   beforeCompressedBytes:spec.compressedBytes,afterCompressedBytes:bytes.length,replacements:patch.replacements.length,ringReplacements:patch.ringReplacements.length,validFrom,validTo,exactOrderedGeometry:true});
 }
 manifest.schema='pando-physical-land-v3';files.set(manifestPath,Buffer.from(JSON.stringify(manifest,null,2)+'\n'));
 for(const [p,bytes]of files)if(existsSync(resolve(root,p))){const current=readFileSync(resolve(root,p));if(!current.equals(bytes)&&(p!==manifestPath||!current.equals(original)))throw Error('Preserve unrelated physical output edit: '+p);}
 if(apply)withLibraryOutputs({root,paths:[...files.keys()].map(p=>resolve(root,p))},()=>{
  for(const [p,bytes]of files){const target=resolve(root,p);if(existsSync(target)&&readFileSync(target).equals(bytes))continue;
   mkdirSync(dirname(target),{recursive:true});const temporary=target+'.'+process.pid+'.pending';let created=false;
   try{writeFileSync(temporary,bytes,{flag:'wx'});created=true;renameSync(temporary,target);}finally{if(created&&existsSync(temporary))unlinkSync(temporary);}
  }
 });
 if(!push)return {revision:config.revision,applied:apply,changes};
 const revision=storeLibraryData({root,push:true,prefixes:[...files.keys()]}),stored=JSON.parse(execFileSync('git',[...gitOptions,'show',revision+':archive/index.json'],{cwd:checkout,maxBuffer:16*1024*1024}));
 for(const [p,bytes]of files)if(!decodeArchiveEntry(checkout,stored.files[p],revision).equals(bytes))throw Error('Stored physical bytes differ: '+p);
 return {revision,applied:true,changes,verifiedStoredFiles:files.size};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(factorPhysicalLandFiles({apply:process.argv.includes('--apply'),push:process.argv.includes('--push')})));
