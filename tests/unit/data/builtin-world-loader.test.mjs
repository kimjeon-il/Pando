import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {buildBuiltinWorldPublication} from "../../../tools/build/build-builtin-world.mjs";
import {historicalWorldCases} from "../../fixtures/historical-world-cases.mjs";
import {withExplicitView} from "../../helpers/builtin-world.mjs";
import {createBuiltinWorldLoader} from "../../../src/data/builtin-world-loader.js";
import {createBuiltinSession} from "../../../src/document/builtin-session.js";
import {createNodeCoreProject} from "../../helpers/core-project.mjs";
import {startupDocument} from "../../helpers/core-startup.mjs";
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
test('complete project history loads only the selected geometry and reuses verified bytes across dates',async()=>{
 const f=fixture();const [historical]=await Promise.all([f.loader.loadProject('2014-02'),f.loader.loadProject('2014-01')]);
 assert.ok(historical.project.territorialEntities.some(row=>row.id==='state:test-ukraine'));
 assert.ok(historical.project.timelineRecords.geometryBindings.some(row=>row.validTo!==null),'historical intervals must not be flattened');
 const index=JSON.parse(files.get('index.json'));
 const loaded=new Set(historical.project.geometries.map(row=>JSON.stringify([row.id,row.version])));
 const expected=new Set(['index.json',
  ...index.geometryAssets.filter(asset=>loaded.has(JSON.stringify([asset.id,asset.version]))).map(asset=>asset.file)]);
 assert.equal(historical.project.territorialEntities.length,index.entities.length);
 assert.equal(historical.project.geometryResources.length,index.geometryAssets.length);
 assert.ok(loaded.size<index.geometryAssets.length);
 const changing=index.entities.find(entry=>entry.entityId==='state:changing');
 for(const ref of changing.geometryRefs)assert.equal(await f.loader.geometryState(ref),'unloaded');
 assert.deepEqual(new Set(f.calls),expected);assert.equal(f.calls.length,expected.size);assert.ok(f.peak()<=6);
 const count=f.calls.length;await f.loader.loadProject('2014-02');assert.equal(f.calls.length,count);
 await f.loader.loadProject('2027-01');
 assert.deepEqual(new Set(f.calls),expected);assert.equal(f.calls.length,expected.size);
 assert.equal(f.calls.some(file=>file.startsWith('transport/')),false);
 assert.equal(f.calls.some(file=>file.includes('world-project')),false);
 const november=await f.loader.loadProject('2020-11');
 const selected=november.project.geometries.filter(row=>changing.geometryRefs.some(ref=>ref.id===row.id&&ref.version===row.version));
 assert.equal(selected.length,1,'month end must load the effective replacement, not both versions');
 assert.equal(await f.loader.geometryState(selected[0]),'ready');
 assert.equal(f.calls.length,count+1);
});
test('a fresh loader reuses the verified catalog and selected geometry bytes from Cache Storage',async()=>{
 const stores=new Map();
 const cacheStorage={open:async name=>{
  if(!stores.has(name))stores.set(name,new Map());const values=stores.get(name);
  return {match:async key=>values.get(key)?.clone(),put:async(key,response)=>{values.set(key,response.clone());},delete:async key=>values.delete(key)};
 },keys:async()=>[...stores.keys()],delete:async name=>stores.delete(name)};
 const first=fixture({cacheStorage});await first.loader.loadProject('2014-02');
 const second=fixture({cacheStorage});const result=await second.loader.loadProject('2014-02');
 assert.ok(result.project.territorialEntities.length);assert.equal(second.calls.length,0);
});
test('a retired packed offset is rejected before downloading countries',async()=>{
 const assets=new Map(files),index=JSON.parse(assets.get('index.json'));index.entities[0].offset=1;
 assets.set('index.json',Buffer.from(JSON.stringify(index)));
 const f=fixture({assets});await assert.rejects(f.loader.loadProject('2014-02'),/descriptor|offset/);
 assert.ok(f.calls.every(file=>file==='index.json'));
});
test('country integrity failure rejects the whole query and the same loader can retry',async()=>{
 const f=fixture();f.corrupt();await assert.rejects(f.loader.loadProject('2014-02'),/크기|무결성|size|integrity/);
 f.corrupt(false);assert.ok((await f.loader.loadProject('2014-02')).project.territorialEntities.length);
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




test('one Core project retains identity and historical records across month changes and gaps',async t=>{
 const owner=await createNodeCoreProject(startupDocument([]),{appVersion:'fixture'});
 t.after(()=>owner.dispose());
 const session=createBuiltinSession({builtinWorldLoader:fixture().loader});
 session.connect({platformConfigurationA:{BASE_DATASET:startupDocument([]).baseDataset},
  domains:{projectDomain:{getGeneration:()=>0,state:()=>owner.client.state(),
   admitStorageBaseline:async facts=>(await owner.client.storageBaselineLoad(facts)).state}}});
 const prepared=await session.prepareProjectBaseline('2014-02');
 await owner.client.loadBaseline(prepared.baselineId,
  {initialMonth:'2014-02',timelineRange:null,initialMapBounds:null,sourceMode:'builtin'});
 const project=owner.documentModel.snapshot(),documentId=project.documentId;
 const fullRecords=JSON.stringify(project.timelineRecords);
 const visible=()=>owner.documentModel.world().entities.some(row=>row.id==='state:test-ukraine');
 assert.equal(visible(),true,'historical country must exist in its valid interval');
 await owner.client.setTimelineCursor('2026-10');
 assert.equal(visible(),false,'expired country must not borrow modern geometry');
 assert.equal(owner.documentModel.snapshot(),project,'cursor change must not replace document');
 assert.equal(owner.documentModel.snapshot().documentId,documentId);
 assert.equal(JSON.stringify(owner.documentModel.snapshot().timelineRecords),fullRecords);
 await owner.client.setTimelineCursor('2014-02');
 assert.equal(visible(),true,'return must resolve original historical geometry');
 assert.equal(owner.documentModel.snapshot().documentId,documentId);
 assert.equal(owner.client.state().documentDirty,false,'navigation must not edit project content');
});

const defaultProjectManifest=JSON.parse(readFileSync(
  new URL('../../../projects/default-world/manifest.json',import.meta.url),'utf8'));
const territorialCatalog=defaultProjectManifest.resources.territorial.catalog;

test('selected content project verifies the canonical country catalog before any fetch',async()=>{
 const bytes=files.get('index.json'),digest=sha(bytes),spec={url:territorialCatalog,sha256:digest,
  encoding:'identity',compressedBytes:bytes.length,decodedBytes:bytes.length};
 const expected={catalog:territorialCatalog,sha256:digest};
 assert.throws(()=>createBuiltinWorldLoader({
  manifestUrl:'https://test.local/data/index.json',manifestSpec:spec,dataRevision:'fixture',
  projectManifest:defaultProjectManifest,catalogReceipt:{...expected,sha256:'b'.repeat(64)},
 }),/verified builtin resource/);
 assert.throws(()=>createBuiltinWorldLoader({
  manifestUrl:'https://test.local/data/index.json',manifestSpec:{...spec,url:'assets/data/not-selected.json'},
  dataRevision:'fixture',projectManifest:defaultProjectManifest,catalogReceipt:expected,
 }),/verified builtin resource/);
 const calls=[];
 const loader=createBuiltinWorldLoader({
  manifestUrl:'https://test.local/data/index.json',manifestSpec:spec,dataRevision:'fixture',
  projectManifest:defaultProjectManifest,catalogReceipt:expected,cacheStorage:null,
  fetchFn:async url=>{const file=new URL(url).pathname.slice('/data/'.length);calls.push(file);
   const data=files.get(file);return new Response(data,{status:data?200:404});},
 });
 const {project,contentProject}=await loader.loadProject('2014-02');
 assert.equal(contentProject.manifest.projectId,'default-world');
 assert.equal(contentProject.catalogSha256,digest);
 assert.equal(contentProject.dataRevision,'fixture');
 assert.equal(project.format,'pandolab-project-state');
 assert.notEqual(project.documentId,contentProject.manifest.projectId,
  'the project source ID is never substituted for documentId');
 assert.ok(project.timelineRecords.geometryBindings.some(row=>row.validTo!==null));
 assert.ok(calls.includes('index.json'));
});

test('the default map and imported file use identical accepted C++ territorial lookup without leaking project identity',async t=>{
 const seed=startupDocument([]),digest=sha(files.get('index.json'));
 let failLoad=false;
 const presentedSources=[];
 const owner=await createNodeCoreProject(seed,{productMode:'viewer',
  replaceSnapshot:async(_document,{reason,contentProject=null}={})=>{
   presentedSources.push(contentProject);
   if(failLoad&&reason==='load')throw new Error('simulated project presentation failure');
   return true;},
  restoreReplacement:async()=>{},
 });t.after(()=>owner.dispose());
 const session=createBuiltinSession({builtinWorldLoader:fixture().loader,buildMeta:{
  dataRevision:'fixture',builtinWorld:{url:territorialCatalog,sha256:digest},
  mapProject:defaultProjectManifest,mapProjectManifest:{sha256:'c'.repeat(64)},
  mapProjectCatalogs:{territorial:{catalog:territorialCatalog,sha256:digest}},
 }});
 session.connect({platformConfigurationA:{BASE_DATASET:seed.baseDataset},
  domains:{projectDomain:owner.project}});
 const read=month=>async()=>({...await session.prepareProjectBaseline(month),
  setup:{initialMonth:month,timelineRange:null,initialMapBounds:null,sourceMode:'builtin'}});
 assert.equal(await owner.project.open(read('2014-02'),{source:'builtin'}),true);
 const admitted=owner.project.snapshot(),association=owner.project.activeContentProject();
 assert.equal(association.projectId,'default-world');
 assert.equal(association.documentId,admitted.documentId);
 assert.equal(association.catalog,territorialCatalog);
 assert.equal(association.catalogSha256,digest);
 assert.equal(presentedSources[0]?.documentId,admitted.documentId,
  'candidate project identity is available to the replacement adapter');
 assert.equal(owner.project.territorial.list(),owner.documentModel.territorialViews());
 assert.equal(owner.project.territorial.world(),owner.documentModel.world());
 assert.equal(owner.project.territorial.get('state:test-ukraine').id,'state:test-ukraine');
 assert.equal(owner.project.territorial.identities().length,admitted.territorialEntities.length);
 const history=JSON.stringify(admitted.timelineRecords),id=admitted.documentId;
 await owner.client.setTimelineCursor('2026-10');
 assert.equal(owner.project.territorial.get('state:test-ukraine'),null);
 assert.equal(owner.project.snapshot().documentId,id);
 assert.equal(JSON.stringify(owner.project.snapshot().timelineRecords),history);
 await owner.client.setTimelineCursor('2014-02');
 assert.ok(owner.project.territorial.get('state:test-ukraine'));
 // Failed file adoption must restore the former content binding and native world.
 failLoad=true;
 await assert.rejects(owner.project.open(async()=>seed,{source:'project'}),/simulated project presentation failure/);
 assert.equal(owner.project.activeContentProject().documentId,id);
 assert.ok(owner.project.territorial.get('state:test-ukraine'));
 failLoad=false;
 assert.equal(await owner.project.open(async()=>seed,{source:'project'}),true);
 assert.equal(owner.project.activeContentProject(),null);
 assert.equal(presentedSources.at(-1),null,'file project never acquires a builtin resource source');
 assert.deepEqual(owner.project.territorial.list(),owner.documentModel.territorialViews());
 assert.equal(owner.project.territorial.list().length,0);
 assert.equal(owner.project.territorial.get('state:test-ukraine'),null);
});
