import assert from 'node:assert/strict';
import test from 'node:test';

import { createMapEditWorkerClient } from '../../assets/js/modules/map-edit-worker-client.js';

test('timed out geometry calculation terminates its worker and retries from current project data', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const workers = [];
  let features = [{ id: 'AAA', geometry: null }];
  const client = createMapEditWorkerClient({
    createWorker: () => {
      const worker = createFakeWorker();
      if (!workers.length) worker.postMessage = function(message) {
        this.messages.push(message);
        if (message.type === 'rebase') Promise.resolve().then(() => this.onmessage({ data: { type: 'ready' } }));
      };
      workers.push(worker);
      return worker;
    },
    getFeatures: () => features,
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
  assert.deepEqual(workers[1].messages[0].features, features);
});

function createFakeWorker() {
  return {
    messages: [],
    terminated: false,
    onmessage: null,
    onerror: null,
    postMessage(message) {
      this.messages.push(message);
      if (message.type === 'rebase') Promise.resolve().then(() => this.onmessage({ data: { type: 'ready' } }));
      if (message.type === 'execute') Promise.resolve().then(() => this.onmessage({
        data: { type: 'result', requestId: message.requestId, dataRevision: message.dataRevision, ok: true, result: { affectedIds: ['AAA'] } },
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
    getFeatures: () => [feature],
    getFeatureById: id => id === 'AAA' ? feature : null,
    clone: value => JSON.parse(JSON.stringify(value)),
    now: () => Date.now(),
    schedule: callback => Promise.resolve().then(callback),
  });
  const response = await client.execute('merge', { targetId: 'AAA' });
  assert.deepEqual(response.result.affectedIds, ['AAA']);
  client.commit(response.requestId);
  assert.deepEqual(workers[0].messages.map(message => message.type), ['rebase', 'execute', 'commit']);
});

test('map edit worker client relies on postMessage structured cloning for scoped patches', async () => {
  const worker = createFakeWorker();
  const feature = { type: 'Feature', id: 'AAA', properties: { name: 'AAA' }, geometry: null };
  const client = createMapEditWorkerClient({
    createWorker: () => worker,
    getFeatures: () => [feature],
    getFeatureById: id => id === 'AAA' ? feature : null,
    clone: value => JSON.parse(JSON.stringify(value)),
    schedule: callback => Promise.resolve().then(callback),
  });
  client.rebase();
  await Promise.resolve();
  client.syncPatch(['AAA', 'MISSING', 'AAA']);
  assert.deepEqual(worker.messages[1].removedIds, ['MISSING']);
  assert.deepEqual(worker.messages[1].features, [feature]);
  assert.equal(worker.messages[1].features[0], feature);
});

test('map edit worker client reuses one rebased worker for consecutive operations', async () => {
  const worker = createFakeWorker();
  const feature = { type: 'Feature', id: 'AAA', properties: { name: 'AAA' }, geometry: null };
  const client = createMapEditWorkerClient({
    createWorker: () => worker,
    getFeatures: () => [feature],
    getFeatureById: () => feature,
    schedule: callback => Promise.resolve().then(callback),
  });
  await client.execute('merge', { targetId: 'AAA' });
  await client.execute('annex', { targetId: 'AAA' });
  assert.deepEqual(worker.messages.map(message => message.type), ['rebase', 'execute', 'execute']);
});
