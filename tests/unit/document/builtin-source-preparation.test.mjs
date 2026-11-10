import test from 'node:test';
import assert from 'node:assert/strict';
import {createProjectSourceRuntime} from "../../../src/document/project-source-runtime.js";
import {createBuiltinProjectSetup} from "../../../src/document/project-setup.js";

const setup=({loader=null,buildMeta={dataRevision:'fixture',builtinWorld:{sha256:'a'.repeat(64)}}}={})=>{
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
 let sourcePorts;
 const session=createProjectSourceRuntime({builtinWorldLoader:world,buildMeta,getDependencies:()=>sourcePorts});
 sourcePorts=({domains:{projectDomain:domain},platformConfigurationA:{BASE_DATASET:'fixed-source'}});
 return {session,domain,core,document,calls,generation:()=>generation,advance:()=>{generation++;}};
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


test('builtin Core candidate derives its project setup from the source month, never a Viewer-owned copy',async()=>{
 const f=setup();
 let received=null;
 f.domain.prepareTemporalBuiltin=async (facts,projectSetup,options)=>{
  received={facts,projectSetup,options};
  return {kind:'temporal-candidate',setup:projectSetup,targetMonth:facts.sourceMonth};
 };
 const candidate=await f.session.prepareProjectCandidate('1914-07');
 assert.equal(received.facts.sourceMonth,'1914-07');
 assert.deepEqual(received.projectSetup,createBuiltinProjectSetup('1914-07'));
 assert.equal(received.options.transition,false);
 assert.equal(candidate.targetMonth,'1914-07');
 assert.equal(f.calls.length,0,'the candidate must not admit the active Core project');
 await assert.rejects(f.session.prepareProjectCandidate('1914-07',{transition:true}),
   /timeline cursor/i);
 await assert.rejects(f.session.prepareProjectCandidate('1914-07',{
  setup:createBuiltinProjectSetup('1914-06'),
 }),/derived from the requested month/);
});
