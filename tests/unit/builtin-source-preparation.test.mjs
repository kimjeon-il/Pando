import test from 'node:test';
import assert from 'node:assert/strict';
import {createBuiltinSession} from '../../shared/frontend/js/modules/builtin-session.js';

const setup=({loader=null,buildMeta=null,sourceCacheMaxBytes=undefined,sourceCacheMaxEntries=undefined}={})=>{
 const document={documentId:'active',projectSetup:{initialMonth:'2026-10'},territorialEntities:[{id:'active'}]};
 const core={timelineCursor:'2026-10',storageBaselineId:7,checkpoint:11,presentationCheckpoint:4,
  canUndo:true,canRedo:false,dirty:true,documentDirty:true,presentationDirty:false};
 const calls=[];let generation=3;
 const domain={
  getGeneration:()=>generation,
  state:()=>structuredClone(core),
  admitStorageBaseline:async (facts,{expectedGeneration}={})=>{
   calls.push({facts,expectedGeneration});
   core.storageBaselineId=19;
   return {storageBaselineId:19};
  },
 };
 const world=loader||{loadProject:async month=>({project:{
  projectSetup:{initialMonth:month},territorialEntities:[{id:'dated',properties:{name:month}}],
  geometries:[],timelineRecords:{schemaVersion:3,lifetimes:[],geometryBindings:[],parentRelations:[],propertyBindings:[]}
 }})};
 const session=createBuiltinSession({builtinWorldLoader:world,buildMeta,sourceCacheMaxBytes,sourceCacheMaxEntries});
 session.connect({domains:{projectDomain:domain},platformConfigurationA:{BASE_DATASET:'fixed-source'}});
 return {session,core,document,calls,generation:()=>generation,advance:()=>{generation++;}};
};

test('P2-1 preparing a dated world never admits Core, changes the timeline, document or history',async()=>{
 const f=setup(),before=structuredClone(f.core),doc=structuredClone(f.document);
 const candidate=await f.session.prepareProjectSource('2025-12');
 assert.equal(candidate.kind,'stored-asset');
 assert.equal(candidate.sourceMonth,'2025-12');
 assert.equal(candidate.expectedGeneration,3);
 assert.match(candidate.fingerprint,/^[a-f0-9]{64}$/);
 assert.equal(candidate.sourceBytes.length,candidate.decodedBytes);
 assert.ok(Object.isFrozen(candidate));
 assert.deepEqual(JSON.parse(new TextDecoder().decode(candidate.sourceBytes)).projectSetup,{initialMonth:'2025-12'});
 const mutable=candidate.sourceBytes;mutable.fill(0);
 assert.equal(JSON.parse(new TextDecoder().decode(candidate.sourceBytes)).projectSetup.initialMonth,'2025-12');
 assert.deepEqual(f.core,before);
 assert.deepEqual(f.document,doc);
 assert.equal(f.session.projectBaseline,null);
 assert.equal(f.calls.length,0);
});

test('P2-1 admission is a separate explicit operation using the pinned prepared bytes',async()=>{
 const f=setup(),candidate=await f.session.prepareProjectSource('2025-12');
 assert.equal(f.calls.length,0);
 const receipt=await f.session.admitPreparedProjectSource(candidate);
 assert.equal(f.calls.length,1);
 assert.equal(f.calls[0].expectedGeneration,3);
 assert.equal(f.calls[0].facts.kind,'stored-asset');
 assert.ok(f.calls[0].facts.sourceBytes instanceof Uint8Array);
 assert.equal(f.calls[0].facts.sourceBytes.length,candidate.decodedBytes);
 assert.equal(f.calls[0].facts.fingerprint,candidate.fingerprint);
 assert.equal(receipt.baselineId,19);
 assert.equal(receipt.queryKey,'2025-12');
 assert.equal(receipt.sourceBytes,undefined);
 assert.equal(f.session.projectBaseline,receipt);
});

