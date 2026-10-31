import test from 'node:test';
import assert from 'node:assert/strict';
import {createBuiltinSession} from '../../shared/frontend/js/modules/builtin-session.js';

function fixture({sourceCacheLimits, pinned=true, loader=null, admit=null}={}) {
 const buildMeta=pinned?{dataRevision:'data-revision-A',builtinWorld:{
  sha256:'a'.repeat(64),url:'assets/data/builtin-world/generated/v1/index.json'}}:undefined;
 const core={timelineCursor:'2026-10',checkpoint:9,presentationCheckpoint:7,storageBaselineId:0,
  canUndo:false,canRedo:false,documentDirty:false,presentationDirty:false};
 const document={documentId:'active',territorialEntities:[{id:'original'}]};
 let generation=2,reads=0,serializations=0,baselineId=30;
 const admissions=[];
 const sourceLoader=loader||{async loadProject(month) {
  reads++;
  return {project:{toJSON(){
   serializations++;
   return {projectSetup:{initialMonth:month,sourceMode:'builtin'},
    territorialEntities:[{id:month,properties:{name:month}}],
    geometries:[],timelineRecords:{schemaVersion:3,lifetimes:[],geometryBindings:[],parentRelations:[],propertyBindings:[]}};
  }}};
 }};
 const domain={
  getGeneration:()=>generation,
  state:()=>({...core}),
  admitStorageBaseline:async(facts,options)=>{
   admissions.push({facts,options});
   if(admit)await admit();
   core.storageBaselineId=++baselineId;
   return {storageBaselineId:baselineId};
  },
 };
 const session=createBuiltinSession({builtinWorldLoader:sourceLoader,buildMeta,sourceCacheLimits});
 session.connect({domains:{projectDomain:domain},platformConfigurationA:{BASE_DATASET:'builtin-fixture'}});
 return {session,buildMeta,core,document,admissions,reads:()=>reads,serializations:()=>serializations,
  advance:()=>{generation++;},generation:()=>generation};
}

test('P2-2 A-B-A revisits reuse immutable verified bytes and skip read, serialize and SHA',async()=>{
 const f=fixture(),original=structuredClone(f.core),doc=structuredClone(f.document);
 const a=await f.session.prepareProjectSource('2026-10');
 const b=await f.session.prepareProjectSource('2025-12');
 const again=await f.session.prepareProjectSource('2026-10');
 assert.equal(f.reads(),2);assert.equal(f.serializations(),2);
 assert.notEqual(a,again);
 assert.equal(a.fingerprint,again.fingerprint);
 assert.equal(again.expectedGeneration,2);
 assert.deepEqual([...a.sourceBytes],[...again.sourceBytes]);
 assert.deepEqual(f.core,original);assert.deepEqual(f.document,doc);
 assert.equal(f.admissions.length,0);
 const stats=f.session.sourceCacheStats();
 assert.equal(stats.hits,1);assert.equal(stats.entries,2);
 assert.ok(stats.bytes>0&&stats.bytes<=stats.maxBytes);
 assert.ok(Object.isFrozen(stats));
 // The source cache contains no Core baseline handle and does not publish a receipt.
 assert.equal(f.session.projectBaseline,null);
 assert.equal(again.baselineId,undefined);
});

test('P2-2 revisiting after a Core generation change yields a fresh generation-bound candidate',async()=>{
 const f=fixture(),old=await f.session.prepareProjectSource('2026-10');
 const receipt=await f.session.admitPreparedProjectSource(old);
 f.advance();
 await assert.rejects(f.session.admitPreparedProjectSource(old),{code:'PL-CORE-STALE'});
 const fresh=await f.session.prepareProjectSource('2026-10');
 assert.equal(f.reads(),1);
 assert.equal(fresh.expectedGeneration,f.generation());
 const receipt2=await f.session.admitPreparedProjectSource(fresh);
 assert.notEqual(receipt.baselineId,receipt2.baselineId);
 assert.equal(f.admissions.length,2);
 assert.equal(f.session.sourceCacheStats().hits,1);
});

