import {applyPreparedMeshDelta,preparedMeshDeltaLayout} from '../../src/data/prepared-mesh-delta.js';
import {loadPhysicalLandGeometry} from '../../src/data/physical-land-patch.js';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,mkdirSync,writeFileSync,renameSync,unlinkSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {gunzipSync,gzipSync} from 'node:zlib';
import {defaultRoot,libraryConfig,libraryCheckout,decodeArchiveEntry,gitOptions} from './library-context.mjs';
import {withLibraryOutputs} from './library-runtime.mjs';
import {storeLibraryData} from './library-store.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

/** Find exact byte runs in the approved base. Hashes select candidates only;
 * every candidate is byte-compared, so collisions cannot change the result. */
export function createPreparedMeshDelta(base,target){
 if(!Buffer.isBuffer(base)||!Buffer.isBuffer(target)||base.length>0xffffffff||!target.length||target.length>0xffffffff)throw Error('Prepared mesh delta requires bounded binary inputs');
 const window=64,index=new Map(),hash=(bytes,at)=>{let value=2166136261;for(let i=0;i<window;i+=4)value=Math.imul(value^bytes.readUInt32LE(at+i),16777619);return value>>>0;};
 for(let i=0;i+window<=base.length;i+=32){const key=hash(base,i),positions=index.get(key);if(!positions)index.set(key,[i]);else if(positions.length<8)positions.push(i);}
 const segments=[];let i=0,start=0;
 while(i+window<=target.length){
  let best=0,offset=0;
  for(const at of index.get(hash(target,i))||[]){
   if(!base.subarray(at,at+window).equals(target.subarray(i,i+window)))continue;
   let size=window;while(at+size+4<=base.length&&i+size+4<=target.length&&base.readUInt32LE(at+size)===target.readUInt32LE(i+size))size+=4;
   if(size>best){best=size;offset=at;}if(best>=1024*1024)break;
  }
  if(best){if(i>start)segments.push({literal:target.subarray(start,i)});segments.push({offset,length:best});i+=best;start=i;}else i+=4;
 }
 if(start<target.length)segments.push({literal:target.subarray(start)});
 const length=20+segments.reduce((n,segment)=>n+(segment.literal?8+segment.literal.length:12),0),patch=Buffer.alloc(length);
 patch.writeUInt32LE(0x50444d31,0);patch.writeUInt32LE(1,4);patch.writeUInt32LE(base.length,8);patch.writeUInt32LE(target.length,12);patch.writeUInt32LE(segments.length,16);
 let position=20;
 for(const segment of segments){
  patch.writeUInt32LE(segment.literal?1:0,position);position+=4;
  if(segment.literal){patch.writeUInt32LE(segment.literal.length,position);position+=4;segment.literal.copy(patch,position);position+=segment.literal.length;}
  else{patch.writeUInt32LE(segment.offset,position);patch.writeUInt32LE(segment.length,position+4);position+=8;}
 }
 const array=bytes=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length);
 if(!Buffer.from(applyPreparedMeshDelta(array(base),array(patch),{decodedBytes:target.length})).equals(target))throw Error('Prepared delta changed approved mesh bytes');
 return patch;
}

