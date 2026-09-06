import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers';

import { createHydroService, createTerrainService } from '../../assets/js/modules/physical-layer-service.js';

function response(json, ok = true, status = 200) {
  return { ok, status, async json() { return json; } };
}

test('terrain service preserves manifest retry policy and lifecycle callbacks', async () => {
  const calls = [];
  const service = createTerrainService({
    fetchWithRetry: async (url, _options, policy) => {
      calls.push(['fetch', String(url), policy.maxAttempts, policy.timeoutMs]);
      policy.onRetry({ attempt: 2 });
      return response({ levels: [{ zoom: 0 }] });
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
    ['ready', 1],
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