test('P2-2 source cache is LRU capped by two entries and explicit total bytes',async()=>{
 const f=fixture({sourceCacheLimits:{maxEntries:2,maxBytes:4096}});
 await f.session.prepareProjectSource('2026-10');
 await f.session.prepareProjectSource('2025-12');
 const firstStats=f.session.sourceCacheStats();
 assert.equal(firstStats.entries,2);
 await f.session.prepareProjectSource('2024-12');
 assert.equal(f.session.sourceCacheStats().entries,2);
 assert.ok(f.session.sourceCacheStats().evictions>=1);
 await f.session.prepareProjectSource('2025-12');
 assert.equal(f.reads(),3,'second-most-recent still cached');
 await f.session.prepareProjectSource('2026-10');
 assert.equal(f.reads(),4,'oldest evicted and reassembled');
 assert.ok(f.session.sourceCacheStats().bytes<=4096);
 const oversized=fixture({sourceCacheLimits:{maxEntries:2,maxBytes:1}});
 await oversized.session.prepareProjectSource('2025-12');
 await oversized.session.prepareProjectSource('2025-12');
 assert.equal(oversized.reads(),2);
 assert.equal(oversized.session.sourceCacheStats().entries,0);
 assert.equal(oversized.session.sourceCacheStats().bytes,0);
});

test('P2-2 content cache invalidates on pinned catalog/data revision and never admits old candidate',async()=>{
 const f=fixture(),first=await f.session.prepareProjectSource('2025-12');
 f.buildMeta.dataRevision='data-revision-B';
 await assert.rejects(f.session.admitPreparedProjectSource(first),{code:'PL-CORE-STALE'});
 const second=await f.session.prepareProjectSource('2025-12');
 assert.equal(f.reads(),2);
 assert.equal(f.session.sourceCacheStats().entries,1);
 assert.equal(f.admissions.length,0);
 f.buildMeta.builtinWorld.sha256='b'.repeat(64);
 await f.session.prepareProjectSource('2025-12');
 assert.equal(f.reads(),3);
 assert.ok(f.session.sourceCacheStats().bytes<=f.session.sourceCacheStats().maxBytes);
});

test('P2-2 without a verifiable pinned catalog never reuses a source',async()=>{
 const f=fixture({pinned:false});
 await f.session.prepareProjectSource('2025-12');
 await f.session.prepareProjectSource('2025-12');
 assert.equal(f.reads(),2);
 assert.equal(f.session.sourceCacheStats().entries,0);
});

test('P2-2 corrupt/stale or failed requests are not cached, including a hit cancelled by caller',async()=>{
 let fail=true,reads=0;
 const f=fixture({loader:{loadProject:async month=>{
  reads++;
  if(fail){fail=false;throw new Error('corrupt source');}
  return {project:{projectSetup:{initialMonth:month}}};
 }}});
 await assert.rejects(f.session.prepareProjectSource('2025-12'),/corrupt/);
 assert.equal(f.session.sourceCacheStats().entries,0);
 await f.session.prepareProjectSource('2025-12');
 await assert.rejects(f.session.prepareProjectSource('2025-12',{isCurrent:()=>false}),{code:'PL-CORE-STALE'});
 assert.equal(reads,2);
 const ok=await f.session.prepareProjectSource('2025-12');
 assert.equal(ok.sourceMonth,'2025-12');
 assert.equal(f.admissions.length,0);
});

test('P2-2 external byte mutation, dispose and late results cannot corrupt retained state',async()=>{
 const f=fixture();
 const candidate=await f.session.prepareProjectSource('2025-12');
 const mutation=candidate.sourceBytes;
 mutation.fill(0);
 const actual=JSON.parse(new TextDecoder().decode(candidate.sourceBytes));
 assert.equal(actual.projectSetup.initialMonth,'2025-12');
 f.session.dispose();
 assert.equal(f.session.sourceCacheStats().entries,0);
 assert.equal(f.session.sourceCacheStats().bytes,0);
 await assert.rejects(f.session.prepareProjectSource('2025-12'),{code:'PL-CORE-STALE'});
 await assert.rejects(f.session.admitPreparedProjectSource(candidate),{code:'PL-CORE-STALE'});
 assert.equal(f.admissions.length,0);
});

test('P2-2 invalid memory budgets are rejected instead of disabling the bound',()=>{
 for(const policy of [{maxEntries:4,maxBytes:4096},{maxEntries:2,maxBytes:33554433},
  {maxEntries:0,maxBytes:4096},{maxEntries:2,maxBytes:0},{maxEntries:1.5,maxBytes:4}])
  assert.throws(()=>fixture({sourceCacheLimits:policy}),/cache|limit|budget/i);
});

