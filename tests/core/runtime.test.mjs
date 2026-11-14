import {createGpuContextRecovery} from '../../src/rendering/gpu-context-recovery.js';
import {createCountryMeshVariants} from '../../src/rendering/gpu-country-mesh-variants.js';
import {createSharedPolygonLodIndex} from '../../src/rendering/render-lod.js';
import {countryLodSourceIds} from '../../src/rendering/gpu-country-ranges.js';
import {createMapVisualFrame} from '../../src/rendering/map-visual-frame.js';
import {gpuStrokeStyle} from '../../src/map/map-interaction-style.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, webcrypto} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {loadNodeCore} from '../../tools/build/load-node-core.mjs';
import {readAtlasTables} from '../../src/data/gpkg-read-core.js';
import {validateImportedProjectPackage} from '../../src/data/project-package-assets.js';
import {createWorkerRpcClient, WORKER_RPC_PROTOCOL, WORKER_RPC_PROTOCOL_VERSION} from '../../src/runtime/worker-rpc.js';
import {mapProjectCatalogSpec} from '../../src/data/map-project-runtime.js';
import {createStoredAssetLoader} from '../../src/data/stored-asset-loader.js';
import {loadVerifiedCore} from '../../src/runtime/core-wasm-loader.js';
import {decodeCountryMesh, encodeCountryMesh} from '../../src/rendering/country-mesh-codec.js';
import {createApplicationLifecycle} from '../../src/app/application-lifecycle.js';
import {createPhysicalAssetReader} from '../../src/data/physical-asset-reader.js';
import {createTerrainService} from '../../src/data/physical-layer-service.js';
import {createAdaptiveRenderQualityController, renderQualityProfile, resolveInitialRenderQuality} from '../../src/rendering/adaptive-render-quality.js';

test('WebGL2 quality budgets simplify every object and change only after sustained active-frame evidence',()=>{
  assert.equal(resolveInitialRenderQuality({}), 'medium');
  assert.equal(resolveInitialRenderQuality({deviceMemory:4}), 'coarse');
  assert.equal(resolveInitialRenderQuality({mobile:true}), 'coarse');
  const low=renderQualityProfile('coarse'), normal=renderQualityProfile('medium'), high=renderQualityProfile('high');
  assert.deepEqual([low.dprCap,normal.dprCap,high.dprCap],[0.75,1.25,2]);
  assert.deepEqual([low.geometryErrorPx,normal.geometryErrorPx,high.geometryErrorPx],[2,1,0.5]);
  assert.deepEqual([low.terrainResolutionScale,normal.terrainResolutionScale,high.terrainResolutionScale],[0.5,0.75,1]);
  assert.equal(low.selectedLod,low.backgroundLod);
  assert.equal(low.gpuCacheBudgetBytes,64*1024**2);
  const frame=createMapVisualFrame({viewState:{projection:'flat',size:{width:800,height:600},scale:100,translate:[400,300],dpr:low.dprCap}});
  assert.equal(frame.dpr,0.75);
  assert.deepEqual(frame.gpuViewport,[600,450]);
  assert.deepEqual(frame.cssTranslate,[400,300]);
  assert.equal(gpuStrokeStyle({width:2},frame).width,1.5,'stroke and picking use the same backing conversion');
  let clock=0;
  const quality=createAdaptiveRenderQualityController({now:()=>clock});
  quality.beginInteraction();
  for(let i=0;i<40;i++){clock+=50;quality.recordFrame(3,{frameIntervalMs:50});}
  assert.equal(quality.profile().tier,'coarse','slow GPU cadence matters even when CPU submission is cheap');
  for(let i=0;i<120;i++){clock+=16;quality.recordFrame(3,{frameIntervalMs:16,suspended:true});}
  assert.equal(quality.stats().sampleCount,40,'hidden or waiting frames do not influence quality');
  quality.endInteraction();
  clock+=16000;
  for(let i=0;i<180;i++){clock+=16;quality.recordFrame(3,{frameIntervalMs:16,memoryPressure:true});}
  assert.equal(quality.profile().tier,'coarse','cache pressure prevents promotion');
  for(let i=0;i<180;i++){clock+=16;quality.recordFrame(3,{frameIntervalMs:16});}
  assert.equal(quality.profile().tier,'coarse','promotion needs fifteen seconds of continuously stable evidence');
  clock+=16000;
  for(let i=0;i<20;i++){clock+=16;quality.recordFrame(3,{frameIntervalMs:16});}
  assert.equal(quality.profile().tier,'medium');
  quality.beginInteraction();
  for(let i=0;i<1000;i++){clock+=16;quality.recordFrame(3,{frameIntervalMs:16});}
  assert.equal(quality.profile().tier,'medium','promotion waits for interaction to end');
  quality.endInteraction();
  assert.equal(quality.profile().tier,'high','settling uses existing stable evidence without idle benchmark frames');
});

