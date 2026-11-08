// One-time comparison boundary for former native storage. It never writes source,
// generated chunks, runtime data, or the old archive; conflicts remain explicit.
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {existsSync,readFileSync,mkdirSync,writeFileSync,renameSync,unlinkSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {normalizeTerritorialLibraryEntity} from '../gis/territorial-library.js';
import {territorialSourceIndex,readTerritorialArchiveDescriptor} from './territorial-source-archive.mjs';
import {defaultRoot,libraryCheckout,libraryConfig,gitOptions,decodeArchiveEntry} from './library-context.mjs';
import {atomicStorageJSON} from './library-content.mjs';
import {encodeTerritorialSource,decodeTerritorialSource} from './territorial-source-codec.mjs';
import {withLibraryOutputs} from './library-runtime.mjs';
import {storeLibraryData} from './library-store.mjs';
import {territorialSourceLayout} from '../../src/data/territorial-source-format.js';

/** Explicit representation conversion of approved inline authoring inputs. */
export function factorTerritorialSourceGeometryStorage(sources){
 const files=new Map();let sourceBytes=0,descriptorBytes=0;
 for(const [file,bytes]of sources){
  const entity=JSON.parse(bytes),expected='countries/'+entity.entityId.replace(':','-')+'.json';
  if(file!==expected)throw Error('Source filename identity mismatch: '+file);
  const encoded=encodeTerritorialSource(entity);
  if(JSON.stringify(decodeTerritorialSource(encoded.descriptor,p=>encoded.geometries.get(p)))!==JSON.stringify(entity))throw Error('Ordered source document changed: '+entity.entityId);
  const descriptor=Buffer.from(JSON.stringify(encoded.descriptor,null,2)+'\n');files.set(file,descriptor);
  sourceBytes+=bytes.length;descriptorBytes+=descriptor.length;
  for(const [p,b]of encoded.geometries){if(files.has(p)&&!files.get(p).equals(b))throw Error('Conflicting source geometry identity: '+p);files.set(p,b);}
 }
 const geometries=[...files].filter(([p])=>p.startsWith('geometries/'));
 return {files,verification:{entities:sources.size,exactOrderedDocuments:true,geometryPayloads:geometries.length,
  sourceBytes,descriptorBytes,geometryBytes:geometries.reduce((n,[,bytes])=>n+bytes.length,0)}};
}

export function factorTerritorialSourceFiles({root=defaultRoot,apply=false,push=false}={}){
 if(push&&!apply)throw Error('Source publication requires an applied, verified conversion');
 const config=libraryConfig(root),checkout=libraryCheckout(root),prefix='assets/data/territorial-entities/source/';
 const archive=JSON.parse(execFileSync('git',[...gitOptions,'show',config.revision+':archive/index.json'],{cwd:checkout,maxBuffer:16*1024*1024}));
 const sources=new Map();
 for(const [p,entry]of Object.entries(archive.files))if(p.startsWith(prefix+'countries/'))sources.set(p.slice(prefix.length),decodeArchiveEntry(checkout,entry,config.revision));
 if(!sources.size)throw Error('Missing pinned source countries');
 if([...sources.values()].every(bytes=>JSON.parse(bytes).storageLayout===territorialSourceLayout))return {unchanged:true,revision:config.revision};
 const result=factorTerritorialSourceGeometryStorage(sources),pending=[];
 for(const [file,bytes]of result.files){
  const p=prefix+file,target=resolve(root,p);
  if(existsSync(target)){
   const current=readFileSync(target);if(current.equals(bytes))continue;
   if(!sources.has(file)||hash(current)!==archive.files[p]?.sha256)throw Error('Preserve unrelated source edit before conversion: '+p);
  }
  pending.push({file,target,bytes});
 }
 if(apply&&pending.length)withLibraryOutputs({root,paths:pending.map(row=>row.target)},()=>{
  // The descriptor is committed last; an interrupted conversion can resume.
  for(const {target,bytes}of pending.sort((a,b)=>Number(b.file.startsWith('geometries/'))-Number(a.file.startsWith('geometries/')))){
   mkdirSync(dirname(target),{recursive:true});const temporary=target+'.'+process.pid+'.pending';let created=false;
   try{writeFileSync(temporary,bytes,{flag:'wx'});created=true;renameSync(temporary,target);}
   finally{if(created&&existsSync(temporary))unlinkSync(temporary);}
  }
 });
 if(!push)return {...result.verification,applied:apply,revision:config.revision};
 const prefixes=[...result.files.keys()].map(file=>prefix+file);
 const revision=storeLibraryData({root,push:true,prefixes,readPreviousSource:p=>{
  const bytes=sources.get(p.slice(prefix.length));if(!bytes)throw Error('Unknown source migration input: '+p);return JSON.parse(bytes);
 }});
 const storedArchive=JSON.parse(execFileSync('git',[...gitOptions,'show',revision+':archive/index.json'],{cwd:checkout,maxBuffer:16*1024*1024}));
 for(const [file,bytes]of result.files){const p=prefix+file;if(!decodeArchiveEntry(checkout,storedArchive.files[p],revision).equals(bytes))throw Error('Stored source conversion differs: '+p);}
 return {...result.verification,applied:true,revision,verifiedStoredFiles:result.files.size};
}

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
  ?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
const stable=value=>JSON.stringify(canonical(value));
function differences(left,right){
 const fields=[];
 for(const key of new Set([...Object.keys(left),...Object.keys(right)])){
  if(stable(left[key])===stable(right[key]))continue;
  if(key!=='geometryVersions'){fields.push(key);continue;}
  const a=new Map(left.geometryVersions.map(v=>[v.versionId,v])),b=new Map(right.geometryVersions.map(v=>[v.versionId,v]));
  for(const id of new Set([...a.keys(),...b.keys()])){
   if(!a.has(id)||!b.has(id)){fields.push('geometryVersions['+id+']');continue;}
   for(const field of new Set([...Object.keys(a.get(id)),...Object.keys(b.get(id))]))
    if(stable(a.get(id)[field])!==stable(b.get(id)[field]))fields.push('geometryVersions['+id+'].'+field);
  }
 }
 return fields.sort();
}
export function assessTerritorialSourceMigration({revision,archive,legacyManifest,readBlob,previous=null}){
 if(!/^[a-f0-9]{40}$/.test(revision||'')||legacyManifest?.schemaVersion!==1
  ||!legacyManifest.entities||Array.isArray(legacyManifest.entities)||typeof readBlob!=='function')throw Error('Invalid native migration inputs');
 const index=territorialSourceIndex(archive),rows=[];
 const completed=new Map(previous?.schema==='pando-territorial-source-migration-v1'?previous.rows.map(row=>[row.entityId,row]):[]);
 for(const entityId of [...new Set([...Object.keys(index.entities),...Object.keys(legacyManifest.entities)])].sort()){
  const sourceSha256=index.entities[entityId]??null,nativeSha256=legacyManifest.entities[entityId]??null;
  const row={entityId,sourceSha256,nativeSha256,status:'conflict',differences:[]};
  try{
   if(!sourceSha256||!nativeSha256)throw Error('Missing source or native edition');
   if(!/^[a-f0-9]{64}$/.test(nativeSha256))throw Error('Invalid native object identity');
   const sourceBytes=readTerritorialArchiveDescriptor(index,entityId,readBlob).bytes;
   let nativeBytes;
   try{nativeBytes=readBlob('objects/'+nativeSha256+'.json');}
   catch(error){
    // Some archived manifests outlive their materialized object paths. A
    // byte-exact hash proof can establish the same already-present source;
    // this never guesses content, rewrites the source, or restores old storage.
    const candidate=Buffer.from(JSON.stringify(JSON.parse(sourceBytes))+'\n');
    if(hash(candidate)!==nativeSha256)throw error;
    nativeBytes=candidate;row.nativeRecovery='source-exact-content-hash';
   }
   if(!Buffer.isBuffer(nativeBytes)||hash(nativeBytes)!==nativeSha256)throw Error('Native object hash mismatch');
   const prior=completed.get(entityId);
   if(prior?.status==='matched'&&prior.sourceSha256===sourceSha256&&prior.nativeSha256===nativeSha256){rows.push(prior);continue;}
   const source=normalizeTerritorialLibraryEntity(JSON.parse(sourceBytes)),native=normalizeTerritorialLibraryEntity(JSON.parse(nativeBytes));
   if(source.entityId!==entityId||native.entityId!==entityId)throw Error('Migration object identity mismatch');
   row.differences=differences(source,native);
   row.status=row.differences.length?'conflict':'matched';
   row.geometryReferences=source.geometryVersions.map(v=>({versionId:v.versionId,
    sha256:hash(Buffer.from(stable(v.geometry)))}));
  }catch(error){row.error=error.message;}
  rows.push(row);
 }
 const matched=rows.filter(row=>row.status==='matched').length;
 return {schema:'pando-territorial-source-migration-v1',revision,ready:matched===rows.length,
  matched,conflicts:rows.length-matched,rows};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=process.argv.find(arg=>arg.startsWith('--root='))?.slice(7)||defaultRoot;
 const checkpoint=process.argv.find(arg=>arg.startsWith('--checkpoint='))?.slice(13);
 if(process.argv.includes('--factor-geometries')){
  const result=factorTerritorialSourceFiles({root,apply:process.argv.includes('--apply'),push:process.argv.includes('--push')});
  if(checkpoint)atomicStorageJSON(resolve(checkpoint),result);
  console.log(JSON.stringify(result));
 }else{
 if(!checkpoint)throw Error('Explicit --checkpoint=<comparison result> is required');
 const revision=libraryConfig(root).revision,checkout=libraryCheckout(root);
 const readBlob=path=>execFileSync('git',[...gitOptions,'show',revision+':'+path],{
  cwd:checkout,env:{...process.env,GIT_NO_LAZY_FETCH:'1'},maxBuffer:48*1024*1024,stdio:['ignore','pipe','pipe']});
 const result=assessTerritorialSourceMigration({revision,readBlob,
  archive:JSON.parse(readBlob('archive/index.json')),legacyManifest:JSON.parse(readBlob('library.json')),
  previous:existsSync(checkpoint)?JSON.parse(readFileSync(checkpoint,'utf8')):null});
 atomicStorageJSON(resolve(checkpoint),result);
 console.log(JSON.stringify({revision,ready:result.ready,matched:result.matched,conflicts:result.conflicts,checkpoint:resolve(checkpoint)}));
 if(!result.ready)process.exitCode=1;
 }
}