/** Factor only already-prepared physical meshes. No GIS or mesh engine runs. */
export async function factorPreparedPhysicalMeshes({root=defaultRoot,apply=false,push=false}={}){
 if(push&&!apply)throw Error('Mesh publication requires applied verified storage');
 const config=libraryConfig(root),checkout=libraryCheckout(root),manifestPath='assets/data/prepared-polygons/generated/v2/manifest.json';
 const archive=JSON.parse(execFileSync('git',[...gitOptions,'show',config.revision+':archive/index.json'],{cwd:checkout,maxBuffer:16*1024*1024}));
 const read=p=>decodeArchiveEntry(checkout,archive.files[p],config.revision),original=read(manifestPath),manifest=JSON.parse(original),physical=JSON.parse(read('assets/data/physical-land/v1/manifest.json'));
 const decoded=spec=>{const stored=read(spec.url);if(stored.length!==spec.compressedBytes||hash(stored)!==spec.sha256)throw Error('Prepared source transfer mismatch: '+spec.url);
  const bytes=spec.encoding==='gzip'?gunzipSync(stored):stored;if(bytes.length!==spec.decodedBytes)throw Error('Prepared source decoded size mismatch');return bytes;};
 const json=spec=>JSON.parse(decoded(spec)),geometryKey=geometry=>hash(JSON.stringify([geometry.type,geometry.coordinates]));
 const baseGeometry=json(physical.asset),baseGeometryDigest=geometryKey(baseGeometry),base=manifest.meshes[baseGeometryDigest];
 if(!base||base.storageLayout!==undefined)throw Error('The approved base must retain its original prepared mesh');
 const baseBytes=decoded(base),files=new Map(),changes=[];
 const targets=new Map(physical.waterObjects.geometries.filter(row=>row.land.sha256!==physical.asset.sha256).map(row=>[row.land.sha256,row.land]));
 for(const land of targets.values()){
  const geometry=await loadPhysicalLandGeometry(land,{loadGeometry:json,loadPatch:json}),key=geometryKey(geometry),previous=manifest.meshes[key];
  if(previous?.storageLayout===preparedMeshDeltaLayout)continue;
  if(!previous||previous.storageLayout!==undefined)throw Error('Approved historical mesh is missing or has unsupported storage');
  const target=decoded(previous),delta=createPreparedMeshDelta(baseBytes,target),stored=gzipSync(delta,{level:9});stored[9]=3;
  if(stored.length>=previous.compressedBytes){changes.push({geometryDigest:key,unchanged:true,reason:'delta is not smaller'});continue;}
  const sha256=hash(stored),url='assets/data/prepared-polygons/generated/v2/deltas/sha256-'+sha256+'.bin.gz';files.set(url,stored);
  manifest.meshes[key]={...previous,storageLayout:preparedMeshDeltaLayout,baseGeometryDigest,base,
   replacement:{url,encoding:'gzip',sha256,compressedBytes:stored.length,decodedBytes:delta.length},baseContentSha256:hash(baseBytes),contentSha256:hash(target)};
  changes.push({geometryDigest:key,originalStoredSha256:previous.sha256,contentSha256:hash(target),baseGeometryDigest,
   beforeCompressedBytes:previous.compressedBytes,afterCompressedBytes:stored.length,decodedBytes:target.length,exactOriginalMeshBytes:true});
 }
 if(!files.size)return {revision:config.revision,unchanged:true,changes};
 files.set(manifestPath,Buffer.from(JSON.stringify(manifest,null,2)+'\n'));
 for(const [p,bytes]of files)if(existsSync(resolve(root,p))){const current=readFileSync(resolve(root,p));if(!current.equals(bytes)&&(p!==manifestPath||!current.equals(original)))throw Error('Preserve unrelated prepared mesh edit: '+p);}
 if(apply)withLibraryOutputs({root,paths:[...files.keys()].map(p=>resolve(root,p))},()=>{
  for(const [p,bytes]of files){const target=resolve(root,p);if(existsSync(target)&&readFileSync(target).equals(bytes))continue;
   mkdirSync(dirname(target),{recursive:true});const temporary=target+'.'+process.pid+'.pending';let created=false;
   try{writeFileSync(temporary,bytes,{flag:'wx'});created=true;renameSync(temporary,target);}finally{if(created&&existsSync(temporary))unlinkSync(temporary);}
  }
 });
 if(!push)return {revision:config.revision,applied:apply,changes};
 const revision=storeLibraryData({root,push:true,prefixes:[...files.keys()]}),storedArchive=JSON.parse(execFileSync('git',[...gitOptions,'show',revision+':archive/index.json'],{cwd:checkout,maxBuffer:16*1024*1024}));
 for(const [p,bytes]of files)if(!decodeArchiveEntry(checkout,storedArchive.files[p],revision).equals(bytes))throw Error('Stored mesh bytes differ: '+p);
 return {revision,applied:true,changes,verifiedStoredFiles:files.size};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await factorPreparedPhysicalMeshes({apply:process.argv.includes('--apply'),push:process.argv.includes('--push')})));
