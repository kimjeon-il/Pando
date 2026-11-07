import test from 'node:test';
import assert from 'node:assert/strict';
import {createBuiltinSession} from '../../shared/frontend/js/modules/builtin-session.js';

function fixture(){
  let generation=1,reads=0,admissions=0;
  const meta={dataRevision:'rev1',builtinWorld:{sha256:'a'.repeat(64)}};
  const state={storageBaselineId:0,documentDirty:false,timelineCursor:'2026-10'};
  const owner=createBuiltinSession({buildMeta:meta,
    builtinWorldLoader:{loadProject:async month=>{
      reads++;
      return {project:{projectSetup:{initialMonth:month,sourceMode:'builtin'},
        territorialEntities:[{id:'country',properties:{name:'Test'}}],timelineRecords:{
          schemaVersion:3,lifetimes:[],geometryBindings:[],parentRelations:[],propertyBindings:[]}}};
    }}});
  owner.connect({platformConfigurationA:{BASE_DATASET:'test'},domains:{projectDomain:{
    getGeneration:()=>generation,state:()=>state,
    admitStorageBaseline:async()=>{admissions++;state.storageBaselineId=admissions;return {storageBaselineId:admissions};},
  }}});
  return {owner,meta,state,reads:()=>reads,admissions:()=>admissions,advance:()=>generation++};
}

test('a complete project is not copied into a retained month-by-month source cache',async()=>{
  const f=fixture();const a=await f.owner.prepareProjectSource('2026-10');
  const b=await f.owner.prepareProjectSource('2025-12');
  assert.equal(f.reads(),2);
  assert.equal(a.sourceMonth,'2026-10');assert.equal(b.sourceMonth,'2025-12');
  assert.notEqual(a.fingerprint,b.fingerprint,'month is only the requested initial document cursor');
  assert.equal(Object.hasOwn(f.owner,'sourceCacheStats'),false);
  assert.equal(Object.hasOwn(f.owner,'clearPreparedSourceCache'),false);
  assert.equal(f.admissions(),0,'preparation is read-only');
  const copy=a.sourceBytes;copy.fill(0);
  assert.equal(JSON.parse(new TextDecoder().decode(a.sourceBytes)).projectSetup.initialMonth,'2026-10');
  f.owner.dispose();
});

test('Core admission stays generation-scoped and a stale source cannot publish',async()=>{
  const f=fixture(),source=await f.owner.prepareProjectSource('2026-10');
  f.advance();
  await assert.rejects(f.owner.admitPreparedProjectSource(source),{code:'PL-CORE-STALE'});
  const renewed=await f.owner.prepareProjectSource('2026-10');
  const receipt=await f.owner.admitPreparedProjectSource(renewed);
  assert.equal(receipt.baselineId,1);
  assert.equal(f.admissions(),1);f.owner.dispose();
});

test('the same admitted Core baseline can be reused without a second world load',async()=>{
  const f=fixture(),first=await f.owner.prepareProjectBaseline('2026-10');
  const again=await f.owner.prepareProjectBaseline('2026-10');
  assert.strictEqual(again,first);
  assert.equal(f.reads(),1);assert.equal(f.admissions(),1);
  f.owner.dispose();
});

test('pin changes invalidate pending admission and dispose cancels future work',async()=>{
  const f=fixture(),prepared=await f.owner.prepareProjectSource('2026-10');
  f.meta.dataRevision='rev2';
  await assert.rejects(f.owner.admitPreparedProjectSource(prepared),{code:'PL-CORE-STALE'});
  const renewed=await f.owner.prepareProjectSource('2026-10');
  f.owner.dispose();
  await assert.rejects(f.owner.admitPreparedProjectSource(renewed),{code:'PL-CORE-STALE'});
  await assert.rejects(f.owner.prepareProjectSource('2026-10'),{code:'PL-CORE-STALE'});
  assert.equal(f.admissions(),0);
});
