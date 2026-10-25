import test from 'node:test';
import assert from 'node:assert/strict';
import { createGpuMeshWorkerJobs } from "../../shared/frontend/js/modules/gpu-mesh-worker-jobs.js";

test('polygon preparation accepts finite progress across a long batch but still times out a stalled batch', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const sent = [], worker = { postMessage: message => sent.push(message), terminate() {} };
  const jobs = createGpuMeshWorkerJobs({ isCurrent: () => true, createWorker: () => worker });
  const request = jobs.preparePolygons([{ cacheKey: 'a' }, { cacheKey: 'b' }], 1)
    .then(value => ({ value }), error => ({ error }));
  for (let i = 0; i < 6; i++) await Promise.resolve();
  const envelope = sent.find(message => message.type === 'request');
  const progress = completed => worker.onmessage({ data: { ...envelope, type: 'event',
    operation: 'geometry.prepare-progress', payload: { requestId: envelope.requestId, completed, total: 3 } } });
  t.mock.timers.tick(25000); progress(1);
  t.mock.timers.tick(25000); progress(2);
  t.mock.timers.tick(25000); progress(3);
  worker.onmessage({ data: { ...envelope, type: 'result', ok: true, result: { packets: [] } } });
  assert.deepEqual(await request, { value: { packets: [] } });
  const stalled = jobs.preparePolygons([{ cacheKey: 'stalled' }], 2)
    .then(() => assert.fail('stalled preparation must time out'), error => error);
  for (let i = 0; i < 12; i++) await Promise.resolve();
  t.mock.timers.tick(30000);
  assert.equal((await stalled).code, 'PL-WORKER-RPC-TIMEOUT');
  jobs.cancelAll();
});

test('full rebuild owner settles replaced, stale and disposed requests and preserves payload', async () => {
  const workers = [], sent = [];
  const owner = createGpuMeshWorkerJobs({ isCurrent: () => true, createWorker: () => {
    const worker = { postMessage: message => sent.push(message), terminate() {} };
    workers.push(worker); return worker;
  } });
  const first = owner.rebuild({ token: 1, projectGeneration: 2, geometryRevision: 3, features: [] });
  const second = owner.rebuild({ token: 2, projectGeneration: 2, geometryRevision: 4, features: [] });
  assert.equal(await first, null);
  workers[0].onmessage?.({ data: { ...sent[0], type: 'result', ok: true, result: 'late' } });
  workers[1].onmessage({ data: { ...sent.find(x => x.type === 'request' && x.metadata.geometryRevision === 4), type: 'result', projectRevision: 1, ok: true, result: 'old-project' } });
  assert.equal(await second, null);
  const third = owner.rebuild({ token: 3, projectGeneration: 2, geometryRevision: 4, features: [] });
  for (let i = 0; i < 6; i++) await Promise.resolve();
  workers[1].onmessage({ data: { ...sent.at(-1), type: 'result', ok: true, result: 'current' } });
  assert.equal(await third, 'current');
  assert.equal(workers.length, 2, 'idle rebuild Worker retains prepared geometry');
  owner.cancelAll('prepare-full-rebuild', { preserveIdleRebuild: true });
  const fourth = owner.rebuild({ token: 4 });
  assert.equal(workers.length, 2); owner.cancelAll();
  assert.equal(await fourth, null);
  assert.equal(sent[0].operation, 'geometry.mesh');
  assert.equal(sent[0].projectRevision, 2);
  assert.deepEqual(sent[0].payload, { rows: [], coordinates: new Float64Array() });
});

test('newer polygon preparation terminates busy refinement and adopts only its reply', async () => {
  const workers = [], sent = [];
  const jobs = createGpuMeshWorkerJobs({ isCurrent: () => true, createWorker: () => {
    const worker = { terminated: false, postMessage: message => sent.push(message), terminate() { this.terminated = true; } };
    workers.push(worker); return worker;
  } });
  const first = jobs.preparePolygons([{ cacheKey: 'old' }], 1);
  const rejected = assert.rejects(first, error => error.cancelled);
  for (let i = 0; i < 6; i++) await Promise.resolve();
  const latest = jobs.preparePolygons([{ cacheKey: 'new' }], 2);
  await rejected;
  for (let i = 0; i < 12; i++) await Promise.resolve();
  assert.equal(workers[0].terminated, true);
  const request = sent.find(message => message.type === 'request' && message.metadata.geometryRevision === 2);
  assert.equal(request.operation, 'geometry.prepare');
  assert.deepEqual(request.payload, { items: [{ cacheKey: 'new' }] });
  workers[1].onmessage({ data: { ...request, type: 'result', ok: true, result: { packets: ['latest'] } } });
  assert.deepEqual(await latest, { packets: ['latest'] });
  jobs.cancelAll();
});

test('patch worker owner preserves payload shape and ignores late replies after cancellation', async () => {
  const workers = [], sent = [];
  const owner = createGpuMeshWorkerJobs({ isCurrent: () => true, createWorker: () => {
    const worker = { postMessage: message => sent.push(message), terminate() {} };
    workers.push(worker); return worker;
  } });
  const ticket = owner.enqueue({ jobKey: 'patch', geometryRevision: 4, targetRevision: 4, payload: { token: 7, features: [] } });
  for (let i = 0; i < 6; i++) await Promise.resolve();
  assert.equal(sent[0].operation, 'geometry.mesh');
  assert.deepEqual(sent[0].metadata, { geometryRevision: 4, targetRevision: 4, jobKey: 'patch', payload: { token: 7 } });
  owner.cancelAll('reset');
  workers[0].onmessage?.({ data: { ...sent[0], type: 'result', ok: true, result: { positions: new ArrayBuffer(100) } } });
  await assert.rejects(ticket.promise);
  assert.equal(owner.outputBytes(), 0);
});
