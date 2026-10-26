import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createNativeLibraryRepository} from "../../apps/editor/frontend/js/modules/native-library-repository.js";
import {createRepositoryTerritorialLoader} from "../../apps/editor/frontend/js/modules/territorial-entity-loader.js";
import {encodeTerritorialIndexEntry} from "../../apps/editor/frontend/js/modules/territorial-index-entry.js";
const base=new URL('../../assets/data/territorial-entities/generated/v2/',import.meta.url);
const index=JSON.parse(readFileSync(new URL('index.json',base),'utf8'));
test('external repository revision invalidates loaded entities after an atomic source save',async()=>{
 const source=JSON.parse(gunzipSync(readFileSync(new URL('state-KOR.json.gz',base))));let revision='one';let current=source,catalog=structuredClone(index);
 const calls=[];
 const repository=createNativeLibraryRepository({invoke:async(command,payload)=>{
  calls.push([command,payload]);
  if(command==='library_open')return {revision,index:catalog,status:{state:'queued'}};
  if(command==='library_read_entity')return structuredClone(current);
  if(command==='library_commit'){current=payload.request.entities[0];catalog=payload.request.index;revision='two';return {revision,index:catalog,status:{state:'queued'}};}
  throw new Error(command);
 }});
 const loader=createRepositoryTerritorialLoader(repository);await loader.loadIndex();
 assert.equal((await loader.loadEntity('state:KOR')).names.ko,source.names.ko);
 const changed=structuredClone(source);changed.names.ko='외부 수정';
 const changedEntry=await encodeTerritorialIndexEntry(changed);
 const changedIndex={...catalog,entities:catalog.entities.map(e=>e.entityId===changed.entityId?changedEntry:e)};
 await repository.commit({expectedRevision:'one',index:changedIndex,entities:[changed],deletedEntityIds:[]});
 assert.equal(loader.peek('state:KOR'),null);
 assert.equal((await loader.loadEntity('state:KOR')).names.ko,'외부 수정');
 assert.equal(calls.filter(([c])=>c==='library_read_entity').length,2);
});
test('native repository requires a real bridge and rejects malformed read receipts',async()=>{
 assert.throws(()=>createNativeLibraryRepository(),/bridge|네이티브/);
 const repo=createNativeLibraryRepository({invoke:async()=>({revision:'',index})});
 assert.equal(Object.hasOwn(repo,'publish'),false);
 await assert.rejects(repo.open(),/revision|판본/);
});
function singleIndex(){
 const copy=structuredClone(index);copy.entities=copy.entities.filter(e=>e.entityId==='state:KOR');
 copy.lineages=copy.lineages.filter(l=>l.entityRefs.includes('state:KOR')).map(l=>({...l,entityRefs:['state:KOR'],relations:[]}));
 copy.snapshots=copy.snapshots.map(s=>({...s,entityRefs:s.entityRefs.filter(id=>id==='state:KOR')}));
 copy.views=copy.views.map(v=>({...v,selections:v.selections.filter(row=>row.entityId==='state:KOR')}));return copy;
}
test('remote sources are fully validated before the native sync admission call',async()=>{
 const source=JSON.parse(gunzipSync(readFileSync(new URL('state-KOR.json.gz',base))));const catalog=singleIndex();
 const candidate='a'.repeat(64),admissions=[];
 const repository=createNativeLibraryRepository({invoke:async(command,payload)=>{
  if(command==='library_open')return {revision:'local',index:catalog,status:{state:'synced'}};
  if(command==='library_sync'){
   if(payload.validatedRevision){admissions.push(payload.validatedRevision);return {state:'synced'};}
   return {state:'validation-required',candidateRevision:candidate};
  }
  if(command==='library_read_candidate')return payload.entityId?structuredClone(source):catalog;
  throw new Error(command);
 }});
 await repository.open();assert.equal((await repository.sync()).state,'synced');assert.deepEqual(admissions,[candidate]);
 source.lifetime.validFrom='invalid';
 await assert.rejects(repository.sync(),/원격|Invalid|형식/);assert.deepEqual(admissions,[candidate]);
 assert.equal(repository.snapshot().revision,'local');
});
test('remote index/source metadata disagreement cannot advance the active source',async()=>{
 const source=JSON.parse(gunzipSync(readFileSync(new URL('state-KOR.json.gz',base))));source.names.ko='다른 이름';let admitted=false;
 const repository=createNativeLibraryRepository({invoke:async(command,payload)=>{
  if(command==='library_sync'){if(payload.validatedRevision)admitted=true;return {state:'validation-required',candidateRevision:'b'.repeat(64)};}
  if(command==='library_read_candidate')return payload.entityId?source:singleIndex();
  throw new Error(command);
 }});
 await assert.rejects(repository.sync(),/metadata|일치|원격/);assert.equal(admitted,false);
});
