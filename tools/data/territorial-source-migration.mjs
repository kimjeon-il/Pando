// One-time comparison boundary for former native storage. It never writes source,
// generated chunks, runtime data, or the old archive; conflicts remain explicit.
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {normalizeTerritorialLibraryEntity} from '../gis/territorial-library.js';
import {territorialSourceIndex,readTerritorialArchiveEntity} from './territorial-source-archive.mjs';
import {defaultRoot,libraryCheckout,libraryConfig,gitOptions} from './library-context.mjs';
import {atomicStorageJSON} from './library-content.mjs';

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
   const sourceBytes=readTerritorialArchiveEntity(index,entityId,readBlob).bytes;
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
