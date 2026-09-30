import test from 'node:test';
import assert from 'node:assert/strict';
import { createGpuHydroPreparation } from '../../assets/js/modules/gpu-hydro-preparation.js';

function fixture(t) {
  globalThis.Worker = class {};
  t.after(() => { delete globalThis.Worker; });
  const workers = [], messages = [], phases = [], registrations = [], errors = [];
  const owner = createGpuHydroPreparation({
    createWorker: () => { const worker = { postMessage: message => messages.push(message), terminate() { this.terminated = true; } }; workers.push(worker); return worker; },
    getMode: () => 'webgl2', getView: () => ({ projection: 'flat', threshold: 1, width: 100, height: 100, scale: 100, flatCenter: [0, 0] }),
    getCacheBudget: () => 8 * 1024 * 1024, getProtectedPackIds: () => [], isMobile: () => false, DATA_REVISION: 'data', ASSET_REVISION: 'asset',
    registerHydroFragments: rows => registrations.push(rows), registerHydroDescriptors: rows => registrations.push(rows), unregisterHydroFragments() {},
    queueHydroRender() {}, reportOperationError: error => errors.push(error), setActionStatus() {}, onReset() {}, onConnect() {}, onLoadState: phase => phases.push(phase),
  });
  t.after(() => owner.dispose());
  const manifest = { stages: [{ id: 0, minZoom: 0, columns: 1, rows: 1 }], index: { sha256: '123456789012345' } };
  return { owner, workers, messages, phases, registrations, manifest, errors };
}

function fakeTimers(t) {
  const timers = new Map();
  let next = 0;
  t.mock.method(globalThis, 'setTimeout', (callback, delay) => {
    const id = ++next; timers.set(id, { callback, delay }); return id;
  });
  t.mock.method(globalThis, 'clearTimeout', id => timers.delete(id));
  return timers;
}

test('a ready Worker crash retires its generation and settles both RPC kinds without removing packs', async t => {
  const timers = fakeTimers(t);
  const { owner, workers, manifest, phases, errors } = fixture(t);
  const ready = owner.setManifest(manifest, 'https://example.test/hydro/index.json');
  const worker = workers[0];
  worker.onmessage({ data: { type: 'ready' } }); await ready;
  worker.onmessage({ data: { type: 'pack', packId: 7, revision: 1, mesh: {} } });
  const pack = owner.pack(7);
  const feature = owner.loadFeature(12).catch(error => error);
  const query = owner.queryFeatures([0, 0, 1, 1]).catch(error => error);
  const crash = new Error('Worker crashed after ready');
  worker.onerror({ message: crash.message, error: crash });
  assert.equal(owner.hasWorker(), false);
  assert.equal(worker.terminated, true);
  assert.strictEqual(await feature, crash);
  assert.strictEqual(await query, crash);
  assert.equal(owner.stats().hydroFeaturePendingCount, 0);
  assert.equal(owner.stats().hydroLogicalQueryPendingCount, 0);
  assert.equal(timers.size, 0);
  assert.equal(phases.at(-1).hydroWorker, 'error');
  assert.strictEqual(errors[0], crash);
  worker.onmessage({ data: { type: 'ready' } });
  worker.onmessage({ data: { type: 'feature', requestId: 1, feature: {} } });
  worker.onmessage({ data: { type: 'pack', packId: 8, revision: 100, mesh: {} } });
  assert.strictEqual(owner.pack(7), pack);
  assert.equal(owner.pack(8), undefined);
  await assert.rejects(owner.loadFeature(12), /준비되지/);
});