// A single fixed package exercises the current read-only path. No writer,
// old test helper, mounted dataset, or full catalog is needed.
const fixture = new URL('../fixtures/timeline-exchange/complex.gpkg', import.meta.url);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
let sqlPromise, corePromise;
function sql() {
  if (!sqlPromise) {
    const dir = new URL('../../assets/js-vendor/sql/', import.meta.url);
    const context = vm.createContext({module:{exports:{}}, require:createRequire(import.meta.url),
      process, Buffer, console, TextEncoder, TextDecoder, __dirname:fileURLToPath(dir)});
    vm.runInContext(readFileSync(new URL('sql-wasm.js',dir),'utf8'),context);
    sqlPromise = context.initSqlJs({wasmBinary:readFileSync(new URL('sql-wasm.wasm',dir))});
  }
  return sqlPromise;
}
const core = () => corePromise ||= loadNodeCore();
async function readPackage(bytes = readFileSync(fixture)) {
  return validateImportedProjectPackage(await readAtlasTables(bytes,sql));
}
async function sessionFor(project) {
  const session = new (await core()).DocumentSession({validateFlagDataUrl(){}});
  try { session.documentLoad(JSON.stringify(project),'1914-07'); return session; }
  catch(error) { session.delete(); throw error; }
}
function workerPort() {
  return {messages:[], postMessage(value){this.messages.push(value);}, terminate(){this.terminated=true;}};
}
function reply(request,result,extra={}) {
  return {rpc:WORKER_RPC_PROTOCOL,protocolVersion:WORKER_RPC_PROTOCOL_VERSION,type:'result',
    requestId:request.requestId,operation:request.operation,projectRevision:request.projectRevision,
    ok:true,result,...extra};
}
async function wasmFixture() {
  const js = new TextEncoder().encode('verified factory bytes');
  const wasm = new Uint8Array([0,97,115,109]);
  const manifest = {schema:'pandoeditor-core-wasm',abiVersion:1,sourceSha256:'a'.repeat(64),
    compiler:{name:'emscripten',version:'6.0.3'},inputs:[],assets:{
      js:{file:'pandoeditor-core.js',sha256:hash(js)},wasm:{file:'pandoeditor-core.wasm',sha256:hash(wasm)}}};
  let factories=0;
  const options = {baseUrl:new URL('https://fixture.invalid/wasm/'),subtle:webcrypto.subtle,
    fetchAsset:async url => String(url).endsWith('manifest.json') ? Response.json(manifest)
      : new Response(String(url).includes('.wasm') ? wasm : js),
    createModuleUrl:()=> 'blob:verified-core',revokeModuleUrl(){},
    importModule:async()=>({default:async()=>{factories++;return {coreAbiVersion:1,
      coreSourceSha256:'b'.repeat(64),coreCompilerVersion:'6.0.3',DocumentSession:class {}};}})};
  return {options,factories:()=>factories};
}

test('Core preserves month/date precision across BCE and CE without a year zero', async()=>{
  const engine=await core();
  assert.deepEqual(engine.temporalParse('-0001-12').endKey,[-1,12,31]);
  assert.equal(engine.temporalParse('-0001-12').precision,'month');
  assert.equal(engine.temporalParse('0001-01-01').precision,'date');
  assert.deepEqual(engine.temporalParse('0001-01-01').startKey,[1,1,1]);
  assert.equal(engine.temporalShiftMonth('-0001-12',1),'0001-01');
  assert.deepEqual(engine.temporalFollowingDay([-1,12,31]),[1,1,1]);
  assert.equal(engine.temporalMonthEnd('2000-02').canonical,'2000-02-29');
  assert.throws(()=>engine.temporalParse('0000-01'),{code:'PL-TEMPORAL-001'});
});

