import test from 'node:test';
import assert from 'node:assert/strict';
import { createGpuHydroPreparation } from '../../assets/js/modules/gpu-hydro-preparation.js';

function fixture(t) {
  globalThis.Worker = class {};
  t.after(() => { delete globalThis.Worker; });
  const workers = [], messages = [], phases = [], registrations = [];
  const owner = createGpuHydroPreparation({
    createWorker: () => { const worker = { postMessage: message => messages.push(message), terminate() {} }; workers.push(worker); return worker; },
    getMode: () => 'webgl2', getView: () => ({ projection: 'flat', threshold: 1, width: 100, height: 100, scale: 100, flatCenter: [0, 0] }),
    getCacheBudget: () => 8 * 1024 * 1024, getProtectedPackIds: () => [], isMobile: () => false, DATA_REVISION: 'data', ASSET_REVISION: 'asset',
    registerHydroFragments: rows => registrations.push(rows), registerHydroDescriptors: rows => registrations.push(rows), unregisterHydroFragments() {},
    queueHydroRender() {}, reportOperationError() {}, setActionStatus() {}, onReset() {}, onConnect() {}, onLoadState: phase => phases.push(phase),
  });
  t.after(() => owner.dispose());
  const manifest = { stages: [{ id: 0, minZoom: 0, columns: 1, rows: 1 }], index: { sha256: '123456789012345' } };
  return { owner, workers, messages, phases, registrations, manifest };
}

test('hydro owner owns readiness, restart RPC settlement, stale delivery and request payloads', async t => {
  const { owner, workers, messages, manifest } = fixture(t);
  const ready = owner.setManifest(manifest, 'https://example.test/hydro/index.json');
  assert.deepEqual(messages[0], { type: 'init', manifest, baseUrl: 'https://example.test/hydro/', assetRevision: 'data-123456789012', dataRevision: 'data', includeGeometry: false });
  workers[0].onmessage({ data: { type: 'ready' } });
  assert.equal(await ready, true);
  assert.equal(messages[1].type, 'view');
  const pending = owner.loadFeature(12);
  const rejected = assert.rejects(pending, /다시 시작/);
  const restart = owner.restart();
  await rejected;
  workers[0].onmessage({ data: { type: 'pack', packId: 99, revision: 100, mesh: {} } });
  assert.equal(owner.entries().length, 0);
  owner.dispose();
  assert.equal(await restart, false);
  workers[1].onmessage({ data: { type: 'ready' } });
  assert.equal(owner.hasWorker(), false);
});

test('hydro owner rejects older packs and owns chunked uploads and context cancellation', async t => {
  const { owner, workers, manifest } = fixture(t);
  const jobs = new Map(), deleted = [];
  const scheduler = { enqueueUpload: job => { jobs.set(job.key, job); return new Promise(() => {}); }, cancelKey: key => { const job = jobs.get(key); jobs.delete(key); job?.dispose(); } };
  const gl = { createBuffer: () => ({}), bindBuffer() {}, bufferData() {}, bufferSubData() {}, isBuffer: value => typeof value === 'object', deleteBuffer: value => deleted.push(value) };
  owner.setContext({ gl, version: 2, projectGeneration: 1, contextGeneration: 1, scheduler });
  const ready = owner.setManifest(manifest, 'https://example.test/hydro/index.json');
  workers[0].onmessage({ data: { type: 'ready' } }); await ready;
  workers[0].onmessage({ data: { type: 'active', revision: 2, packIds: [1] } });
  workers[0].onmessage({ data: { type: 'pack', revision: 1, packId: 9, mesh: {} } });
  assert.equal(owner.pack(9), undefined);
  workers[0].onmessage({ data: { type: 'pack', revision: 2, packId: 1, mesh: { riverStarts: new Int32Array([1, 2, 3, 4]) } } });
  assert.equal(jobs.size, 1);
  const job = [...jobs.values()][0];
  assert.equal(job.step({ byteBudget: 8 }).bytes, 0);
  assert.equal(job.step({ byteBudget: 8 }).bytes, 8);
  assert.equal(owner.stats().hydroUploadBytes, 8);
  owner.resetGpu();
  assert.equal(jobs.size, 0);
  assert.equal(deleted.length, 1);
  assert.equal(owner.pack(1).resources, null);
  assert.throws(() => job.step({ byteBudget: 8 }), { name: 'AbortError' });
});

test('hydro readiness timeout settles false and makes late ready inert', async t => {
  let timeout;
  t.mock.method(globalThis, 'setTimeout', callback => { timeout = callback; return 1; });
  t.mock.method(globalThis, 'clearTimeout', () => {});
  const { owner, workers, manifest } = fixture(t);
  const ready = owner.setManifest(manifest, 'https://example.test/hydro/index.json');
  timeout();
  assert.equal(await ready, false);
  workers[0].onmessage({ data: { type: 'ready' } });
  assert.equal(owner.hasWorker(), false);
});