test('P2-1 superseded read-only sources never enqueue Core admission',async()=>{
 let complete;const blocked=new Promise(resolve=>{complete=resolve;});
 const f=setup({loader:{loadProject:async month=>{await blocked;return {project:{projectSetup:{initialMonth:month}}};}}});
 let current=true;
 const pending=f.session.prepareProjectSource('2025-12',{isCurrent:()=>current});
 current=false;complete();
 await assert.rejects(pending,error=>error.name==='AbortError'&&error.cancelled===true);
 assert.equal(f.calls.length,0);
});

test('P2-1 generation change or foreign prepared object cannot be admitted',async()=>{
 const f=setup(),candidate=await f.session.prepareProjectSource('2025-12');
 f.advance();
 await assert.rejects(f.session.admitPreparedProjectSource(candidate),error=>error.code==='PL-CORE-STALE');
 await assert.rejects(f.session.admitPreparedProjectSource({...candidate}),/prepared|candidate|source/i);
 assert.equal(f.calls.length,0);
});

test('P2-1 the original month switch still admits the baseline in its existing path',async()=>{
 const f=setup();
 const receipt=await f.session.prepareProjectBaseline('2025-12');
 assert.equal(receipt.baselineId,19);
 assert.equal(f.calls.length,1);
 assert.equal(f.calls[0].expectedGeneration,3);
 const repeated=await f.session.prepareProjectBaseline('2025-12');
 assert.equal(repeated,receipt);
 assert.equal(f.calls.length,1);
});


test('P2-2 identical prepared source reuses only private dated bytes, not mutable candidates or Core handles',async()=>{
 let loads=0;
 const f=setup({buildMeta:{dataRevision:'rev-one',builtinWorld:{sha256:'a'.repeat(64)}},
  loader:{loadProject:async month=>{loads++;return {project:{projectSetup:{initialMonth:month},names:['X']}};}}});
 const coreBefore=structuredClone(f.core);
 const first=await f.session.prepareProjectSource('2025-12');
 const second=await f.session.prepareProjectSource('2025-12');
 assert.equal(loads,1,'same revision and month must skip world reassembly and hashing');
 assert.notStrictEqual(first,second,'a cached byte buffer must never retain an old candidate generation');
 assert.equal(first.fingerprint,second.fingerprint);
 assert.deepEqual(first.sourceBytes,second.sourceBytes);
 first.sourceBytes.fill(0);
 assert.notEqual(second.sourceBytes[0],0,'returned source bytes must be separate copies');
 assert.deepEqual(f.core,coreBefore);
 assert.equal(f.calls.length,0);
 const stats=f.session.preparedSourceCacheStats();
 assert.equal(stats.entries,1);assert.equal(stats.hits,1);assert.equal(stats.misses,1);
 assert.ok(stats.bytes>0&&stats.bytes<=stats.maxBytes);
 assert.equal(Object.hasOwn(stats,'baselineId'),false);
});

test('P2-2 same cached source creates a fresh generation-scoped candidate and a new Core admission',async()=>{
 let loads=0;
 const f=setup({loader:{loadProject:async month=>{loads++;return {project:{projectSetup:{initialMonth:month}}};}}});
 const old=await f.session.prepareProjectSource('2025-12');
 f.advance();
 await assert.rejects(f.session.admitPreparedProjectSource(old),{code:'PL-CORE-STALE'});
 const fresh=await f.session.prepareProjectSource('2025-12');
 assert.equal(loads,1);assert.equal(fresh.expectedGeneration,f.generation());
 const admitted=await f.session.admitPreparedProjectSource(fresh);
 assert.equal(admitted.baselineId,19);
 assert.equal(f.calls.length,1);
 assert.equal(f.calls[0].expectedGeneration,f.generation());
 assert.equal(f.calls[0].facts.sourceMonth,'2025-12');
});