test('Core time selection resolves the active lifetime, geometry, name and parent together', async()=>{
  const project=await readPackage();
  project.timelineRecords.propertyBindings=[
    {id:'name:old',objectRef:{domain:'territorial',id:'B'},validFrom:'1910-01-02',validTo:'1915',
      property:'name',value:{name:'Earlier territory',nameExplicit:true}},
    {id:'name:new',objectRef:{domain:'territorial',id:'B'},validFrom:'1916',validTo:'1920-03',
      property:'name',value:{name:'Later territory',nameExplicit:true}},
  ];
  const session=await sessionFor(project);
  try {
    const world=month=>session.resolveWorld(month,session.projectState().epoch).entities;
    const a=month=>world(month).find(row=>row.objectRef.id==='A');
    const b=month=>world(month).find(row=>row.objectRef.id==='B');
    assert.equal(a('1914-06').geometryRef.version,1);
    assert.equal(a('1914-07').geometryRef.version,2);
    assert.equal(b('1915-12').parentId,'A');
    assert.equal(b('1915-12').properties.name.name,'Earlier territory');
    assert.equal(b('1916-01').parentId,'C');
    assert.equal(b('1916-01').properties.name.name,'Later territory');
    assert.equal(b('1920-03').validTo,'1920-03');
    assert.equal(b('1920-04'),undefined);
  } finally {session.delete();}
});

test('fixed GeoPackage real reader and Core preserve identity, coordinates, time and provenance', async()=>{
  const project=await readPackage(),session=await sessionFor(project);
  try {
    const stored=JSON.parse(session.storageSnapshot());
    assert.equal(stored.documentId,'ac86aaa8-4f4a-5a94-bb06-912bf7851f74');
    assert.deepEqual(stored.territorialEntities.map(row=>row.id),['A','B','C','R']);
    assert.equal(stored.geometries.find(row=>row.id==='shape'&&row.version===2).geojson.coordinates[0][2][0],1.2345678901234567);
    assert.deepEqual(stored.timelineRecords.lifetimes.find(row=>row.id==='B:ancient'),
      {id:'B:ancient',objectRef:{domain:'territorial',id:'B'},validFrom:'-0001',validTo:'0001'});
    assert.deepEqual(stored.territorialEntities[0].properties.metadata.source,
      {provider:'T2-2 exchange corpus',sourceId:'A'});
    assert.equal(stored.territorialEntities[0].properties.sourceEntityId,'timeline-test');
    assert.deepEqual(stored.geometries,project.geometries);
    assert.deepEqual(stored.timelineRecords,project.timelineRecords);
  } finally {session.delete();}
});

test('corrupt GeoPackage rejects while the current Core project remains intact', async()=>{
  const session=await sessionFor(await readPackage());
  try {
    const before=session.storageSnapshot(),state=session.projectState();
    await assert.rejects((async()=>{
      const project=await readPackage(new TextEncoder().encode('corrupt SQLite bytes'));
      session.documentLoad(JSON.stringify(project),'1914-07');
    })(),/database|file|malformed/i);
    assert.equal(session.storageSnapshot(),before);
    assert.deepEqual(session.projectState(),state);
  } finally {session.delete();}
});

test('GeoPackage with unsupported project schema rejects at current package admission', async()=>{
  const SQL=await sql(),db=new SQL.Database(readFileSync(fixture));
  let bytes;
  try {
    const project=JSON.parse(db.exec("SELECT json_value FROM pandolab_project_settings WHERE setting_key='project_state'")[0].values[0][0]);
    project.schemaVersion=999;
    db.run("UPDATE pandolab_project_settings SET json_value=? WHERE setting_key='project_state'",[JSON.stringify(project)]);
    bytes=db.export();
  } finally {db.close();}
  await assert.rejects(readPackage(bytes),{code:'PL-GPKG-VERSION'});
});

