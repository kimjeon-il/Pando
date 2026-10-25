import assert from 'node:assert/strict';
import test from 'node:test';

const ready = dataRevision => ({ rpc: 'pandolab-worker-rpc', protocolVersion: 1, type: 'event', operation: 'map-edit.ready', payload: { dataRevision } });

import { createMapEditWorkerClient } from "../../apps/editor/frontend/js/modules/map-edit-worker-client.js";

test('timed out geometry calculation terminates its worker and retries from current project data', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const workers = [];
  let features = [{ id: 'AAA', geometry: null }];
  const client = createMapEditWorkerClient({
    createWorker: () => {
      const worker = createFakeWorker();
      if (!workers.length) worker.postMessage = function(message) {
        this.messages.push(message);
        if (message.operation === 'map-edit.rebase') Promise.resolve().then(() => this.onmessage({ data: ready(message.payload.dataRevision) }));
      };
      workers.push(worker);
      return worker;
    },
    getEntities: () => features,
    getFeatureById: id => features.find(feature => feature.id === id),
    schedule: callback => Promise.resolve().then(callback),
  });
  t.after(() => client.stop());
  const rejected = assert.rejects(client.execute('territory-components', { payload: {} }), { code: 'PL-WORKER-RPC-TIMEOUT' });
  for (let i = 0; i < 20; i++) await Promise.resolve();
  t.mock.timers.tick(60_000);
  for (let i = 0; i < 20; i++) await Promise.resolve();
  t.mock.timers.tick(0);
  await rejected;
  assert.equal(workers[0].terminated, true);
  features = [{ id: 'BBB', geometry: null }];
  await client.execute('territory-components', { payload: {} });
  assert.deepEqual(workers[1].messages[0].payload.editSources.patches.map(row => ({...row.metadata, geometry: row.geometry})), features);
});

function createFakeWorker() {
  return {
    messages: [],
    terminated: false,
    onmessage: null,
    onerror: null,
    postMessage(message) {
      this.messages.push(message);
      if (message.operation === 'map-edit.rebase') Promise.resolve().then(() => this.onmessage({ data: ready(message.payload.dataRevision) }));
      if (message.type === 'request') Promise.resolve().then(() => this.onmessage({
        data: { ...message, type: 'result', ok: true, result: { affectedIds: ['AAA'] } },
      }));
    },
    terminate() { this.terminated = true; },
  };
}

test('map edit worker client rebases, executes and commits with one revision stream', async () => {
  const workers = [];
  const feature = { type: 'Feature', id: 'AAA', properties: { name: 'AAA' }, geometry: null };
  const client = createMapEditWorkerClient({
    createWorker: () => { const worker = createFakeWorker(); workers.push(worker); return worker; },
    getEntities: () => [feature],
    getFeatureById: id => id === 'AAA' ? feature : null,
    clone: value => JSON.parse(JSON.stringify(value)),
    now: () => Date.now(),
    schedule: callback => Promise.resolve().then(callback),
  });
  const response = await client.execute('merge', { targetId: 'AAA' });
  assert.deepEqual(response.result.affectedIds, ['AAA']);
  assert.throws(() => client.commit(response.requestId), /prepared geometry revision/);
  client.commit(response.requestId, response.geometryRevision);
  assert.deepEqual(workers[0].messages.map(message => message.operation), ['map-edit.rebase', 'merge', 'map-edit.commit']);
});

test('map edit worker client relies on postMessage structured cloning for scoped patches', async () => {
  const worker = createFakeWorker();
  const feature = { type: 'Feature', id: 'AAA', properties: { name: 'AAA' }, geometry: null };
  const client = createMapEditWorkerClient({
    createWorker: () => worker,
    getEntities: () => [feature],
    getFeatureById: id => id === 'AAA' ? feature : null,
    clone: value => JSON.parse(JSON.stringify(value)),
    schedule: callback => Promise.resolve().then(callback),
  });
  client.rebase();
  await Promise.resolve();
  client.syncPatch(['AAA', 'MISSING', 'AAA']);
  assert.deepEqual(worker.messages[1].payload.removedIds, ['MISSING']);
  assert.deepEqual(worker.messages[1].payload.features, [feature]);
  assert.equal(worker.messages[1].payload.features[0], feature);
});

test('map edit worker client reuses one rebased worker for consecutive operations', async () => {
  const worker = createFakeWorker();
  const feature = { type: 'Feature', id: 'AAA', properties: { name: 'AAA' }, geometry: null };
  const client = createMapEditWorkerClient({
    createWorker: () => worker,
    getEntities: () => [feature],
    getFeatureById: () => feature,
    schedule: callback => Promise.resolve().then(callback),
  });
  await client.execute('merge', { targetId: 'AAA' });
  await client.execute('annex', { targetId: 'AAA' });
  assert.deepEqual(worker.messages.map(message => message.operation), ['map-edit.rebase', 'merge', 'annex']);
});


