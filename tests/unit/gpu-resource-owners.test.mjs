import test from 'node:test';
import assert from 'node:assert/strict';
import * as lifecycleModule from "../../shared/frontend/js/modules/gpu-resource-lifecycle.js";
import { createGpuUploadScheduler } from "../../shared/frontend/js/modules/gpu-upload-scheduler.js";
import { createGpuWorkerChannels } from "../../shared/frontend/js/modules/gpu-worker-channels.js";

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

test('P3-4 lease frees a staged base when a later override stage aborts', async () => {
  const deleted = [];
  const gl = { createBuffer: () => ({}), deleteBuffer: buffer => deleted.push(buffer) };
  const lifecycle = lifecycleModule.createGpuResourceLifecycle();
  const lease = lifecycleModule.createGpuResourceLease(resources => {
    lifecycle.release(resources.positionBuffer);
    lifecycle.release(resources.fillIndexBuffer);
  });
  const base = { positionBuffer: lifecycle.create(gl, 'Buffer'), fillIndexBuffer: lifecycle.create(gl, 'Buffer') };
  await assert.rejects(async () => {
    try {
      lease.own(base);
      throw Object.assign(new Error('Override staging superseded'), { name: 'AbortError' });
    } finally { lease.releaseAll(); }
  }, { name: 'AbortError' });
  lease.releaseAll();
  assert.deepEqual(deleted, [base.positionBuffer, base.fillIndexBuffer]);
  lifecycle.dispose();
  assert.equal(deleted.length, 2);
});

test('P3-4 lease transfers only adopted resources and releases rejected buffers once', () => {
  const deleted = [];
  const gl = { createBuffer: () => ({}), deleteBuffer: buffer => deleted.push(buffer) };
  const lifecycle = lifecycleModule.createGpuResourceLifecycle();
  const lease = lifecycleModule.createGpuResourceLease(resources => lifecycle.release(resources.positionBuffer));
  const base = { positionBuffer: lifecycle.create(gl, 'Buffer') };
  const override = { positionBuffer: lifecycle.create(gl, 'Buffer') };
  lease.own(base);
  lease.own(override);
  assert.equal(lease.transfer(base), true);
  lease.releaseAll(); lease.releaseAll();
  assert.deepEqual(deleted, [override.positionBuffer]);
  lifecycle.release(base.positionBuffer);
  assert.deepEqual(deleted, [override.positionBuffer, base.positionBuffer]);
  lifecycle.dispose();
  assert.equal(deleted.length, 2);
});

test('P3-4 late GL handles after lifecycle disposal are released by their allocating context', () => {
  const freed = [];
  const gl = { isContextLost: () => false, deleteBuffer: value => freed.push(value) };
  const lifecycle = lifecycleModule.createGpuResourceLifecycle();
  lifecycle.dispose();
  const lateBuffer = {};
  assert.equal(lifecycle.retain(gl, 'Buffer', lateBuffer), null);
  assert.deepEqual(freed, [lateBuffer]);
});