test('P2-2 LRU evicts the least recently reused month within entry limit',async()=>{
 const months=[];
 const f=setup({sourceCacheMaxEntries:2,sourceCacheMaxBytes:20000,
  loader:{loadProject:async month=>{months.push(month);return {project:{projectSetup:{initialMonth:month}}};}}});
 for(const month of ['2025-12','2024-12','2025-12','2023-12','2024-12'])
   await f.session.prepareProjectSource(month);
 assert.deepEqual(months,['2025-12','2024-12','2023-12','2024-12']);
 const stats=f.session.preparedSourceCacheStats();
 assert.equal(stats.entries,2);assert.equal(stats.evictions,2);
 assert.ok(stats.bytes<=stats.maxBytes);
});

test('P2-2 oversized worlds bypass cache without any unbounded retained bytes',async()=>{
 let loads=0;
 const f=setup({sourceCacheMaxBytes:1,sourceCacheMaxEntries:3,
  loader:{loadProject:async month=>{loads++;return {project:{projectSetup:{initialMonth:month}}};}}});
 await f.session.prepareProjectSource('2025-12');
 await f.session.prepareProjectSource('2025-12');
 assert.equal(loads,2);
 const stats=f.session.preparedSourceCacheStats();
 assert.equal(stats.entries,0);assert.equal(stats.bytes,0);assert.equal(stats.oversized,2);
});

test('P2-2 stale and failed source preparations never populate reusable entries',async()=>{
 let loads=0,release;
 const held=new Promise(resolve=>{release=resolve;});
 const f=setup({loader:{loadProject:async month=>{loads++;if(loads===1)await held;
  if(loads===2)throw Error('unavailable');return {project:{projectSetup:{initialMonth:month}}};}}});
 let current=true;
 const early=f.session.prepareProjectSource('2025-12',{isCurrent:()=>current});
 current=false;release();
 await assert.rejects(early,{name:'AbortError',cancelled:true});
 await assert.rejects(f.session.prepareProjectSource('2025-12'),/unavailable/);
 assert.equal(f.session.preparedSourceCacheStats().entries,0);
 await f.session.prepareProjectSource('2025-12');
 await f.session.prepareProjectSource('2025-12');
 assert.equal(loads,3,'recovery can be reused after an actually successful completion');
});

test('P2-2 changed dataset identity cannot silently reuse a prior month or old loader',async()=>{
 let loads=0;
 const meta={dataRevision:'rev-one',builtinWorld:{sha256:'a'.repeat(64)}};
 const f=setup({buildMeta:meta,loader:{loadProject:async month=>{loads++;return {project:{projectSetup:{initialMonth:month}}};}}});
 await f.session.prepareProjectSource('2025-12');
 meta.dataRevision='rev-two';
 await assert.rejects(f.session.prepareProjectSource('2025-12'),/revision|dataset|identity|restart/i);
 assert.equal(loads,1);
});

test('P2-2 explicit cache release drops all retained bytes and forces regeneration',async()=>{
 let loads=0;
 const f=setup({loader:{loadProject:async month=>{loads++;return {project:{projectSetup:{initialMonth:month}}};}}});
 const first=await f.session.prepareProjectSource('2025-12');
 assert.equal(f.session.preparedSourceCacheStats().entries,1);
 f.session.clearPreparedSourceCache();
 assert.equal(f.session.preparedSourceCacheStats().entries,0);
 assert.equal(f.session.preparedSourceCacheStats().bytes,0);
 assert.equal(first.sourceMonth,'2025-12','detached candidate is not invalidated by byte-cache eviction');
 await f.session.prepareProjectSource('2025-12');
 assert.equal(loads,2);
});

test('P2-2 source cache can be disabled by zero entry limit',async()=>{
 let loads=0;
 const f=setup({sourceCacheMaxEntries:0,loader:{loadProject:async month=>{loads++;return {project:{projectSetup:{initialMonth:month}}};}}});
 await f.session.prepareProjectSource('2025-12');
 await f.session.prepareProjectSource('2025-12');
 assert.equal(loads,2);assert.equal(f.session.preparedSourceCacheStats().bytes,0);
});
