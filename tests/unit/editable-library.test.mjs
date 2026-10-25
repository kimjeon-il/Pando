import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createTerritorialLibraryService} from "../../apps/editor/frontend/js/modules/territorial-library-service.js";
import {createTerritorialLibraryEditor} from "../../apps/editor/frontend/js/modules/territorial-library-editor.js";

const base=new URL('../../assets/data/territorial-entities/generated/v2/',import.meta.url);
const index=JSON.parse(readFileSync(new URL('index.json',base),'utf8'));
const read=id=>JSON.parse(gunzipSync(readFileSync(new URL(index.entities.find(e=>e.entityId===id).file,base))));
async function fixture(){
 let current=structuredClone(index),revision='r0',writes=0;
 const records=new Map();
 const loader={loadIndex:async()=>current,loadEntity:async id=>structuredClone(records.get(id)||read(id)),peek:()=>null,
  refresh:async()=>current};
 const repository={commit:async request=>{
  assert.equal(request.expectedRevision,revision);
  writes++; current=request.index; for(const e of request.entities)records.set(e.entityId,e);
  revision=`r${writes}`;return {revision,index:current,status:{state:'queued'}};
 }};
 const service=createTerritorialLibraryService({loader}); await service.load();
 const editor=createTerritorialLibraryEditor({service,repository,revision});
 return {service,editor,records,get writes(){return writes;}};
}
test('library metadata retains identity and exact-day dates, undo/redo and persistence without touching source',async()=>{
 const f=await fixture(),original=read('state:KOR');
 const draft=structuredClone(original);draft.names.ko='대한민국 수정본';draft.lifetime.validFrom='1948-08-15';
 await f.editor.apply({entities:[draft]});
 assert.equal(f.editor.get('state:KOR').names.ko,'대한민국 수정본');
 assert.deepEqual(await f.service.loadEntity('state:KOR'),original);
 assert.equal(f.editor.undo(),true);assert.equal(f.editor.get('state:KOR').names.ko,original.names.ko);
 assert.equal(f.editor.redo(),true);
 await f.editor.save();assert.equal(f.writes,1);
 assert.equal(f.service.get('state:KOR').lifetime.validFrom,'1948-08-15');
 assert.equal(f.records.get('state:KOR').entityId,original.entityId);
 assert.equal(f.editor.snapshot().dirty,false);
});
test('invalid versions and dangling parent deletion reject atomically before persistence',async()=>{
 const f=await fixture(),draft=read('state:KOR');
 draft.geometryVersions.push({...structuredClone(draft.geometryVersions[0]),versionId:'duplicate-period'});
 await assert.rejects(f.editor.apply({entities:[draft]}),/overlapping/);
 assert.equal(f.editor.snapshot().dirty,false);assert.equal(f.writes,0);
 const parent=index.entities.find(e=>index.entities.some(child=>child.parentEntityId===e.entityId));
 assert.ok(parent);await assert.rejects(f.editor.apply({deletedEntityIds:[parent.entityId]}),/parent|소속/);
 assert.equal(f.editor.snapshot().dirty,false);
});
test('new entity and version can be saved and deletion repairs catalog membership and snapshots',async()=>{
 const f=await fixture(),draft=read('state:KOR');
 draft.entityId='state:LibraryTest';draft.lineageId='library-test';draft.names={ko:'시험 자료'};
 await f.editor.apply({entities:[draft]});await f.editor.save();
 assert.ok(f.service.get('state:LibraryTest'));
 await f.editor.apply({deletedEntityIds:['state:LibraryTest']});await f.editor.save();
 assert.equal(f.service.get('state:LibraryTest'),null);
 assert.ok(f.service.list().length===index.entities.length);
});
test('failed local transaction keeps the unsaved batch and committed service untouched',async()=>{
 const f=await fixture(),draft=read('state:KOR');draft.names.ko='보존할 변경';
 const editor=createTerritorialLibraryEditor({service:f.service,repository:{commit:async()=>{throw new Error('disk full');}},revision:'r0'});
 await editor.apply({entities:[draft]});await assert.rejects(editor.save(),/disk full/);
 assert.equal(editor.snapshot().dirty,true);assert.equal(editor.get('state:KOR').names.ko,'보존할 변경');
 assert.notEqual(f.service.get('state:KOR').names.ko,'보존할 변경');
});
test('external raw-file fingerprint follows normalized edits into the atomic commit',async()=>{
 const f=await fixture(),draft=read('state:KOR');draft.geometryVersions[0].validFrom='1948-08-15';let submitted;
 const editor=createTerritorialLibraryEditor({service:f.service,repository:{commit:async request=>{submitted=request;return {revision:'external-saved',index:request.index};}},revision:'r0'});
 await editor.apply({entities:[draft],externalRevision:'external-fingerprint'});await editor.save();
 assert.equal(submitted.externalRevision,'external-fingerprint');
 assert.equal(submitted.entities[0].geometryVersions[0].historicalProvenance.evidenceStatus,'provisional');
});