for (const operation of ['feature', 'query']) {
  test(`${operation} RPC timeout retires the entire Worker and ignores late replies`, async t => {
    const timers = fakeTimers(t);
    const { owner, workers, manifest } = fixture(t);
    const ready = owner.setManifest(manifest, 'https://example.test/hydro/index.json');
    workers[0].onmessage({ data: { type: 'ready' } }); await ready;
    const feature = owner.loadFeature(12).catch(error => error);
    const query = owner.queryFeatures([0, 0, 1, 1]).catch(error => error);
    assert.equal(timers.size, 2);
    const timeout = [...timers.values()][operation === 'feature' ? 0 : 1];
    assert.equal(timeout.delay, 30000);
    timeout.callback();
    const failure = await feature;
    assert.equal(failure.name, 'TimeoutError');
    assert.equal(failure.requestType, operation === 'feature' ? 'load-feature' : 'query-logical-features');
    assert.strictEqual(await query, failure);
    assert.equal(owner.hasWorker(), false);
    assert.equal(workers[0].terminated, true);
    assert.equal(owner.stats().hydroFeaturePendingCount, 0);
    assert.equal(owner.stats().hydroLogicalQueryPendingCount, 0);
    assert.equal(timers.size, 0);
    workers[0].onmessage({ data: { type: 'logical-features', requestId: 2, logicalFids: [9] } });
    workers[0].onmessage({ data: { type: 'ready' } });
    assert.equal(owner.hasWorker(), false);
  });
}

test('RPC replies and typed errors cancel their timers without retiring a healthy Worker', async t => {
  const timers = fakeTimers(t);
  const { owner, workers, manifest } = fixture(t);
  const ready = owner.setManifest(manifest, 'https://example.test/hydro/index.json');
  workers[0].onmessage({ data: { type: 'ready' } }); await ready;
  const feature = owner.loadFeature(12).catch(error => error);
  const query = owner.queryFeatures([0, 0, 1, 1]).catch(error => error);
  assert.equal(timers.size, 2);
  workers[0].onmessage({ data: { type: 'feature', requestId: 1, feature: { id: 'river' } } });
  workers[0].onmessage({ data: { type: 'logical-features-error', requestId: 2, message: 'query failed' } });
  assert.deepEqual(await feature, { id: 'river' });
  assert.match((await query).message, /query failed/);
  assert.equal(timers.size, 0);
  assert.equal(owner.hasWorker(), true);
  assert.equal(owner.stats().hydroFeaturePendingCount, 0);
  assert.equal(owner.stats().hydroLogicalQueryPendingCount, 0);
});

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

test('replacing an edit during upload releases its buffers without treating segment counts as WebGL buffers', t => {
  const { owner } = fixture(t);
  const jobs = new Map(), created = [], deleted = [];
  const scheduler = {
    enqueueUpload: job => { jobs.set(job.key, job); return new Promise(() => {}); },
    cancelKey: key => { const job = jobs.get(key); jobs.delete(key); job?.dispose(); },
  };
  const gl = {
    ARRAY_BUFFER: 1, ELEMENT_ARRAY_BUFFER: 2,
    createBuffer() { const buffer = {}; created.push(buffer); return buffer; },
    bindBuffer() {}, bufferData() {}, bufferSubData() {},
    isBuffer(value) { assert.equal(typeof value, 'object', 'WebGL isBuffer rejects numeric segment counts'); return created.includes(value); },
    deleteBuffer: value => deleted.push(value),
  };
  owner.setContext({ gl, version: 2, projectGeneration: 1, contextGeneration: 1, scheduler });
  const mesh = Object.fromEntries([
    'riverStarts', 'riverEnds', 'riverFeatureIds', 'riverStartWidths', 'riverEndWidths',
    'borderRiverStarts', 'borderRiverEnds', 'borderRiverFeatureIds', 'borderRiverStartWidths', 'borderRiverEndWidths',
    'lakePositions', 'lakeFeatureIds', 'lakeIndices', 'lakeBoundaryStarts', 'lakeBoundaryEnds', 'lakeBoundaryFeatureIds', 'lakeBoundaryWidths',
  ].map(key => [key, new Int32Array()]));
  mesh.riverStarts = new Int32Array([0, 0, 1, 1]);
  mesh.riverFeatureIds = new Uint32Array([0]);
  const entry = { id: 'edit:river:#3b82c4', mesh };
  owner.replaceEdits([entry], 7);
  [...jobs.values()][0].step({ byteBudget: 8 });
  assert.equal(entry.uploadState.resources.riverSegmentCount, 1);
  assert.ok(created.length > 0);
  owner.replaceEdits([], 8);
  assert.equal(owner.editRevision, 8);
  assert.deepEqual(deleted, created);
  assert.equal(entry.uploadState, null);
  assert.equal(jobs.size, 0);
});