test('boundary requests reuse synchronized sources and send only geometry, hierarchy, or lock deltas', async t => {
  const worker = createFakeWorker();
  const country = { id: 'A', geometry: { type: 'Polygon', coordinates: [] }, properties: {} };
  let unit = { id: 'child', geometry: { type: 'Polygon', coordinates: [] }, properties: { entityKind: 'general', parentId: 'A' } };
  let color = 'red';
  const client = createMapEditWorkerClient({ createWorker: () => worker, getEntities: () => [country,unit], getFeatureById: () => country,
    getBoundaryFeatures: () => [{ ...country, properties: { color } }, unit], schedule: callback => Promise.resolve().then(callback) });
  t.after(() => client.stop());
  await client.execute('boundary-prepare', { payload: { targetIds: ['A'], mode: 'coast' } });
  assert.equal(worker.messages[0].payload.boundaryIds.length, 2);
  color = 'blue';
  await client.execute('boundary-prepare', { payload: { targetIds: ['A'], mode: 'coast' } });
  assert.equal(worker.messages.filter(message => message.operation === 'map-edit.boundary-sync').length, 0);
  unit = { ...unit, properties: { ...unit.properties, locked: true } };
  await client.execute('boundary-move', { payload: { preparationId: 'test', moves: [{nodeKey: '0,0', coordinate: [1, 0]}] } });
  const patches = worker.messages.filter(message => message.operation === 'map-edit.boundary-sync');
  assert.equal(patches.length, 1);
  assert.deepEqual(patches[0].payload.features, [unit]);
  assert.strictEqual(patches[0].payload.features[0].geometry, unit.geometry);
  const execute = worker.messages.filter(message => message.type === 'request').at(-1);
  assert.equal(execute.payload.payload.preparationId, 'test');
  client.invalidateBoundaryCache();
  assert.equal(worker.messages.at(-1).operation, 'map-edit.boundary-invalidate');
});

function manualWorkerClient(t) {
  const workers = [];
  const client = createMapEditWorkerClient({
    createWorker: () => {
      const worker = createFakeWorker();
      worker.postMessage = function(message) { this.messages.push(message); };
      workers.push(worker);
      return worker;
    },
    getEntities: () => [],
    getFeatureById: () => null,
  });
  t.after(() => client.stop());
  return { client, workers };
}

test('retired edit worker errors cannot clear replacement readiness', t => {
  const { client, workers } = manualWorkerClient(t);
  client.rebase();
  const retiredError = workers[0].onerror;
  client.stop();
  const revision = client.rebase();
  workers[1].onmessage({ data: ready(revision) });
  assert.equal(client.stats().ready, true);
  retiredError({ message: 'retired bootstrap failure' });
  assert.equal(client.stats().ready, true);
  assert.equal(workers[1].terminated, false);
  assert.equal(workers.length, 2);
});

test('retired edit worker ready messages cannot ready a same-revision replacement', t => {
  const { client, workers } = manualWorkerClient(t);
  const revision = client.rebase();
  const retiredMessage = workers[0].onmessage;
  workers[0].onerror({ message: 'bootstrap failure' });
  client.invalidateBoundaryCache();
  assert.equal(workers.length, 2);
  assert.equal(client.stats().dataRevision, revision);
  retiredMessage({ data: ready(revision) });
  assert.equal(client.stats().ready, false);
  workers[1].onmessage({ data: ready(revision) });
  assert.equal(client.stats().ready, true);
});

test('stopped edit worker ignores ready messages without a replacement', t => {
  const { client, workers } = manualWorkerClient(t);
  const revision = client.rebase();
  const retiredMessage = workers[0].onmessage;
  client.stop();
  retiredMessage({ data: ready(revision) });
  assert.equal(client.stats().ready, false);
  assert.equal(client.stats().workerActive, false);
  assert.equal(workers.length, 1);
});

test('active edit worker errors clear readiness without cancelling the native error', t => {
  const { client, workers } = manualWorkerClient(t);
  const revision = client.rebase();
  workers[0].onmessage({ data: ready(revision) });
  let prevented = false;
  workers[0].onerror({ message: 'active bootstrap failure', preventDefault: () => { prevented = true; } });
  assert.equal(client.stats().ready, false);
  assert.equal(client.stats().crashes, 1);
  assert.equal(workers[0].terminated, true);
  assert.equal(prevented, false);
});
