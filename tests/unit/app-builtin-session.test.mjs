import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuiltinSession } from '../../assets/js/modules/builtin-session.js';

test('country source preparation is independent from an unresolved render geometry promise and preserves source errors',async t=>{
 const previous=globalThis.window;globalThis.window={PANDOLAB_CANONICAL_GEOMETRY_PROMISE:new Promise(()=>{})};t.after(()=>{globalThis.window=previous;});
 const error=Object.assign(new Error('source unavailable'),{code:'SOURCE_FETCH'});
 const owner=createBuiltinSession({builtinWorldLoader:{loadProject:async()=>{throw error;}}});
 owner.connect({platformConfigurationA:{BASE_DATASET:'fixture'},domains:{projectDomain:{getGeneration:()=>0}}});
 await assert.rejects(owner.prepareProjectBaseline(),value=>value===error);assert.equal(owner.projectBaseline,null);
});

test('baseline caches the admitted Core handle and only retains assembled compressed source',async t=>{
 const previous=globalThis.window;globalThis.window={};t.after(()=>{globalThis.window=previous;});
 const calls=[],project={schemaVersion:10,test:'memory assembly'};
 const owner=createBuiltinSession({builtinWorldLoader:{loadProject:async()=>({project})}});
 owner.connect({platformConfigurationA:{BASE_DATASET:'fixture'},domains:{projectDomain:{getGeneration:()=>4,state:()=>({storageBaselineId:7}),admitStorageBaseline:async(facts,options)=>{calls.push({facts,options});return {storageBaselineId:7};}}}});
 const baseline=await owner.prepareProjectBaseline();assert.equal(await owner.prepareProjectBaseline(),baseline);assert.equal(calls.length,1);
 const renderStore={materializeCollectionSync(){},materializeFeature(){},geometryEquals(){},ids:()=>[]};owner.installCanonicalCountryStore(renderStore);
 assert.equal(await owner.prepareProjectBaseline(),baseline);assert.equal(calls.length,1);
 assert.ok(baseline.sourceBytes instanceof Uint8Array);assert.equal(baseline.baselineId,7);assert.equal(baseline.encoding,'gzip');assert.match(baseline.fingerprint,/^[a-f0-9]{64}$/);
 assert.deepEqual(calls[0].options,{expectedGeneration:4});assert.equal(calls[0].facts.fingerprint,baseline.fingerprint);
 for(const field of ['project','projectJson','baseEntities'])assert.equal(Object.hasOwn(baseline,field),false);
});