test('failed Worker request settles with its operation error and releases pending work', async()=>{
  const worker=workerPort(),client=createWorkerRpcClient({createWorker:()=>worker});
  try {
    const pending=client.request('geometry.mesh',{});
    worker.onmessage({data:reply(worker.messages[0],null,{ok:false,
      error:{message:'mesh preparation failed',code:'MESH_FAILURE',category:'OPERATION',stack:'worker:mesh'}})});
    await assert.rejects(pending,error=>error.code==='MESH_FAILURE' && error.message==='mesh preparation failed'
      && error.category==='OPERATION' && error.cause.stack==='worker:mesh');
    assert.equal(client.stats().pendingCount,0);
  } finally {client.stop();}
});

test('late Worker result cannot overwrite a newer accepted project state', async()=>{
  const worker=workerPort();let revision=1,accepted;
  const client=createWorkerRpcClient({createWorker:()=>worker,getProjectRevision:()=>revision});
  try {
    const old=client.request('geometry.mesh',{}).then(value=>{accepted=value.result;});
    const rejected=assert.rejects(old,{category:'STALE_RESULT'});
    revision=2;
    const current=client.request('geometry.mesh',{}).then(value=>{accepted=value.result;});
    worker.onmessage({data:reply(worker.messages[1],{geometry:'current'})});await current;
    worker.onmessage({data:reply(worker.messages[0],{geometry:'obsolete'})});await rejected;
    assert.deepEqual(accepted,{geometry:'current'});
    assert.equal(client.stats().pendingCount,0);
    assert.equal(client.stats().staleDiscarded,1);
  } finally {client.stop();}
});

test('selected project catalog rejects a receipt for a different pinned catalog path',()=>{
  const mapProject=JSON.parse(readFileSync(new URL('../../projects/default-world/manifest.json',import.meta.url)));
  const catalog=mapProject.resources.terrain.catalog;
  const meta={mapProject,projectCatalogs:{terrain:{catalog,sha256:'a'.repeat(64),bytes:16}}};
  assert.equal(mapProjectCatalogSpec(meta,'terrain').url,catalog);
  meta.projectCatalogs.terrain.catalog='assets/data/terrain/other-pin/manifest.json';
  assert.throws(()=>mapProjectCatalogSpec(meta,'terrain'),/verified project catalog receipt/);
});

test('stored resource hash rejects corrupt bytes before decoded data is admitted', async()=>{
  let decoded=0;
  const loader=createStoredAssetLoader({dataRevision:'fixture-pin',resolveUrl:()=> 'https://fixture.invalid/catalog',
    cacheStorage:null,subtle:webcrypto.subtle,fetchFn:async()=>new Response('bad!')});
  await assert.rejects(loader.loadAsset({encoding:'identity',compressedBytes:4,decodedBytes:4,sha256:hash('good')},
    'background','catalog','catalog',()=>{decoded++;return {}; }),/무결성/);
  assert.equal(decoded,0);
});

test('Core loader rejects stale compiled source identity despite valid paired byte hashes', async()=>{
  const fixture=await wasmFixture();
  await assert.rejects(loadVerifiedCore(fixture.options),{code:'PL-CORE-WASM-ABI'});
  assert.equal(fixture.factories(),1);
});

test('mesh decoder rejects corrupt range metadata from an otherwise valid packed mesh',()=>{
  const mesh={positions:new Int32Array([0,0,1,0,0,1]),countryIndices:new Uint16Array([0,0,0]),
    triangleIndices:new Uint32Array([0,1,2]),lineIndices:new Uint32Array([0,1]),
    countryTriangleRanges:new Uint32Array([0,3]),countryBoundaryRanges:new Uint32Array([0,2]),
    countryBounds:new Int32Array([0,0,1,1]),countryBoundsFlags:new Uint32Array([1])};
  const packed=encodeCountryMesh(mesh,['A'],3);
  assert.deepEqual([...decodeCountryMesh(packed,['A']).mesh.triangleIndices],[0,1,2]);
  new Uint32Array(packed,0,12)[8]=0;
  assert.throws(()=>decodeCountryMesh(packed,['A']),/메타데이터가 손상/);
});

