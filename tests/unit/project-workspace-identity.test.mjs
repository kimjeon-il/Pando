import test from 'node:test';
import assert from 'node:assert/strict';
import {createPersistenceService} from "../../apps/editor/frontend/js/modules/persistence-service.js";
test('workspace restore uses document identity across saves and rejects another document camera',async()=>{
  const saved={documentId:'A',savedAt:'new-save'},writes=[],tasks=new Map();let current='A';
  const service=createPersistenceService({storage:{readProject:async()=>saved,readFallback:()=>null,
    readView:async id=>{assert.equal(id,'A');return {documentId:'A',lastViewedMonth:'1914-07',projection:'flat',view:{flatZoom:3},savedAt:'old-save'};},writeView:async v=>writes.push(v)},
    scheduler:{scheduleIdle:(key,task)=>tasks.set(key,task),cancel:key=>tasks.delete(key)},canPersist:()=>true,
    buildAutosave:async()=>({project:saved,checkpoint:{}}),readView:()=>({documentId:current,lastViewedMonth:'1914-07'}),validateProject:async()=>{},
    onDirty(){},onAutosaveState(){},onSaved(){},onFailure(){}});
  const result=await service.restore();assert.equal(result.view.lastViewedMonth,'1914-07');assert.equal(result.view.view.flatZoom,3);
  service.queueView();current='B';await tasks.get('view-autosave')();assert.equal(writes.length,0,'late A work must not write B');
});

test('unsupported autosave remains protected from background overwrite',async()=>{
 const original={schemaVersion:12,documentId:'old',payload:'preserve these bytes'};let writes=0;
 const service=createPersistenceService({storage:{readProject:async()=>original,readFallback:()=>null},
   scheduler:{scheduleIdle(){},cancel(){}},canPersist:()=>true,buildAutosave:async()=>{writes++;return {project:{schemaVersion:14},checkpoint:{}};},
   readView:()=>({documentId:'new'}),validateProject:async()=>{throw new Error('UNSUPPORTED_VERSION');},
   onDirty(){},onAutosaveState(){},onSaved(){},onFailure(){}});
 const result=await service.restore();assert.match(result.error.message,/UNSUPPORTED_VERSION/);
 service.queueProject();await service.persist();
 assert.equal(writes,0);assert.equal(service.getRecovery().kind,'unsupported');
 assert.deepEqual(original,{schemaVersion:12,documentId:'old',payload:'preserve these bytes'});
});

for(const deferResolution of [false,true])for(const unsupportedSource of ['indexeddb','localstorage'])test(`mixed current and unsupported autosaves preserve both slots: ${unsupportedSource}, defer=${deferResolution}`,async()=>{
 const old={schemaVersion:12,documentId:'old',bytes:'unchanged'},current={schemaVersion:14,documentId:'current'};
 let db=unsupportedSource==='indexeddb'?old:current,local=unsupportedSource==='localstorage'?old:current,writes=0;
 const service=createPersistenceService({storage:{readProject:async()=>db,readFallback:()=>local,readView:async()=>null,
   writeProject:async value=>{writes++;db=value;},removeFallback:()=>{writes++;local=null;}},
   scheduler:{scheduleIdle(){},cancel(){}},canPersist:()=>true,buildAutosave:async()=>{writes++;return {project:current,checkpoint:{}};},
   readView:()=>({documentId:'current'}),validateProject:async value=>{if(value.schemaVersion!==14)throw new Error('UNSUPPORTED_VERSION');},
   onDirty(){},onAutosaveState(){},onSaved(){},onFailure(){}});
 const restored=await service.restore({deferResolution});assert.equal(restored.project,current);
 service.queueProject();await service.persist();assert.equal(writes,0);assert.equal(service.getRecovery().kind,'unsupported');
 assert.equal(unsupportedSource==='indexeddb'?db:local,old);
});
