import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {createNativeLibraryRepository} from "../../apps/editor/frontend/js/modules/native-library-repository.js";
import {createRepositoryTerritorialLoader} from "../../apps/editor/frontend/js/modules/territorial-entity-loader.js";
import {encodeTerritorialIndexEntry,territorialIndexEntry} from "../../apps/editor/frontend/js/modules/territorial-index-entry.js";
const fixtureSource={schemaVersion:2,entityId:'state:fixture',entityKind:'general',lineageId:'fixture',names:{ko:'합성 정치체',en:'Synthetic'},alternateNames:[],
 lifetime:{validFrom:null,validTo:null},parentEntityId:'',instantiation:{mode:'independent',countryUpdates:{}},metadata:{},sourceInfo:{sourceId:'fixture',title:'Synthetic',license:'test'},
 geometryVersions:[{versionId:'state:fixture:v1',validFrom:null,validTo:null,certainty:'reviewed',sourceId:'fixture',geometry:{type:'Polygon',coordinates:[[[0,0],[0,1],[1,1],[1,0],[0,0]]]}}]};
const entityRaw=Buffer.from(JSON.stringify(fixtureSource,null,2)+'\n'),entityBytes=gzipSync(entityRaw);
const hash=value=>createHash('sha256').update(value).digest('hex');
const fixtureEntry=territorialIndexEntry(fixtureSource,{sha256:hash(entityBytes),compressedBytes:entityBytes.length,decodedBytes:entityRaw.length});
const index={schemaVersion:2,entities:[fixtureEntry],lineages:[{schemaVersion:2,lineageId:'fixture',names:{ko:'검증'},entityRefs:['state:fixture'],relations:[]}],snapshots:[],views:[]};
test('external repository revision invalidates loaded entities after an atomic source save',async()=>{
 const source=structuredClone(fixtureSource);let revision='one';let current=source,catalog=structuredClone(index);
 const calls=[];
 const repository=createNativeLibraryRepository({invoke:async(command,payload)=>{
  calls.push([command,payload]);
  if(command==='library_open')return {revision,index:catalog,status:{state:'queued'}};
  if(command==='library_read_entity')return structuredClone(current);
  if(command==='library_commit'){current=payload.request.entities[0];catalog=payload.request.index;revision='two';return {revision,index:catalog,status:{state:'queued'}};}
  throw new Error(command);
 }});
 const loader=createRepositoryTerritorialLoader(repository);await loader.loadIndex();
 assert.equal((await loader.loadEntity('state:fixture')).names.ko,source.names.ko);
 const changed=structuredClone(source);changed.names.ko='외부 수정';
 const changedEntry=await encodeTerritorialIndexEntry(changed);
 const changedIndex={...catalog,entities:catalog.entities.map(e=>e.entityId===changed.entityId?changedEntry:e)};
 await repository.commit({expectedRevision:'one',index:changedIndex,entities:[changed],deletedEntityIds:[]});
 assert.equal(loader.peek('state:fixture'),null);
 assert.equal((await loader.loadEntity('state:fixture')).names.ko,'외부 수정');
 assert.equal(calls.filter(([c])=>c==='library_read_entity').length,2);
});
test('native repository requires a real bridge and rejects malformed read receipts',async()=>{
 assert.throws(()=>createNativeLibraryRepository(),/bridge|네이티브/);
 const repo=createNativeLibraryRepository({invoke:async()=>({revision:'',index})});
 assert.equal(Object.hasOwn(repo,'publish'),false);
 await assert.rejects(repo.open(),/revision|판본/);
});
function singleIndex(){return structuredClone(index);}

test('remote sources are fully validated before the native sync admission call',async()=>{
 const source=structuredClone(fixtureSource);const catalog=singleIndex();
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
 const source=structuredClone(fixtureSource);source.names.ko='다른 이름';let admitted=false;
 const repository=createNativeLibraryRepository({invoke:async(command,payload)=>{
  if(command==='library_sync'){if(payload.validatedRevision)admitted=true;return {state:'validation-required',candidateRevision:'b'.repeat(64)};}
  if(command==='library_read_candidate')return payload.entityId?source:singleIndex();
  throw new Error(command);
 }});
 await assert.rejects(repository.sync(),/metadata|일치|원격/);assert.equal(admitted,false);
});

test('library access uses the injected native repository and retains local data when synchronization fails',async()=>{
 const {openTerritorialLibraryAccess}=await import('../../apps/editor/frontend/js/modules/territorial-entity-loader.js');
 assert.equal(typeof openTerritorialLibraryAccess,'function');
 const events=[];
 const repository=createNativeLibraryRepository({invoke:async command=>{
  events.push(command);
  if(command==='library_open')return {revision:'local',index};
  if(command==='library_sync')throw Error('offline');
  if(command==='library_read_entity')return structuredClone(fixtureSource);
  throw Error(command);
 }});
 const access=await openTerritorialLibraryAccess({repository,onSyncError:error=>events.push(error.message)});
 assert.equal(access.editingRepository,repository);
 assert.deepEqual(await access.loader.loadEntity('state:fixture'),await createRepositoryTerritorialLoader(repository).loadEntity('state:fixture'));
 assert.deepEqual(events.slice(0,3),['library_open','library_sync','offline']);
});

test('HTTP and native library ports expose the same selected synthetic source',async()=>{
 const {openTerritorialLibraryAccess}=await import('../../apps/editor/frontend/js/modules/territorial-entity-loader.js');
 assert.equal(typeof openTerritorialLibraryAccess,'function');
 const indexBytes=Buffer.from(JSON.stringify(index));
 const http=await openTerritorialLibraryAccess({source:{indexUrl:'https://fixture.test/index.json',indexSpec:{sha256:hash(indexBytes),decodedBytes:indexBytes.length},dataRevision:'fixture',cacheStorage:null,
  fetchFn:async url=>new Response(String(url).includes('index.json')?indexBytes:entityBytes)}});
 const repository=createNativeLibraryRepository({invoke:async command=>{
  if(command==='library_open')return {revision:'local',index};
  if(command==='library_sync')return {state:'synced'};
  if(command==='library_read_entity')return structuredClone(fixtureSource);
  throw Error(command);
 }});
 const native=await openTerritorialLibraryAccess({repository,onSyncError:assert.fail});
 assert.equal(http.editingRepository,null);
 assert.deepEqual(await http.loader.loadEntity('state:fixture'),await native.loader.loadEntity('state:fixture'));
});