test('required physical resource failure ends startup loading with an error and releases resources', async()=>{
  const network=Promise.withResolvers(),requested=Promise.withResolvers();
  const errors=[],events=[];let disposed=0,ready=0;
  const window=new EventTarget();window.CustomEvent=CustomEvent;
  window.addEventListener('pandolab:ready',()=>events.push('ready'));
  window.addEventListener('pandolab:error',event=>events.push(event.detail));
  const reader=createPhysicalAssetReader({buildMeta:{dataRevision:'selected-pin',physicalLand:{
    url:'assets/data/physical/land.json',encoding:'identity',sha256:hash('{}'),compressedBytes:2}},
    resolveBaseUrl:()=>new URL('https://fixture.invalid/data/'),
    createLoader:options=>createStoredAssetLoader({...options,cacheStorage:null,subtle:webcrypto.subtle,
      fetchFn:()=>{requested.resolve();return network.promise;}})});
  const lifecycle=createApplicationLifecycle({window,startup:()=>reader.loadPhysicalLandMask(),
    onReady:()=>{ready++;},onError:error=>errors.push(error),
    getDisposables:()=>[{dispose(){disposed++;}}]});
  try {
    const completion=lifecycle.start();
    await requested.promise;
    assert.equal(ready,0);assert.equal(disposed,0);assert.equal(reader.physicalLand,null);
    network.resolve(new Response('missing',{status:404}));
    assert.equal(await completion,false,'required resource rejection settles the startup attempt');
    assert.equal(errors.length,1);assert.match(errors[0].message,/404/);
    assert.deepEqual(events,[errors[0].message],'error event replaces the ready event');
    assert.equal(ready,0);assert.equal(disposed,1);assert.equal(reader.physicalLand,null);
    assert.equal(await lifecycle.start(),false,'a failed disposed startup cannot remain pending');
  } finally {lifecycle.dispose();}
});

test('optional terrain delay and failure cannot hold a ready base-map startup', async()=>{
  const terrainNetwork=Promise.withResolvers(),terrainRequested=Promise.withResolvers();
  const geometry={type:'MultiPolygon',coordinates:[[[[0,0],[1,0],[1,1],[0,0]]]]};
  const bytes=new TextEncoder().encode(JSON.stringify(geometry));
  const reader=createPhysicalAssetReader({buildMeta:{dataRevision:'selected-pin',physicalLand:{
    url:'assets/data/physical/land.json',encoding:'identity',sha256:hash(bytes),
    compressedBytes:bytes.byteLength,decodedBytes:bytes.byteLength}},
    resolveBaseUrl:()=>new URL('https://fixture.invalid/data/'),
    createLoader:options=>createStoredAssetLoader({...options,cacheStorage:null,subtle:webcrypto.subtle,
      fetchFn:async()=>new Response(bytes)})});
  let terrainState='idle',terrainCompletion,ready=0,acceptedTerrain=0;
  const terrainErrors=[],startupErrors=[],events=[];
  const terrain=createTerrainService({manifestUrl:()=>new URL('https://fixture.invalid/terrain/manifest.json'),
    fetchWithRetry:()=>{terrainRequested.resolve();return terrainNetwork.promise;},
    getLoadState:()=>terrainState,onLoading:()=>{terrainState='loading';},onRetry(){},
    acceptManifest:()=>{acceptedTerrain++;terrainState='ready';},
    onFailure:error=>{terrainState='error';terrainErrors.push(error);}});
  const window=new EventTarget();window.CustomEvent=CustomEvent;
  window.addEventListener('pandolab:ready',()=>events.push('ready'));
  window.addEventListener('pandolab:error',()=>events.push('error'));
  // Viewer composition launches optional physical resources; project startup
  // awaits the physical land substrate, independently of the terrain promise.
  const lifecycle=createApplicationLifecycle({window,
    compose:[()=>{terrainCompletion=terrain.load();}],startup:()=>reader.loadPhysicalLandMask(),
    onReady:()=>{ready++;},onError:error=>startupErrors.push(error)});
  try {
    const completion=lifecycle.start();await terrainRequested.promise;
    assert.equal(terrainState,'loading');
    assert.equal(await completion,true,'base-map startup settles while the terrain request is still held');
    assert.equal(ready,1);assert.deepEqual(reader.physicalLand.geometry,geometry);
    assert.equal(reader.physicalLand.revision,hash(bytes));
    assert.equal(terrainState,'loading');assert.deepEqual(events,['ready']);
    const offline=new Error('optional terrain offline');terrainNetwork.reject(offline);
    assert.equal(await terrainCompletion,false);assert.equal(terrainState,'error');
    assert.deepEqual(terrainErrors,[offline]);assert.equal(acceptedTerrain,0);
    assert.equal(ready,1);assert.deepEqual(startupErrors,[]);assert.deepEqual(events,['ready']);
    assert.deepEqual(reader.physicalLand.geometry,geometry,'terrain rejection preserves the accepted base substrate');
  } finally {lifecycle.dispose();}
});

