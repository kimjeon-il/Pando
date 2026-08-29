import assert from 'node:assert/strict';
import test from 'node:test';

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
