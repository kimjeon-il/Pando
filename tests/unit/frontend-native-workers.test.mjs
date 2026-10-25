import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {frontendFixture} from '../helpers/frontend-build-fixture.mjs';import {buildFrontendSnapshot} from '../../scripts/lib/frontend-build.mjs';
test('native Worker guards participate in closure identity and emitted byte hashes',async t=>{const f=frontendFixture(t);f.put('shared/frontend/js/workers/sample-worker.js',"'use strict'; self.onmessage=()=>{};");const web=await buildFrontendSnapshot(f.options),native=await buildFrontendSnapshot({...f.options,workerSourceTransform:(_path,text)=>'/* native boundary */\n'+text});const entry='assets/js/workers/sample-worker.js',a=web.buildMeta.workerAssets[entry],b=native.buildMeta.workerAssets[entry];assert.notEqual(a.url,b.url);for(const path of b.files)assert.equal(createHash('sha256').update(native.assets.get(path).bytes).digest('hex'),b.sha256[path]);assert.ok(native.assets.get(b.url).bytes.toString().includes('native boundary'));});
test('native profile is part of the single generated metadata identity',async t=>{
 const f=frontendFixture(t),web=await buildFrontendSnapshot(f.options),native=await buildFrontendSnapshot({...f.options,resourceProfile:'map-data'});
 assert.equal(native.buildMeta.resourceProfile,'map-data');
 const source=native.assets.get('assets/js/build-meta.js').bytes.toString();
 assert.equal((source.match(/PANDOLAB_BUILD_META = /g)||[]).length,1);
 assert.equal(JSON.parse(source.match(/Object\.freeze\(([\s\S]*)\);\s*$/)[1]).resourceProfile,'map-data');
 assert.notEqual(native.sourceSha256,web.sourceSha256);
});
test('identical Worker inputs produce stable metadata and one reusable frontend identity',async t=>{
 const f=frontendFixture(t);
 for(let i=0;i<8;i++)f.put('shared/frontend/js/modules/fixture-'+i+'.js','export const value'+i+'='+i+';\n');
 f.put('shared/frontend/js/workers/sample-worker.js',Array.from({length:8},(_,i)=>'import {value'+i+'} from "../modules/fixture-'+i+'.js";').join('\n')+'\nself.onmessage=()=>{};\n');
 const builds=await Promise.all(Array.from({length:5},()=>buildFrontendSnapshot(f.options)));
 for(const snapshot of builds){
  const worker=snapshot.buildMeta.workerAssets['assets/js/workers/sample-worker.js'];
  assert.deepEqual(Object.keys(worker.sha256),worker.files);
 }
 assert.equal(new Set(builds.map(snapshot=>snapshot.sourceSha256)).size,1);
});
