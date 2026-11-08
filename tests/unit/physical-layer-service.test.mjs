import { describe as contractSuite } from 'node:test';
import { deferredResult } from '../helpers/async-test-ports.mjs';
import * as __terrain_dep0 from "node:test";
import * as __terrain_dep1 from "../../src/data/physical-resources.js";
import * as __terrain_dep2 from "node:assert/strict";
import * as __terrain_dep3 from "node:timers";
import * as __terrain_dep4 from "node:fs";
import * as __terrain_dep5 from "../../src/rendering/physical-layer-service.js";
import * as __terrain_dep6 from "../../tools/data/physical-water-catalog.mjs";
import * as __terrain_dep7 from "node:crypto";
import * as __terrain_dep8 from "node:zlib";
import * as __terrain_dep9 from "node:module";
import * as __terrain_dep10 from "../../tools/build/build-physical-land-mask.mjs";
import * as __terrain_dep11 from "../../src/rendering/terrain-manifest.js";

// Original feature contract: physical-layer-service.test.mjs
contractSuite("physical-layer-service", () => {
const { describe : contractSuite } = __terrain_dep0;
const __dep0 = __terrain_dep1;
const __dep1 = __terrain_dep2;
const __dep2 = __terrain_dep0;
const __dep3 = __terrain_dep3;
const __dep4 = __terrain_dep4;
const __dep5 = __terrain_dep5;
const __dep6 = __terrain_dep6;
const __dep7 = __terrain_dep7;
const __dep8 = __terrain_dep8;
const __dep9 = __terrain_dep9;
const __dep10 = __terrain_dep10;

// Original feature contract: physical-layer-service.test.mjs
contractSuite("physical-layer-service", () => {
const { createPhysicalResources } = __dep0;
const assert = __dep1.default;
const test = __dep2.default;
const { setImmediate } = __dep3;
const { readFileSync } = __dep4;
const { createHydroService, createTerrainService } = __dep5;


const rasterManifest = JSON.parse(readFileSync(new URL('../../assets/data/terrain-preview/v0.13.3-p2/manifest.json', import.meta.url)));

function response(json, ok = true, status = 200) {
  return { ok, status, async json() { return json; } };
}

test('terrain service preserves manifest retry policy and lifecycle callbacks', async () => {
  const calls = [];
  const service = createTerrainService({
    fetchWithRetry: async (url, _options, policy) => {
      calls.push(['fetch', String(url), policy.maxAttempts, policy.timeoutMs]);
      policy.onRetry({ attempt: 2 });
      return response(rasterManifest);
    },
    manifestUrl: () => new URL('https://example.test/terrain.json'),
    getLoadState: () => 'idle',
    onLoading: () => calls.push(['loading']),
    onRetry: (operation, attempt) => calls.push(['retry', operation, attempt]),
    acceptManifest: manifest => calls.push(['ready', manifest.levels.length]),
    onFailure: error => calls.push(['failed', error.message]),
  });
  assert.equal(await service.load(), true);
  assert.deepEqual(calls, [
    ['loading'],
    ['fetch', 'https://example.test/terrain.json', 3, 15000],
    ['retry', 'terrain-manifest', 2],
    ['ready', 2],
  ]);
});

test('physical services skip duplicate loads and report invalid manifests without throwing', async () => {
  let fetched = 0;
  const skipped = createTerrainService({
    fetchWithRetry: async () => { fetched += 1; return response({ levels: [] }); },
    manifestUrl: () => new URL('https://example.test/terrain.json'),
    getLoadState: () => 'ready',
    onLoading() {}, onRetry() {}, acceptManifest() {}, onFailure() {},
  });
  assert.equal(await skipped.load(), false);
  assert.equal(fetched, 0);

  const failures = [];
  const hydro = createHydroService({
    fetchWithRetry: async () => response({ version: 'wrong', schema: 'wrong' }),
    dataVersion: '0.13.0',
    manifestUrl: () => new URL('https://example.test/hydro.json'),
    getLoadState: () => 'idle',
    onLoading() {}, onRetry() {}, acceptManifest() { throw new Error('must not run'); },
    onFailure: error => failures.push(error.message),
  });
  assert.equal(await hydro.load(), false);
  assert.deepEqual(failures, ['수계 타일 버전이 맞지 않습니다.']);
});

test('hydro service waits for renderer worker acceptance', async () => {
  const manifest = { version: '0.13.0', schema: 'pandolab-water-shards-v5' };
  const accepted = [];
  const service = createHydroService({
    fetchWithRetry: async () => response(manifest),
    dataVersion: '0.13.0',
    manifestUrl: () => new URL('https://example.test/hydro.json'),
    getLoadState: () => 'idle',
    onLoading() {}, onRetry() {},
    acceptManifest: async (value, url) => { accepted.push(value, String(url)); return true; },
    onFailure() {},
  });
  assert.equal(await service.load(), true);
  assert.deepEqual(accepted, [manifest, 'https://example.test/hydro.json']);
});

test('invalid optional DEM manifest falls back to the complete raster source', async () => {
  const urls = [], accepted = [];
  const service = createTerrainService({
    fetchWithRetry: async url => {
      urls.push(String(url));
      return response(String(url).includes('dem') ? { representation: 'unknown' } : rasterManifest);
    },
    manifestUrl: () => new URL('https://example.test/dem/manifest.json'),
    fallbackManifestUrl: () => new URL('https://example.test/raster/manifest.json'),
    getLoadState: () => 'idle', onLoading() {}, onRetry() {},
    acceptManifest: (manifest, url, context) => accepted.push([manifest.representation, String(url), context]),
    onFailure: assert.fail,
  });
  const warn = console.warn;
  console.warn = () => {};
  try { assert.equal(await service.load(), true); }
  finally { console.warn = warn; }
  assert.deepEqual(urls, ['https://example.test/dem/manifest.json', 'https://example.test/raster/manifest.json']);
  assert.deepEqual(accepted, [['raster-rgba-v1', 'https://example.test/raster/manifest.json',
    { usedFallback: true, fallbackReason: '지원하지 않는 지형 표현 형식: unknown' }]]);
});

test('hydro consumers join initial loading through worker readiness without duplicate fetches', async () => {
  let releaseFetch;
  let releaseWorker;
  const fetchGate = new Promise(resolve => { releaseFetch = resolve; });
  const workerGate = new Promise(resolve => { releaseWorker = resolve; });
  let loadState = 'idle';
  let fetches = 0;
  const service = createHydroService({
    fetchWithRetry: async () => {
      fetches += 1;
      await fetchGate;
      return response({ version: '0.13.0', schema: 'pandolab-water-shards-v5' });
    },
    dataVersion: '0.13.0',
    manifestUrl: () => new URL('https://example.test/hydro.json'),
    getLoadState: () => loadState,
    onLoading() { loadState = 'loading'; },
    onRetry() {},
    acceptManifest: async () => { await workerGate; loadState = 'ready'; return true; },
    onFailure: assert.fail,
  });
  const startup = service.load();
  await Promise.resolve();
  assert.equal(loadState, 'loading');
  const partition = service.load();
  assert.equal(partition, startup);
  assert.equal(service.load(true), startup);
  let finished = false;
  partition.then(() => { finished = true; });
  releaseFetch();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(finished, false, 'manifest alone must not release consumers before worker readiness');
  releaseWorker();
  assert.equal(await partition, true);
  assert.equal(await service.load(), true);
  assert.equal(fetches, 1);
});

test('hydro shared failure clears pending state and permits a later explicit retry', async () => {
  let fetches = 0;
  let failures = 0;
  const service = createHydroService({
    fetchWithRetry: async () => {
      fetches += 1;
      if (fetches === 1) throw new Error('offline');
      return response({ version: '0.13.0', schema: 'pandolab-water-shards-v5' });
    },
    dataVersion: '0.13.0',
    manifestUrl: () => new URL('https://example.test/hydro.json'),
    getLoadState: () => 'error',
    onLoading() {}, onRetry() {},
    acceptManifest: async () => true,
    onFailure: () => { failures += 1; },
  });
  assert.deepEqual(await Promise.all([service.load(), service.load()]), [false, false]);
  assert.equal(fetches, 1);
  assert.equal(failures, 1);
  assert.equal(await service.load(true), true);
  assert.equal(fetches, 2);
});

test('hydro admission joins the replacement renderer generation after its old Worker is retired',async()=>{
 let generation=1,calls=0,release;const errors=[],gate=new Promise(resolve=>{release=resolve;});
 const state={physicalLoadState:{}},resources=createPhysicalResources();
 resources.connect({projectState:{state},physicalConfig:{HYDRO_DATA_VERSION:'0.13.4',PHYSICAL_DATA_BASE_URL:new URL('https://example.test/'),DATA_REVISION:'test'},
  physicalServices:{createHydroService,createTerrainService:()=>({load:async()=>true}),fetchWithRetry:async()=>response({version:'0.13.4',schema:'pandolab-water-shards-v5'})},
  layerPresentation:{invalidateObjectPresentation(){}},operationFeedback:{reliabilityDiagnostic:{push(){}}},
  hydroPresentation:{allBuiltInHydroFeatures:()=>[]},domains:{projectDomain:{admitSelectionCatalog:async()=>true},renderingDomain:{invalidateOverlayGeometry(){}}},
  rendering:{gpuMapRenderer:{getProjectGeneration:()=>generation,setHydroManifest:async()=>{if(++calls===1){await gate;return false;}return true;}}},
  feedback:{reportOperationError:error=>errors.push(error)}});
 resources.initializeTerrainService();const pending=resources.loadHydroData();
 while(!calls)await new Promise(resolve=>setImmediate(resolve));generation=2;release();
 assert.equal(await pending,true);assert.equal(calls,2);assert.equal(state.physicalLoadState.hydro,'ready');assert.deepEqual(errors,[]);
});
});

// Original feature contract: physical-water-catalog.test.mjs
contractSuite("physical-water-catalog", () => {
const test = __dep2.default;
const assert = __dep1.default;
const { compilePhysicalWaterCatalog } = __dep6;
const { resolvePhysicalWaterObjects } = __dep0;

const geometry={type:'Polygon',coordinates:[[[0,0],[0,1],[1,1],[0,0]]]};
const source=id=>({schemaVersion:2,entityId:id,entityKind:'lake',lineageId:id.split(':')[1],names:{ko:id},alternateNames:[],
 lifetime:{validFrom:null,validTo:null},parentEntityId:'',instantiation:{mode:'independent',countryUpdates:{}},metadata:{},sourceInfo:{},
 geometryVersions:[{versionId:'reviewed',validFrom:'1922-01-01',validTo:'1929-12-31',certainty:'reviewed',geometry}]});
test('physical source date lookup has one canonical C++ selector and keeps the catalog immutable',()=>{
 const s=source('waterbody:date');
 const a={sha256:'land'},asset={sha256:'water'};
 const catalog=compilePhysicalWaterCatalog([s],[{entityId:s.entityId,versionId:'reviewed',
  geometryRef:{id:'water:date',version:1},asset,land:a,replaces:[]}]);
 const before=structuredClone(catalog);
 assert.deepEqual(resolvePhysicalWaterObjects(catalog,'1921-12'),[]);
 assert.equal(resolvePhysicalWaterObjects(catalog,'1922-01').length,1);
 assert.deepEqual(resolvePhysicalWaterObjects(catalog,'1930-01'),[]);
 assert.deepEqual(catalog,before);
});

test('physical catalog derives its dates only from independent lake library versions',()=>{
 const sources=[source('waterbody:a'),source('waterbody:b')],before=structuredClone(sources),land={sha256:'same'};
 const assignments=sources.map(entity=>({entityId:entity.entityId,versionId:'reviewed',geometryRef:{id:entity.entityId+':reviewed',version:1},asset:{sha256:entity.entityId},land,replaces:[]}));
 const catalog=compilePhysicalWaterCatalog(sources,assignments);
 assert.deepEqual(sources,before);assert.equal(catalog.identities.length,2);assert.equal(catalog.timelineRecords.schemaVersion,3);
 assert.equal(resolvePhysicalWaterObjects(catalog,'1922').length,2);assert.equal(resolvePhysicalWaterObjects(catalog,'1930').length,0);
 assert.deepEqual(catalog.timelineRecords.lifetimes.map(row=>[row.validFrom,row.validTo]),[[null,null],[null,null]]);
 assert.throws(()=>compilePhysicalWaterCatalog(sources,assignments.slice(1)),/Missing.*asset/);
 assert.throws(()=>compilePhysicalWaterCatalog(sources,[...assignments,assignments[0]]),/Duplicate/);
});
});

// Original feature contract: physical-water-context-p4-5.test.mjs
contractSuite("physical-water-context-p4-5", () => {
const test = __dep2.default;
const assert = __dep1.default;
const { createHash } = __dep7;
const { physicalWaterContextKey, createPhysicalResources } = __dep0;

const ref={domain:'hydroBuiltin',id:'lake:historical'};
const row=(land='land-v1',water='water-v1',name='Historical Lake')=>({
  objectRef:ref,geometryRef:{id:'historical-lake-version',version:1},
  identity:{objectRef:ref,entityKind:'lake',name,layerId:'lakes_base'},
  assets:{land:{sha256:land},asset:{sha256:water}},
});

test('P4-5 physical context excludes political time but includes all actual land/water identities',()=>{
  const first=physicalWaterContextKey([row()]);
  assert.equal(physicalWaterContextKey([structuredClone(row())]),first);
  assert.notEqual(physicalWaterContextKey([row('different-land')]),first);
  assert.notEqual(physicalWaterContextKey([row('land-v1','different-water')]),first);
  assert.notEqual(physicalWaterContextKey([row('land-v1','water-v1','New label')]),first);
  assert.equal(physicalWaterContextKey([]),'[]');
  assert.throws(()=>physicalWaterContextKey([{objectRef:ref,geometryRef:{id:'x',version:1}}]),/identities/);
});

test('P4-5 unchanged historical lake versions reuse the exact physical result while other country years change',async t=>{
  const originalFetch=globalThis.fetch;
  t.after(()=>{globalThis.fetch=originalFetch;});
  const bytes=new Map(),requests=[];
  const asset=(name,geometry)=>{
    const body=Buffer.from(JSON.stringify(geometry));
    bytes.set(name,body);
    return {url:'assets/data/'+name,encoding:'identity',
      sha256:createHash('sha256').update(body).digest('hex'),
      compressedBytes:body.length,decodedBytes:body.length};
  };
  const box=x=>({type:'Polygon',coordinates:[[[x,0],[x+1,0],[x+1,1],[x,0]]]});
  const modern=asset('modern',{type:'MultiPolygon',coordinates:[]});
  const historicLand=asset('historic-land',{type:'MultiPolygon',coordinates:[box(0).coordinates]});
  const lake=asset('historic-lake',box(5));
  const catalog={identities:[{objectRef:ref,entityKind:'lake',name:'Historical Lake',layerId:'lakes_base'}],
    geometries:[{geometryRef:{id:'historical-lake-version',version:1},land:historicLand,asset:lake}],
    timelineRecords:{schemaVersion:3,
      lifetimes:[{id:'lifetime',objectRef:ref,validFrom:'1920',validTo:'1930'}],
      parentRelations:[],propertyBindings:[],
      geometryBindings:[{id:'water',objectRef:ref,geometryRef:{id:'historical-lake-version',version:1},
        validFrom:'1920',validTo:'1930'}]}};
  globalThis.fetch=async url=>{
    const name=new URL(url).pathname.split('/').at(-1);
    requests.push(name);return new Response(bytes.get(name));
  };
  const state={timelineCursor:'2026-10',hydroFeatureCache:new Map(),hydroEdits:[]};
  const resources=createPhysicalResources({
    buildMeta:{dataRevision:'p4-5-fixture',physicalLand:modern,physicalWaterObjects:catalog},
    capabilities:{terrain:false,builtinHydro:false}
  });
  resources.connect({
    projectState:{state},physicalConfig:{PHYSICAL_DATA_BASE_URL:'http://fixture/assets/data/'},
    domains:{renderingDomain:{invalidateProject:()=>{}}},
    feedback:{reportOperationError:err=>{throw err;}}
  });
  await resources.loadPhysicalLandMask();
  await resources.preparePhysicalContext('1922-12');
  state.timelineCursor='1922-12';
  const first=resources.physicalLand;
  assert.equal(first.revision,historicLand.sha256);
  assert.equal(first.water.type,'Polygon');
  const fetched=requests.length;
  await resources.preparePhysicalContext('1925-12');
  state.timelineCursor='1925-12';
  assert.strictEqual(resources.physicalLand,first);
  assert.equal(requests.length,fetched,'political-only year changes must not fetch unchanged physical objects');
  await resources.preparePhysicalContext('2000-12');
  state.timelineCursor='2000-12';
  assert.equal(resources.physicalLand.revision,modern.sha256);
  assert.equal(resources.physicalLand.water??null,null);
  assert.equal(requests.length,fetched);
  state.timelineCursor='1922-12';
  assert.strictEqual(resources.physicalLand,first,'revisiting a matching source may reuse the physical mask');
});
});

// Original feature contract: physical-water-admission-race.test.mjs
contractSuite("physical-water-admission-race", () => {
const test = __dep2.default;
const assert = __dep1.default;
const { createHash } = __dep7;
const { createPhysicalResources } = __dep0;

const deferred = deferredResult;

for(const requestModern of [true,false])test(requestModern
  ? 'leaving the historical window during first lake admission cannot overwrite the modern second lake'
  : 'changing only the timeline cursor prevents stale second lake admission before the next frame', {timeout:5000},async t=>{
  const previous=globalThis.fetch;t.after(()=>{globalThis.fetch=previous;});
  const bytes=new Map();
  const asset=(name,geometry)=>{
    const body=Buffer.from(JSON.stringify(geometry));bytes.set(name,body);
    return {url:'assets/data/'+name,encoding:'identity',sha256:createHash('sha256').update(body).digest('hex'),compressedBytes:body.length,decodedBytes:body.length};
  };
  const box=x=>({type:'Polygon',coordinates:[[[x,0],[x+1,0],[x+1,1],[x,0]]]});
  const baseline=asset('baseline',{type:'MultiPolygon',coordinates:[]});
  const historyLand=asset('historical-land',{type:'MultiPolygon',coordinates:[box(0).coordinates]});
  const aral={domain:'hydroBuiltin',id:'waterbody:aral'},caspian={domain:'hydroBuiltin',id:'waterbody:caspian'};
  const aralRef={id:'aral-history',version:1},oldRef={id:'caspian-history',version:1},modernRef={id:'caspian-modern',version:1};
  const catalog={identities:[aral,caspian].map(objectRef=>({objectRef,entityKind:'lake',name:objectRef.id,layerId:'lakes_base'})),
    geometries:[{geometryRef:aralRef,land:historyLand,asset:asset('aral-history',box(5))},
      {geometryRef:oldRef,land:historyLand,asset:asset('caspian-history',box(2))},
      {geometryRef:modernRef,land:baseline,asset:asset('caspian-modern',box(3))}],
    timelineRecords:{schemaVersion:3,lifetimes:[aral,caspian].map(objectRef=>({id:'life:'+objectRef.id,objectRef,validFrom:null,validTo:null})),parentRelations:[],propertyBindings:[],geometryBindings:[
      {id:'aral-old',objectRef:aral,validFrom:'1922-01-01',validTo:'1929-12-31',geometryRef:aralRef},
      {id:'caspian-old',objectRef:caspian,validFrom:'1922-01-01',validTo:'1929-12-31',geometryRef:oldRef},
      {id:'caspian-modern',objectRef:caspian,validFrom:'1930-01-01',validTo:null,geometryRef:modernRef}]}};
  globalThis.fetch=async url=>new Response(bytes.get(new URL(url).pathname.split('/').at(-1)));
  const firstAdmission=deferred(),releaseFirst=deferred(),modernReady=deferred(),lateReady=deferred();
  t.after(()=>releaseFirst.resolve());
  let admissions=0,ready=0;
  const state={timelineCursor:'',hydroEdits:[],hydroFeatureCache:new Map()};
  const resource=createPhysicalResources({buildMeta:{dataRevision:'admission-race',physicalLand:baseline,physicalWaterObjects:catalog},capabilities:{terrain:false,builtinHydro:true,eagerBuiltinHydro:false}});
  resource.connect({projectState:{state},physicalConfig:{PHYSICAL_DATA_BASE_URL:'http://fixture/assets/data/'},
    cutGeometry:{coordinateBounds:()=>[0,0,6,1]},platform:{d3:{geo:{centroid:()=>[0,0]}}},
    hydroPresentation:{allBuiltInHydroFeatures:()=>[...state.hydroFeatureCache.values()],HYDRO_LAYER_META:{lakes_base:{category:'lake'}},hydroCategoryKey:value=>value},
    physicalServices:{isHydroFeatureVisible:feature=>feature.id!==caspian.id},
    domains:{projectDomain:{admitSelectionCatalog:async (_domain,references)=>{
      references();admissions++;
      if(admissions===1){firstAdmission.resolve();await releaseFirst.promise;}
    }},renderingDomain:{invalidateProject:reason=>{
      if(reason==='physical-water-ready'){ready++;(ready===1?modernReady:lateReady).resolve();}
    }}},feedback:{reportOperationError:error=>{throw error;}}});
  await resource.loadPhysicalData({includeHydro:false});
  state.timelineCursor='1922';void resource.physicalLand;
  await firstAdmission.promise;
  assert.equal(state.hydroFeatureCache.has(aral.id),true,'the first historical lake is awaiting canonical admission');
  assert.equal(resource.physicalContextState.ready,true,'immutable physical masks must not wait for Core admission queued after the temporal frame');
  assert.equal(resource.physicalLand.revision,historyLand.sha256,'the prepared physical mask can render while identity admission is pending');
  assert.deepEqual(resource.physicalLand.water,box(5),'a hidden second lake stays hidden before its canonical admission');
  state.timelineCursor='1930';
  if(requestModern){
    void resource.physicalLand;await modernReady.promise;
    assert.deepEqual(state.hydroFeatureCache.get(caspian.id).properties.geometryRef,modernRef);
    releaseFirst.resolve();await lateReady.promise;
    assert.deepEqual(state.hydroFeatureCache.get(caspian.id).properties.geometryRef,modernRef,
      'late historical admission must not overwrite the current modern selection/copy resource');
  }else{
    releaseFirst.resolve();await modernReady.promise;
    assert.equal(state.hydroFeatureCache.has(caspian.id),false,
      'the actual date selection changes before a background getter updates its requested key');
    assert.equal(admissions,1,'the second stale source must never cross the canonical admission boundary');
  }
});
});

// Original feature contract: physical-land-mask.test.mjs
contractSuite("physical-land-mask", () => {
const test = __dep2.default;
const assert = __dep1.default;
const zlib = __dep8.default;
const { gunzipSync } = __dep8;
const { syncBuiltinESMExports } = __dep9;
const { buildPhysicalLandMask } = __dep10;

test('physical mask preserves the pinned terrain source geometry and excludes political metadata', () => {
  const geometry = { type: 'Polygon', coordinates: [[[0,0],[1,0],[1,1],[0,0]]] };
  const source = { type: 'FeatureCollection', features: [{ id: 'country', properties: { validFrom: '2026-10-01', color: 'red' }, geometry }] };
  const before = structuredClone(source);
  const { manifest, bytes } = buildPhysicalLandMask(Buffer.from(JSON.stringify(source)));
  const result = JSON.parse(gunzipSync(bytes));
  assert.deepEqual(result, { type: 'MultiPolygon', coordinates: [geometry.coordinates] });
  assert.equal(manifest.asset.compressedBytes, bytes.length);
  assert.match(manifest.asset.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(source, before);
});

test('physical mask bytes and manifest are identical across gzip host OS headers', () => {
  const source = Buffer.from(JSON.stringify({ features: [{ geometry: { type: 'Polygon', coordinates: [[[0,0],[1,0],[1,1],[0,0]]] } }] }));
  const original = zlib.gzipSync;
  const results = [];
  try {
    for (const os of [3, 10, 255]) {
      zlib.gzipSync = (...args) => { const bytes = original(...args); bytes[9] = os; return bytes; };
      syncBuiltinESMExports();
      results.push(buildPhysicalLandMask(source));
    }
  } finally {
    zlib.gzipSync = original;
    syncBuiltinESMExports();
  }
  for (const result of results) {
    assert.equal(result.bytes[9], 10, 'retain the committed physical-land gzip header on every host');
    assert.deepEqual(result, results[0]);
  }
});
});
});

// Original feature contract: terrain-manifest.test.mjs
contractSuite("terrain-manifest", () => {
const test = __terrain_dep0.default;
const assert = __terrain_dep2.default;
const { readFileSync } = __terrain_dep4;
const { terrainAssetUrl, terrainRasterManifestUrl, validateTerrainManifest } = __terrain_dep11;
const terrainSources = __terrain_dep11;

const raster = {
  version: '0.12.6', crs: 'EPSG:4326', extent: [-180, -90, 180, 90], gutter: 1,
  urlTemplate: 'terrain/v0.12.6/{level}/{column}-{row}.webp',
  representation: 'raster-rgba-v1',
  levels: [{ id: 0, width: 1350, height: 675, columns: 2, rows: 1, tileSize: 1024 }],
};
const dem = {
  version: '0.13.0', representation: 'dem-relief-v1', crs: 'EPSG:4326',
  extent: [-180, -90, 180, 90], registration: 'cell-center', gutter: 1,
  sourceGridOrigin: [-180, 90], sourceResolutionDegrees: [1/120, 1/120],
  tileFormat: 'lossless WebP RGBA', elevation: { decode: 'R*256+G-12000', biasMeters: 12000,
    spacingMeters: 1, validEncodedRange: [0, 65535] },
  shade: { azimuthDegrees: 315, altitudeDegrees: 45, ambient: 0.42, diffuse: 0.58, polarFallbackDegrees: 89.5 },
  channels: { r: 'encoded elevation high byte', g: 'encoded elevation low byte',
    b: 'precomputed hillshade', a: '255' },
  tint: { url: 'terrain/v0.13.3/tint.webp', width: 4096, height: 2048 },
  assetsSha256: 'abc', sources: [], urlTemplate: 'terrain/v0.13.0/{level}/{column}-{row}.webp',
  levels: Array.from({ length: 6 }, (_, id) => ({ id, width: 1350*2**id, height: 675*2**id,
    columns: Math.ceil(1350*2**id/1024), rows: Math.ceil(675*2**id/1024), tileSize: 1024 })),
};

test('legacy raster and strict DEM manifests select known representations', () => {
  assert.equal(validateTerrainManifest(raster).representation, 'raster-rgba-v1');
  assert.equal(validateTerrainManifest(dem).representation, 'dem-relief-v1');
  assert.throws(() => validateTerrainManifest({ ...dem, representation: 'unknown' }), /지원하지 않는/);
  assert.throws(() => validateTerrainManifest({ ...dem, elevation: { decode: 'G*256+R-12000' } }), /DEM/);
  assert.throws(() => validateTerrainManifest({ ...dem, levels: dem.levels.slice(0, 5) }), /DEM/);
  assert.throws(() => validateTerrainManifest({ ...dem, shade: { ...dem.shade, quantizationStep: 8 } }), /DEM/);
});

test('current DEM preview fixes two LODs, eight tiles, provenance and the size limit', () => {
  const preview = JSON.parse(readFileSync(new URL('../../assets/data/terrain-preview/v0.13.3-p2/manifest.json', import.meta.url)));
  assert.equal(validateTerrainManifest(preview).version, '0.13.3-p2');
  assert.throws(() => validateTerrainManifest({ ...preview, levels: preview.levels.slice(0, 1) }), /미리보기/);
  assert.throws(() => validateTerrainManifest({ ...preview, sourceDem: { ...preview.sourceDem, tintSha256: 'changed' } }), /미리보기/);
});

test('a tint-only data release uses the same strict DEM representation contract', () => {
  assert.equal(validateTerrainManifest({ ...dem, version: '0.13.1' }).version, '0.13.1');
  assert.equal(validateTerrainManifest({ ...dem, version: '0.13.2' }).version, '0.13.2');
  assert.throws(() => validateTerrainManifest({ ...dem, version: 'local' }), /DEM/);
  assert.throws(() => validateTerrainManifest({ ...dem, version: '0.13.1',
    channels: { ...dem.channels, g: 'colour' } }), /DEM/);
  assert.equal(terrainSources.TERRAIN_DEM_VERSION, '0.13.3');
  assert.throws(() => validateTerrainManifest({ ...dem, tint: { ...dem.tint, width: 4095 } }), /DEM/);
});

test('relative and absolute data URLs resolve from the manifest without coupling DEM to app revision', () => {
  const appBase = new URL('https://app.example/assets/data/');
  const rasterUrl = terrainRasterManifestUrl(appBase, 'build-1');
  assert.equal(rasterUrl.href, 'https://app.example/assets/data/terrain-preview/v0.13.3-p2/manifest.json?v=build-1');
  assert.equal(terrainAssetUrl('terrain/v0.13.0/5/0-0.webp', {
    manifestUrl: 'https://cdn.example/terrain/v0.13.0/manifest.json', dataBaseUrl: appBase,
  }).href, 'https://cdn.example/terrain/v0.13.0/5/0-0.webp');
  assert.equal(terrainAssetUrl('https://tiles.example/0-0.webp', {
    manifestUrl: rasterUrl, dataBaseUrl: appBase,
  }).href, 'https://tiles.example/0-0.webp');
});

test('terrain source selection keeps raster fallback and diagnostic overrides', () => {
  assert.equal(typeof terrainSources.selectTerrainManifestUrls, 'function');
  const official = new URL('https://example.test/terrain/v0.13.0/manifest.json');
  const rasterUrl = new URL('https://example.test/terrain/v0.12.6/manifest.json');
  const dev = new URL('http://127.0.0.1:4174/terrain/v0.13.0/manifest.json');
  const select = options => terrainSources.selectTerrainManifestUrls({ official, raster: rasterUrl, ...options });
  assert.deepEqual(select({}), { primary: rasterUrl, fallback: null, source: 'raster' });
  assert.deepEqual(select({ preview: true }), { primary: official, fallback: rasterUrl, source: 'preview' });
  assert.deepEqual(select({ defaultDem: true }), { primary: official, fallback: rasterUrl, source: 'official' });
  assert.deepEqual(select({ defaultDem: true, rasterOnly: true }), { primary: rasterUrl, fallback: null, source: 'raster' });
  assert.deepEqual(select({ defaultDem: true, dev }), { primary: dev, fallback: rasterUrl, source: 'development' });
});

test('DEM CDN assets use the manifest hash without applying it to unrelated origins', () => {
  const manifestUrl = 'https://terrain.example/terrain/v0.13.0/manifest.json';
  const dataBaseUrl = new URL('https://app.example/assets/data/');
  assert.equal(terrainAssetUrl('terrain/v0.13.0/5/0-0.webp', {
    manifestUrl, dataBaseUrl, revision: 'asset-hash',
  }).href, 'https://terrain.example/terrain/v0.13.0/5/0-0.webp?v=asset-hash');
  assert.equal(terrainAssetUrl('https://other.example/5/0-0.webp', {
    manifestUrl, dataBaseUrl, revision: 'asset-hash',
  }).href, 'https://other.example/5/0-0.webp');
});
});
