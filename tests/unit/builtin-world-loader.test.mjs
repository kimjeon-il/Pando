import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {buildBuiltinWorldPublication} from '../../tools/build-builtin-world.mjs';
import {historicalWorldCases} from '../fixtures/historical-world-cases.mjs';
import {withExplicitView} from '../helpers/builtin-world.mjs';
import {createBuiltinWorldLoader} from "../../shared/frontend/js/modules/builtin-world-loader.js";
import {createBuiltinSession} from "../../shared/frontend/js/modules/builtin-session.js";
import {createNodeCoreProject} from '../helpers/core-project.mjs';
import {startupDocument} from '../helpers/core-startup.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const files=buildBuiltinWorldPublication({input:withExplicitView(historicalWorldCases())});
function fixture({cacheStorage=null,assets=files}={}){
 const calls=[];let busy=0,peak=0,corrupt=false;
 const bytes=assets.get('index.json');
 const loader=createBuiltinWorldLoader({manifestUrl:'https://test.local/data/index.json',manifestSpec:{sha256:sha(bytes),encoding:'identity',compressedBytes:bytes.length,decodedBytes:bytes.length},dataRevision:'fixture',cacheStorage,
  fetchFn:async url=>{const file=new URL(url).pathname.slice('/data/'.length);calls.push(file);busy++;peak=Math.max(peak,busy);
   await new Promise(resolve=>setTimeout(resolve,2));busy--;const value=assets.get(file);return new Response(corrupt&&file!=='index.json'?'corrupt':value,{status:value?200:404});}});
 return {loader,calls,peak:()=>peak,corrupt:(value=true)=>{corrupt=value;}};
}
test('concurrent month queries share one packed download and later months need no country requests',async()=>{
 const f=fixture();const [historical]=await Promise.all([f.loader.loadProject('2014-02'),f.loader.loadProject('2014-01')]);
 assert.ok(historical.project.territorialEntities.some(row=>row.id==='state:test-ukraine'));
 assert.deepEqual(f.calls,['index.json',JSON.parse(files.get('index.json')).transport.url]);
 const count=f.calls.length;await f.loader.loadProject('2014-02');assert.equal(f.calls.length,count);
 await f.loader.loadProject('2027-01');assert.equal(f.calls.length,count);
 assert.equal(f.calls.some(file=>file.startsWith('countries/')),false);
 assert.equal(f.calls.some(file=>file.includes('world-project')),false);
});
test('a fresh loader reuses the verified catalog and packed bytes from Cache Storage',async()=>{
 const values=new Map();
 const cacheStorage={open:async()=>({match:async key=>values.get(key)?.clone(),put:async(key,response)=>{values.set(key,response.clone());},delete:async key=>values.delete(key)})};
 const first=fixture({cacheStorage});await first.loader.loadProject('2014-02');
 const second=fixture({cacheStorage});const result=await second.loader.loadProject('2014-02');
 assert.ok(result.project.territorialEntities.length);assert.equal(second.calls.length,0);
});
test('an invalid packed byte range is rejected without downloading individual countries',async()=>{
 const assets=new Map(files),index=JSON.parse(assets.get('index.json'));index.entities[0].offset=1;
 assets.set('index.json',Buffer.from(JSON.stringify(index)));
 const f=fixture({assets});await assert.rejects(f.loader.loadProject('2014-02'),/descriptor|range/);
 assert.ok(f.calls.every(file=>file==='index.json'));
});
test('country integrity failure rejects the whole query and the same loader can retry',async()=>{
 const f=fixture();f.corrupt();await assert.rejects(f.loader.loadProject('2014-02'),/크기|무결성|size|integrity/);
 f.corrupt(false);assert.ok((await f.loader.loadProject('2014-02')).project.territorialEntities.length);
});
test('selected country snapshot restores from autosave without reconstructing its original calendar context',async t=>{
 const owner=await createNodeCoreProject(startupDocument([]),{appVersion:'fixture'});t.after(()=>owner.dispose());
 const f=fixture(),session=createBuiltinSession({builtinWorldLoader:f.loader});
 session.connect({platformConfigurationA:{BASE_DATASET:startupDocument([]).baseDataset},domains:{projectDomain:{getGeneration:()=>0,state:()=>owner.client.state(),
  admitStorageBaseline:async facts=>(await owner.client.storageBaselineLoad(facts)).state}}});
 const receipt=await session.prepareProjectBaseline('2014-02');
 await owner.client.loadBaseline(receipt.baselineId,{initialMonth:'2014-02',timelineRange:null,initialMapBounds:null,sourceMode:'builtin'});
 assert.notEqual(owner.documentModel.snapshot().documentId,JSON.parse(files.get('index.json')).template.documentId,
  'activating a builtin baseline allocates a fresh editable instance');
 assert.ok(owner.documentModel.snapshot().territorialEntities.some(row=>row.id==='state:test-ukraine'));
 const saved=(await owner.project.buildAutosave()).project;
 assert.equal(saved.format,'pandolab-autosave-full');assert.equal(saved.baseDatasetFingerprint,undefined);
 const restored=await createNodeCoreProject(startupDocument([]),{replaceSnapshot:async()=>true});t.after(()=>restored.dispose());
 await restored.project.load(saved);
 assert.equal(restored.client.state().timelineCursor,'2014-02');
 assert.deepEqual(restored.documentModel.snapshot().territorialEntities,owner.documentModel.snapshot().territorialEntities);
 assert.equal(restored.client.state().storageBaselineId,0);
});

test('latest builtin reader admits its baseline after a superseded replacement finishes rollback',async t=>{
 let release,started;
 const held=new Promise(resolve=>{release=resolve;}),enter=new Promise(resolve=>{started=resolve;});
 let replacements=0;
 const owner=await createNodeCoreProject(startupDocument([]),{productMode:'viewer',replaceSnapshot:async()=>{
  if(++replacements===1){started();await held;}return true;
 },restoreReplacement:async()=>{}});t.after(()=>owner.dispose());
 const session=createBuiltinSession({builtinWorldLoader:fixture().loader});
 session.connect({platformConfigurationA:{BASE_DATASET:startupDocument([]).baseDataset},domains:{projectDomain:owner.project}});
 const read=month=>async()=>({...await session.prepareProjectBaseline(month),setup:{initialMonth:month,timelineRange:null,initialMapBounds:null,sourceMode:'builtin'}});
 const earlier=owner.project.open(read('2014-02'),{source:'builtin'});await enter;
 const latest=owner.project.open(read('2014-01'),{source:'builtin'});release();
 assert.equal(await earlier,false);assert.equal(await latest,true);
 assert.equal(owner.client.state().timelineCursor,'2014-01');
});