test('display derivatives preserve topology and identity and retire superseded GPU buffers only after presentation',()=>{
  const polygon=(id,rings)=>({type:'Feature',id,properties:{},geometry:{type:'Polygon',coordinates:rings}});
  const source=[polygon('A',[[[0,0],[1,0],[1,1],[1,2],[0,2],[0,0]],[[.2,.2],[.2,.6],[.6,.6],[.6,.2],[.2,.2]]]),
    polygon('B',[[[1,0],[2,0],[2,2],[1,2],[1,1],[1,0]]]),
    polygon('dateline',[[[179,10],[-179,10],[-179,12],[179,12],[179,10]]])];
  const original=structuredClone(source),index=createSharedPolygonLodIndex(source);
  const result=index.derive({cssScale:100,errorPx:2});
  assert.deepEqual(source,original,'source data is immutable');
  assert.deepEqual(result.features.map(row=>row.id),['A','B','dateline']);
  assert.equal(result.features[0].geometry.coordinates.length,2,'hole survives');
  assert.deepEqual(result.features[2].geometry,source[2].geometry,'dateline remains protected');
  const shared=ring=>ring.filter(point=>point[0]===1).map(point=>point.join(',')).filter((v,i,a)=>a.indexOf(v)===i).sort();
  assert.deepEqual(shared(result.features[0].geometry.coordinates[0]),shared(result.features[1].geometry.coordinates[0]));
  assert.deepEqual(countryLodSourceIds({countryBounds:new Int32Array([0,0,1000000,2000000,1000000,0,2000000,2000000,10000000,0,11000000,2000000])},['A','B','far'],['A']),['A','B']);
  const released=[],variants=createCountryMeshVariants(entry=>released.push(entry.id));
  const add=id=>variants.replace('lod',()=>({id,quality:'lod'}),{preserveOtherVariants:true});
  add('visible');add('candidate');assert.deepEqual(released,[]);
  add('latest');assert.deepEqual(released,['candidate']);
  variants.commitFrame();assert.deepEqual(released,['candidate','visible']);
  variants.clear();assert.deepEqual(released,['candidate','visible','latest']);
  const old=variants.replace('canonical',()=>({id:'canonical-old',quality:'canonical'}));
  variants.replace('canonical',()=>({id:'canonical-next',quality:'canonical'}));
  assert.equal(released.includes(old.id),false,'canonical GPU resources also survive until presentation');
  variants.commitFrame();assert.equal(released.includes(old.id),true);
  variants.clear();
});

test('WebGL2 recovery stops after its foreground deadline and rejects waiting operations',async()=>{
  let clock=0,scheduled,failed;
  const recovery=createGpuContextRecovery({capture:()=>({source:'current'}),isTargetCurrent:()=>true,
    prepare:async()=>({}),commit:()=>true,discard:()=>{},onCommitted:()=>{},onFailure:error=>{failed=error;},
    now:()=>clock,schedule:callback=>{scheduled=callback;return 1;},clearSchedule:()=>{scheduled=null;}});
  recovery.beginLoss();const waiting=recovery.waitForDevice();
  recovery.setSuspended(true);clock=60000;recovery.setSuspended(false);
  assert.equal(recovery.snapshot().phase,'waiting-context','background suspension is not charged');
  clock+=5001;scheduled();
  await assert.rejects(waiting,/context deadline exceeded/);
  assert.equal(failed.code,'PL-GPU-RECOVERY-CONTEXT-TIMEOUT');
  assert.equal(recovery.snapshot().phase,'failed');
  assert.equal(recovery.snapshot().timerPending,false);
  assert.equal(await recovery.request(),false,'same failed context is not retried');
  recovery.dispose();
});
