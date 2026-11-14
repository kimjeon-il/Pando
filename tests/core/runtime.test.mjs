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
import {createGpuCanvasWorker} from '../../src/rendering/gpu-canvas-worker.js';
import {classifyCanvasWorkerFrame} from '../../src/rendering/map-render-publication.js';

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

test('numeric DEM regression compares the same colored or monochrome channel at fractional heights',()=>{
  // The retired WebGL regression compared a monochrome pass (physicalStyle=0)
  // to Canvas's default colored-land channel and reported a false shader error.
  const scope={self:{}};
  vm.runInNewContext(readFileSync(new URL('../../src/rendering/workers/canvas-terrain-dem-core.js',import.meta.url),'utf8'),scope);
  const terrain=scope.self.PandoLabCanvasTerrainDem,width=6,height=6;
  const dem=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=(y*width+x)*4,h=32*x+13*y+7*x*y+12000;
    dem.set([h>>8,h&255,128,255],i);
  }
  const prepared=terrain.convertTile({dem,width,height});
  const colored=terrain.sampleInterpolated({dem,width,height,x:1.1,y:2.25,channel:'land'});
  const mono=terrain.sampleInterpolated({dem,width,height,x:1.1,y:2.25,channel:'political'});
  assert.notDeepEqual(colored.slice(0,3),mono.slice(0,3),
    'a political grayscale pass cannot be compared to colored land');
  assert.equal(mono[0],mono[1]);assert.equal(mono[1],mono[2]);
  for(const channel of ['land','ocean','political']){
    const actual=terrain.sampleInterpolated({dem,width,height,x:3,y:3,channel});
    const expected=prepared[channel].slice((3*width+3)*4,(3*width+3)*4+4);
    for(let c=0;c<4;c++)assert.ok(Math.abs(actual[c]-expected[c])<=1,
      channel+' integer texel '+c+' must match the prepared-color contract');
  }
  // Sparse observed natural tiles must fade into the canonical palette where
  // the next natural tile is unavailable, matching the GPU's 64px rule.
  const pigment=new Uint8ClampedArray(dem.length);
  for(let i=0;i<pigment.length;i+=4)pigment.set([225,130,80,255],i);
  const surface={data:pigment,width,height,mixWeight:0.65};
  const input={dem,width,height,x:0,y:2.25,channel:'land',naturalSurface:surface};
  const unfeathered=terrain.sampleInterpolated(input);
  const feathered=terrain.sampleInterpolated({...input,naturalFadeEdges:[1,0,0,0]});
  const palette=terrain.sampleInterpolated({dem,width,height,x:0,y:2.25,channel:'land'});
  assert.notDeepEqual(unfeathered,palette,'observed pigment modifies available land');
  assert.deepEqual(feathered,palette,'missing western natural tile fades to the DEM palette');
});


test('Canvas Worker rejects superseded camera, date, theme and generation frames without publishing pixels',()=>{
  const sent=[],presented=[],stale=[];let closed=0;
  const worker={postMessage(message){sent.push(message);},terminate(){}};
  let currentKey='camera-a',currentStyle=1;
  const acceptFrame=message=>classifyCanvasWorkerFrame(message,{
    expectedPresentationKey:currentKey,geometryRevision:7,styleRevision:currentStyle,
    surfaceQuality:'canonical',physicalMatches:true,
  })==='';
  const transport=createGpuCanvasWorker({worker,generation:1,acceptFrame,
    onStale:message=>stale.push(message.presentationKey)});
  transport.onmessage=event=>{if(event.data.type==='frame')presented.push(event.data.presentationKey);};
  const frame=(revision,presentationKey,styleRevision=currentStyle,projectGeneration=1)=>({
    type:'view',revision,projectGeneration,presentationKey,
    geometryRevision:7,styleRevision,surfaceQuality:'canonical'
  });
  const acknowledge=(request,message)=>{
    const bitmap={close(){closed++;}};
    worker.onmessage({data:{...message,type:'frame',renderRequestId:request.renderRequestId,bitmap}});
  };
  worker.onmessage({data:{type:'ready'}});
  transport.queueFrame(frame(1,'camera-a'));
  const first=sent.at(-1);assert.equal(first.revision,1);
  currentKey='camera-b';
  transport.queueFrame(frame(2,'camera-b'));
  transport.queueFrame(frame(1,'obsolete-camera'));
  assert.equal(sent.filter(x=>x.type==='view').length,1,'stale camera cannot be queued');
  acknowledge(first,frame(1,'camera-a'));
  assert.equal(closed,1);assert.deepEqual(presented,[]);
  const second=sent.at(-1);assert.equal(second.presentationKey,'camera-b');
  acknowledge(second,frame(2,'camera-b'));
  assert.deepEqual(presented,['camera-b']);

  // Date and palette may change without advancing the camera revision.
  currentKey='new-date';currentStyle=2;
  transport.queueFrame(frame(2,'new-date'));
  const third=sent.at(-1);
  acknowledge(third,frame(2,'camera-b',1));
  assert.equal(closed,2);assert.deepEqual(presented,['camera-b']);
  transport.queueFrame(frame(2,'new-date'));
  const fourth=sent.at(-1);acknowledge(fourth,frame(2,'new-date'));
  assert.deepEqual(presented,['camera-b','new-date']);

  // A late bitmap from a previous project is never a valid new-generation frame.
  transport.resetGeneration(2);currentKey='new-project';currentStyle=3;
  transport.queueFrame(frame(1,'new-project',3,2));
  const fifth=sent.at(-1);
  acknowledge(fifth,frame(3,'new-date',2,1));
  assert.equal(closed,3);assert.deepEqual(presented,['camera-b','new-date']);
  acknowledge(fifth,frame(1,'new-project',3,2));
  assert.deepEqual(presented,['camera-b','new-date','new-project']);
  assert.ok(stale.includes('camera-a')&&stale.includes('camera-b'));
  transport.terminate();
});
