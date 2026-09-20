import test from 'node:test';
import assert from 'node:assert/strict';
import { createGpuMeshWorkerJobs } from '../../assets/js/modules/gpu-mesh-worker-jobs.js';

test('full rebuild owner settles replaced, stale and disposed requests and preserves payload', async () => {
  const workers = [], sent = [];
  const owner = createGpuMeshWorkerJobs({ isCurrent: () => true, createWorker: () => {
    const worker = { postMessage: message => sent.push(message), terminate() {} };
    workers.push(worker); return worker;
  } });
  const first = owner.rebuild({ token: 1, projectGeneration: 2, geometryRevision: 3, features: [] });
  const second = owner.rebuild({ token: 2, projectGeneration: 2, geometryRevision: 4, features: [] });
  assert.equal(await first, null);
  workers[0].onmessage({ data: { token: 1, ok: true, mesh: 'late' } });
  workers[1].onmessage({ data: { token: 2, projectGeneration: 1, ok: true, mesh: 'old-project' } });
  assert.equal(await second, null);
  const third = owner.rebuild({ token: 3, projectGeneration: 2, geometryRevision: 4, features: [] });
  workers[2].onmessage({ data: { token: 3, projectGeneration: 2, ok: true, mesh: 'current' } });
  assert.equal(await third, 'current');
  const fourth = owner.rebuild({ token: 4 }); owner.cancelAll();
  assert.equal(await fourth, null);
  assert.deepEqual(sent[0], { token: 1, projectGeneration: 2, geometryRevision: 3, features: [] });
});

test('patch worker owner preserves payload shape and ignores late replies after cancellation', async () => {
  const workers = [], sent = [];
  const owner = createGpuMeshWorkerJobs({ isCurrent: () => true, createWorker: () => {
    const worker = { postMessage: message => sent.push(message), terminate() {} };
    workers.push(worker); return worker;
  } });
  const ticket = owner.enqueue({ jobKey: 'patch', geometryRevision: 4, targetRevision: 4, payload: { token: 7, features: [] } });
  for (let i = 0; i < 6; i++) await Promise.resolve();
  assert.deepEqual(sent, [{ token: 7, geometryRevision: 4, targetRevision: 4, jobKey: 'patch', features: [] }]);
  owner.cancelAll('reset');
  workers[0].onmessage({ data: { token: 7, ok: true, mesh: { positions: new ArrayBuffer(100) } } });
  await assert.rejects(ticket.promise);
  assert.equal(owner.outputBytes(), 0);
});
