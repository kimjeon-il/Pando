import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuiltinSession } from '../../assets/js/modules/app-builtin-session.js';

test('historical source preparation is independent from an unresolved render geometry promise and preserves source errors',async t=>{
 const previous=globalThis.window;globalThis.window={PANDOLAB_CANONICAL_GEOMETRY_PROMISE:new Promise(()=>{})};t.after(()=>{globalThis.window=previous;});
 const error=Object.assign(new Error('source unavailable'),{code:'SOURCE_FETCH'});
 const owner=createBuiltinSession({historicalWorldLoader:{loadSource:async()=>{throw error;}}});
 owner.connect({platformConfigurationA:{BASE_DATASET:'fixture'},domains:{projectDomain:{getGeneration:()=>0}}});
 await assert.rejects(owner.prepareProjectBaseline(),value=>value===error);assert.equal(owner.projectBaseline,null);
});

test('baseline caches verified source facts and the admitted Core handle without a second parsed project',async t=>{
 const previous=globalThis.window;globalThis.window={};t.after(()=>{globalThis.window=previous;});
 const sourceBytes=new Uint8Array([31,139,8]),calls=[];
 const manifest={project:{sha256:'a'.repeat(64),encoding:'gzip',compressedBytes:3,decodedBytes:19},sourceMonth:'2026-10'};
 const owner=createBuiltinSession({historicalWorldLoader:{loadSource:async validate=>{const admission=await validate({sourceBytes,manifest});return {sourceBytes,manifest,admission};}}});
 owner.connect({platformConfigurationA:{BASE_DATASET:'fixture'},domains:{projectDomain:{getGeneration:()=>4,admitStorageBaseline:async(facts,options)=>{calls.push({facts,options});return {storageBaselineId:7};}}}});
 const baseline=await owner.prepareProjectBaseline();assert.equal(await owner.prepareProjectBaseline(),baseline);assert.equal(calls.length,1);
 const renderStore={materializeCollectionSync(){},materializeFeature(){},geometryEquals(){},ids:()=>[]};owner.installCanonicalCountryStore(renderStore);
 assert.equal(await owner.prepareProjectBaseline(),baseline);assert.equal(calls.length,1);
 assert.equal(baseline.sourceBytes,sourceBytes);assert.equal(baseline.baselineId,7);assert.equal(baseline.kind,'stored-asset');assert.equal(baseline.fingerprint,'a'.repeat(64));
 assert.deepEqual(calls[0].options,{expectedGeneration:4});assert.equal(calls[0].facts.fingerprint,baseline.fingerprint);
 for(const field of ['project','projectJson','baseEntities'])assert.equal(Object.hasOwn(baseline,field),false);
});
