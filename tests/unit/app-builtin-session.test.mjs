import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuiltinSession } from "../../shared/frontend/js/modules/builtin-session.js";

test('country source preparation is independent from an unresolved render geometry promise and preserves source errors',async t=>{
 const previous=globalThis.window;globalThis.window={PANDOLAB_CANONICAL_GEOMETRY_PROMISE:new Promise(()=>{})};t.after(()=>{globalThis.window=previous;});
 const error=Object.assign(new Error('source unavailable'),{code:'SOURCE_FETCH'});
 const owner=createBuiltinSession({builtinWorldLoader:{loadProject:async()=>{throw error;}}});
 owner.connect({platformConfigurationA:{BASE_DATASET:'fixture'},domains:{projectDomain:{getGeneration:()=>0}}});
 await assert.rejects(owner.prepareProjectBaseline(),value=>value===error);assert.equal(owner.projectBaseline,null);
});

test('baseline sends uncompressed bytes once and retains only the admitted Core receipt',async t=>{
 const previous=globalThis.window;globalThis.window={};t.after(()=>{globalThis.window=previous;});
 const calls=[],project={schemaVersion:10,test:'memory assembly'};
 const owner=createBuiltinSession({builtinWorldLoader:{loadProject:async()=>({project})}});
 owner.connect({platformConfigurationA:{BASE_DATASET:'fixture'},domains:{projectDomain:{getGeneration:()=>4,state:()=>({storageBaselineId:7}),admitStorageBaseline:async(facts,options)=>{calls.push({facts,options});return {storageBaselineId:7};}}}});
 const baseline=await owner.prepareProjectBaseline();assert.equal(await owner.prepareProjectBaseline(),baseline);assert.equal(calls.length,1);
 const renderStore={materializeCollectionSync(){},materializeFeature(){},geometryEquals(){},ids:()=>[]};owner.installCanonicalCountryStore(renderStore);
 assert.equal(await owner.prepareProjectBaseline(),baseline);assert.equal(calls.length,1);
 assert.equal(Object.hasOwn(baseline,'sourceBytes'),false);assert.equal(baseline.baselineId,7);assert.equal(baseline.encoding,'identity');assert.match(baseline.fingerprint,/^[a-f0-9]{64}$/);
 assert.ok(calls[0].facts.sourceBytes instanceof Uint8Array);
 assert.deepEqual(JSON.parse(new TextDecoder().decode(calls[0].facts.sourceBytes)),project);
 assert.equal(calls[0].facts.compressedBytes,calls[0].facts.decodedBytes);
 assert.deepEqual(calls[0].options,{expectedGeneration:4});assert.equal(calls[0].facts.fingerprint,baseline.fingerprint);
 for(const field of ['project','projectJson','baseEntities'])assert.equal(Object.hasOwn(baseline,field),false);
});


test('same active source reuses its live baseline, but a replaced handle must be readmitted',async()=>{
 let handle=0,selection='same',reads=0,admissions=0,generation=0;
 const project={schemaVersion:10,test:'fixture'};
 const owner=createBuiltinSession({builtinWorldLoader:{loadProject:async(_month,{reuseSelectionKey})=>{
  reads++;return {project:reuseSelectionKey===selection?null:project,selectionKey:selection};
 }}});
 owner.connect({platformConfigurationA:{BASE_DATASET:'fixture'},domains:{projectDomain:{
  getGeneration:()=>generation,state:()=>({storageBaselineId:handle}),
  admitStorageBaseline:async()=>{admissions++;return {storageBaselineId:++handle};},
 }}});
 const first=await owner.prepareProjectBaseline('1950-12');
 const second=await owner.prepareProjectBaseline('1951-12',{reuseSelectedSource:true});
 assert.equal(admissions,1);assert.equal(reads,2);assert.equal(second.baselineId,first.baselineId);
 assert.equal(second.queryKey,'1951-12');assert.equal(second.sourceMonth,'1950-12');
 assert.equal(second.fingerprint,first.fingerprint,'retargeting must not forge the admitted source hash/month');
 selection='new';const changed=await owner.prepareProjectBaseline('1952-12',{reuseSelectedSource:true});assert.equal(admissions,2);
 assert.notEqual(changed.baselineId,first.baselineId);
 handle=99;await owner.prepareProjectBaseline('1953-12',{reuseSelectedSource:true});assert.equal(admissions,3);
 await assert.rejects(owner.prepareProjectBaseline('1953-12',{isCurrent:()=>false}),{name:'AbortError'});
 assert.equal(admissions,3);
});
