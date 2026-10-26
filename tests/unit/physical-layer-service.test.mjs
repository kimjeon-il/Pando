import {createPhysicalResources} from "../../shared/frontend/js/modules/physical-resources.js";
import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers';
import { readFileSync } from 'node:fs';

import { createHydroService, createTerrainService } from "../../shared/frontend/js/modules/physical-layer-service.js";

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
 resources.connect({projectState:{state},physicalConfig:{HYDRO_DATA_VERSION:'0.13.2',PHYSICAL_DATA_BASE_URL:new URL('https://example.test/'),DATA_REVISION:'test'},
  physicalServices:{createHydroService,createTerrainService:()=>({load:async()=>true}),fetchWithRetry:async()=>response({version:'0.13.2',schema:'pandolab-water-shards-v5'})},
  layerPresentation:{invalidateObjectPresentation(){}},operationFeedback:{reliabilityDiagnostic:{push(){}}},
  hydroPresentation:{allBuiltInHydroFeatures:()=>[]},domains:{projectDomain:{admitSelectionCatalog:async()=>true},renderingDomain:{invalidateOverlayGeometry(){}}},
  rendering:{gpuMapRenderer:{getProjectGeneration:()=>generation,setHydroManifest:async()=>{if(++calls===1){await gate;return false;}return true;}}},
  feedback:{reportOperationError:error=>errors.push(error)}});
 resources.initializeTerrainService();const pending=resources.loadHydroData();
 while(!calls)await new Promise(resolve=>setImmediate(resolve));generation=2;release();
 assert.equal(await pending,true);assert.equal(calls,2);assert.equal(state.physicalLoadState.hydro,'ready');assert.deepEqual(errors,[]);
});
