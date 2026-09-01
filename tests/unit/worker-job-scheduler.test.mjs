import assert from 'node:assert/strict';
import test from 'node:test';

import { createLatestWorkerJobScheduler } from '../../assets/js/modules/worker-job-scheduler.js';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
  return { promise, resolve, reject };
};

test('latest worker scheduler keeps one running job and the newest successor per key', async () => {
  const executions = [];
  const gates = [];
  const scheduler = createLatestWorkerJobScheduler({
    execute: entry => {
      executions.push(entry.targetRevision);
      const gate = deferred();
      gates.push(gate);
      return gate.promise;
    },
  });

  const first = scheduler.enqueue({ jobKey: 'mesh:country:AAA', geometryRevision: 1, targetRevision: 1 });
  const firstCancelled = assert.rejects(first.promise, error => error.cancelled && error.reason === 'coalesced');
  const second = scheduler.enqueue({ jobKey: 'mesh:country:AAA', geometryRevision: 2, targetRevision: 2 });
  const secondCancelled = assert.rejects(second.promise, error => error.cancelled && error.reason === 'coalesced');
  const third = scheduler.enqueue({ jobKey: 'mesh:country:AAA', geometryRevision: 3, targetRevision: 3 });

  await Promise.resolve();
  assert.deepEqual(executions, [1]);
  gates[0].resolve({ revision: 1 });
  await firstCancelled;
  await secondCancelled;
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(executions, [1, 3]);
  gates[1].resolve({ revision: 3 });
  assert.deepEqual(await third.promise, { revision: 3 });
  assert.equal(scheduler.stats().coalesced, 2);
  assert.equal(scheduler.stats().maxQueueDepth, 1);
});

test('latest worker scheduler discards a result whose target revision is stale', async () => {
  let currentRevision = 4;
  const discarded = [];
  const gate = deferred();
  const scheduler = createLatestWorkerJobScheduler({
    execute: () => gate.promise,
    isCurrent: entry => entry.targetRevision === currentRevision,
    discardResult: value => discarded.push(value),
  });
  const ticket = scheduler.enqueue({ jobKey: 'validate:feature:1', targetRevision: 4 });
  currentRevision = 5;
  gate.resolve({ revision: 4 });
  await assert.rejects(ticket.promise, error => error.cancelled && error.reason === 'stale');
  assert.deepEqual(discarded, [{ revision: 4 }]);
  assert.equal(scheduler.stats().staleDiscarded, 1);
});

test('latest worker scheduler recognizes AbortSignal without starting queued work', async () => {
  const blocker = deferred();
  const scheduler = createLatestWorkerJobScheduler({ execute: entry => entry.jobKey === 'active' ? blocker.promise : true });
  const active = scheduler.enqueue({ jobKey: 'active' });
  const controller = new globalThis.AbortController();
  const queued = scheduler.enqueue({ jobKey: 'queued', signal: controller.signal });
  controller.abort();
  await assert.rejects(queued.promise, error => error.cancelled && error.reason === 'aborted');
  blocker.resolve(true);
  await active.promise;
  assert.equal(scheduler.stats().cancelled, 1);
});