test('P4-2 visible source and recent foreground visits outrank speculative neighbors',async()=>{
 const f=fixture({sourceCacheLimits:{maxEntries:3,maxBytes:4096}});
 await f.session.prepareProjectSource('1953-12');
 f.session.setPresentedSourceMonth('1953-12');
 await f.session.prepareProjectSource('1952-12');
 const background={background:true,waitForIdle:async()=>{}};
 await f.session.prepareProjectSource('1954-12',background);
 assert.equal(f.session.sourceCacheStats().entries,3);
 assert.equal(f.session.sourceCacheStats().backgroundEntries,1);
 assert.equal(f.session.sourceCacheStats().protectedEntries,1);
 await f.session.prepareProjectSource('1955-12',background);
 assert.equal(f.session.sourceCacheStats().entries,3);
 assert.equal(f.session.sourceCacheStats().backgroundEntries,1);
 const before=f.reads();
 await f.session.prepareProjectSource('1953-12');
 await f.session.prepareProjectSource('1952-12');
 assert.equal(f.reads(),before,'background updates cannot evict the active map or a recent real visit');
 await f.session.prepareProjectSource('1954-12');
 assert.equal(f.reads(),before+1,'the earlier background-only source was evicted');
 assert.equal(f.admissions.length,0);
 assert.ok(f.session.sourceCacheStats().bytes<=4096);
});

test('P4-2 background writes skip full protected cache without evicting active/candidate bytes',async()=>{
 let finishAdmission;
 const admission=new Promise(resolve=>{finishAdmission=resolve;});
 const f=fixture({sourceCacheLimits:{maxEntries:2,maxBytes:4096},admit:()=>admission});
 await f.session.prepareProjectSource('1953-12');
 f.session.setPresentedSourceMonth('1953-12');
 const pending=f.session.prepareProjectBaseline('1954-12');
 // The admitted Core operation starts asynchronously after hashing and source preparation.
 while(f.admissions.length===0)await new Promise(resolve=>setImmediate(resolve));
 const before=f.session.sourceCacheStats();
 assert.equal(before.protectedEntries,2);
 await f.session.prepareProjectSource('1955-12',{background:true,waitForIdle:async()=>{}});
 const after=f.session.sourceCacheStats();
 assert.equal(after.entries,2);assert.equal(after.protectedEntries,2);
 assert.equal(after.backgroundSkipped,1);
 assert.ok(after.bytes<=after.maxBytes);
 finishAdmission();
 await pending;
 const loads=f.reads();
 await f.session.prepareProjectSource('1953-12');
 await f.session.prepareProjectSource('1954-12');
 assert.equal(f.reads(),loads);
 f.session.dispose();
});

test('P4-2 speculative writes do not evict multiple real visits when no free budget exists',async()=>{
 const f=fixture({sourceCacheLimits:{maxEntries:3,maxBytes:4096}});
 for(const month of ['1953-12','1952-12','1951-12'])await f.session.prepareProjectSource(month);
 f.session.setPresentedSourceMonth('1953-12');
 const before=f.reads();
 await f.session.prepareProjectSource('1954-12',{background:true,waitForIdle:async()=>{}});
 assert.equal(f.session.sourceCacheStats().backgroundSkipped,1);
 assert.equal(f.session.sourceCacheStats().entries,3);
 for(const month of ['1953-12','1952-12','1951-12'])await f.session.prepareProjectSource(month);
 assert.equal(f.reads(),before+1);
});

test('P4-2 cache byte cap and revision invalidation leave Core unchanged',async()=>{
 const f=fixture({sourceCacheLimits:{maxEntries:3,maxBytes:4096}});
 const coreBefore=structuredClone(f.core);
 await f.session.prepareProjectSource('1953-12');f.session.setPresentedSourceMonth('1953-12');
 const protectedBefore=f.session.sourceCacheStats();
 assert.equal(protectedBefore.protectedEntries,1);
 f.buildMeta.dataRevision='data-revision-next';
 await f.session.prepareProjectSource('1954-12');
 assert.equal(f.session.sourceCacheStats().protectedEntries,0);
 assert.ok(f.session.sourceCacheStats().bytes<=f.session.sourceCacheStats().maxBytes);
 assert.deepEqual(f.core,coreBefore);
 f.session.setPresentedSourceMonth(null);f.session.clearPreparedSourceCache();
 assert.equal(f.session.sourceCacheStats().entries,0);
 assert.equal(f.session.sourceCacheStats().bytes,0);
 assert.equal(f.admissions.length,0);
});
