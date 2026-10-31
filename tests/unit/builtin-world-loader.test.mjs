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


test('complete active selection proof permits reuse only for the same country records',async()=>{
 const f=fixture(),first=await f.loader.loadProject('2014-01');
 assert.equal(typeof first.selectionKey,'string');assert.ok(first.selectionKey.length>0);
 const same=await f.loader.loadProject('2014-02',{reuseSelectionKey:first.selectionKey});
 assert.equal(same.project,null);assert.equal(same.selectionKey,first.selectionKey);
 const changed=await f.loader.loadProject('2014-03',{reuseSelectionKey:first.selectionKey});
 assert.notEqual(changed.selectionKey,first.selectionKey);assert.ok(changed.project);
 assert.equal(changed.project.territorialEntities.some(row=>row.id==='state:test-ukraine'),false);
 const before=await f.loader.loadProject('2020-10');
 const after=await f.loader.loadProject('2020-11',{reuseSelectionKey:before.selectionKey});
 assert.notEqual(after.selectionKey,before.selectionKey);assert.ok(after.project);
});

test('cancelled selections never return reusable evidence or materialize a stale world',async()=>{
 const f=fixture();await f.loader.loadProject('2014-01');
 await assert.rejects(f.loader.loadProject('2014-02',{isCurrent:()=>false}),{name:'AbortError'});
 await assert.rejects(f.loader.loadProject('1801-01',{isCurrent:()=>false}),{name:'AbortError'});
});


test('real viewer temporal delta matches full admission while retaining identical JS geometry allocations',async t=>{
 const owner=await createNodeCoreProject(startupDocument([]),{productMode:'viewer',replaceSnapshot:async()=>true,restoreReplacement:async()=>{}});
 t.after(()=>owner.dispose());
 const session=createBuiltinSession({builtinWorldLoader:fixture().loader});
 session.connect({platformConfigurationA:{BASE_DATASET:startupDocument([]).baseDataset},domains:{projectDomain:owner.project}});
 const read=month=>async()=>({...await session.prepareProjectBaseline(month,{reuseSelectedSource:true}),
  setup:{initialMonth:month,timelineRange:null,initialMapBounds:null,sourceMode:'builtin'}});
 const received=[];owner.client.subscribeTransitions((packet,operation)=>received.push({packet,operation}));
 await owner.project.open(read('2014-01'),{source:'builtin'});
 const first=owner.documentModel.snapshot(),geometry=first.geometries,identity=first.documentId;
 await owner.project.transitionBuiltin(read('2014-02'));
 const next=owner.documentModel.snapshot();assert.equal(next.documentId,identity);assert.equal(next.geometries,geometry);
 assert.equal(next.projectSetup.initialMonth,'2014-02');assert.equal(owner.client.state().timelineCursor,'2014-02');
 assert.equal(received.filter(row=>row.operation==='core.storage-baseline-load').length,1);
 assert.equal(received.filter(row=>row.operation==='core.document-load-baseline').length,1);
 const packet=received.find(row=>row.operation==='core.document-transition-baseline').packet;
 assert.equal(Object.hasOwn(packet,'project'),false);assert.deepEqual(packet.delta.geometries,[]);
 assert.equal(owner.client.state().dirty,false);assert.equal(owner.client.state().canUndo,false);
 // Country removal and a version change must use fresh, dated source selection.
 for(const month of ['2014-03','2020-10','2020-11','2014-02']){
  await owner.project.transitionBuiltin(read(month));
  const reference=await createNodeCoreProject(startupDocument([]),{productMode:'viewer'});
  try {
   const expected=(await fixture().loader.loadProject(month)).project;
   await reference.client.load(JSON.stringify({...expected,documentId:identity}));
   assert.deepEqual(owner.documentModel.snapshot().territorialEntities,reference.documentModel.snapshot().territorialEntities);
   assert.deepEqual(owner.documentModel.snapshot().geometries,reference.documentModel.snapshot().geometries);
   assert.deepEqual(owner.documentModel.territorialViews(),reference.documentModel.territorialViews());
   assert.equal(owner.client.state().timelineCursor,month);
  }finally{reference.dispose();}
 }
 assert.equal(received.filter(row=>row.operation==='core.document-load-baseline').length,1);
 assert.equal(received.filter(row=>row.operation==='core.document-transition-baseline').length,5);
});


test('unchanged geometry never permits reuse across a historical name edition',async()=>{
 const input=withExplicitView(historicalWorldCases());
 const source=input.entities.find(row=>row.sourceInfo?.featureId==='RUS');
 source.nameVersions=[{validFrom:null,validTo:'1999',names:{ko:{common:'Old'}}},
  {validFrom:'2000',validTo:null,names:{ko:{common:'New'}}}];
 const f=fixture({assets:buildBuiltinWorldPublication({input})});
 const before=await f.loader.loadProject('1999-12');
 const after=await f.loader.loadProject('2000-12',{reuseSelectionKey:before.selectionKey});
 assert.notEqual(after.selectionKey,before.selectionKey);
 assert.equal(before.project.territorialEntities.find(row=>row.id==='RUS').properties.name,'Old');
 assert.equal(after.project.territorialEntities.find(row=>row.id==='RUS').properties.name,'New');
});
