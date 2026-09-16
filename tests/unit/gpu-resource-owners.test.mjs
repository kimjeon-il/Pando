import test from 'node:test';
import assert from 'node:assert/strict';
import * as lifecycleModule from '../../assets/js/modules/gpu-resource-lifecycle.js';
import { createGpuUploadScheduler } from '../../assets/js/modules/gpu-upload-scheduler.js';
import { createGpuWorkerChannels } from '../../assets/js/modules/gpu-worker-channels.js';

test('renderer upload cancellation leaves another scheduler consumer live', async () => {
  assert.equal(typeof lifecycleModule.createGpuUploadScope, 'function');
  const frames = [];
  const scheduler = createGpuUploadScheduler({ requestFrame: fn => (frames.push(fn), frames.length), cancelFrame() {},
    now: () => 0, isHidden: () => false, isInputPending: () => false });
  const scope = lifecycleModule.createGpuUploadScope(scheduler);
  let foreignRan = false;
  const foreign = scheduler.enqueueUpload({ key: 'foreign', step: () => { foreignRan = true; return { done: true }; } });
  const own = scope.enqueueUpload({ key: 'foreign', step: () => assert.fail('cancelled renderer job ran') });
  scope.cancelAll();
  await assert.rejects(own, { name: 'AbortError' });
  frames.shift()();
  await foreign;
  assert.equal(foreignRan, true);
  scheduler.dispose();
});

test('lifecycle releases each GL resource once using the context that allocated it', () => {
  const released = [];
  const gl = { createBuffer: () => ({}), deleteBuffer: buffer => released.push(buffer) };
  const owner = lifecycleModule.createGpuResourceLifecycle();
  const first = owner.create(gl, 'Buffer');
  const second = owner.create(gl, 'Buffer');
  owner.release(first); owner.release(first); owner.dispose(); owner.dispose();
  assert.deepEqual(released, [first, second]);
});

test('terminated Worker channels close late bitmaps and never dispatch late errors', () => {
  const workers = [];
  class NativeWorker { constructor() { workers.push(this); } postMessage() {} terminate() {} }
  const owner = createGpuWorkerChannels({ WorkerClass: NativeWorker });
  const first = owner.create('url');
  let delivered = 0, closed = 0;
  first.onmessage = first.onerror = () => delivered++;
  first.terminate();
  workers[0].onmessage({ data: { bitmap: { close: () => closed++ } } });
  workers[0].onerror({ message: 'late' });
  assert.equal(delivered, 0); assert.equal(closed, 1);
  owner.dispose();
});
