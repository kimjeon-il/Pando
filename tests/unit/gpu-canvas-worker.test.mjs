import test from 'node:test';
import assert from 'node:assert/strict';
import { createGpuCanvasWorker } from '../../assets/js/modules/gpu-canvas-worker.js';

test('Canvas owner coalesces busy frames and closes stale bitmaps before notifying the presenter', () => {
  const sent = [], presented = [], stale = [];
  const native = { postMessage: value => sent.push(value), terminate() {} };
  const channel = createGpuCanvasWorker({ worker: native, generation: 2,
    acceptFrame: () => true, onStale: value => stale.push(value) });
  channel.onmessage = event => { if (event.data.type === 'frame') presented.push(event.data.revision); };
  channel.queueFrame({ type: 'view', revision: 1, projectGeneration: 2 });
  native.onmessage({ data: { type: 'ready' } });
  channel.queueFrame({ type: 'view', revision: 2, projectGeneration: 2 });
  channel.queueFrame({ type: 'view', revision: 3, projectGeneration: 2 });
  let closed = 0;
  native.onmessage({ data: { type: 'frame', revision: 1, projectGeneration: 2, bitmap: { close: () => closed++ } } });
  assert.deepEqual(sent.map(message => message.revision), [1, 3]);
  assert.deepEqual(presented, []);
  assert.equal(closed, 1);
  native.onmessage({ data: { type: 'frame', revision: 3, projectGeneration: 2, bitmap: {} } });
  assert.deepEqual(presented, [3]);
  assert.equal(stale.length, 1);
  channel.terminate();
});

test('Canvas owner ignores delayed ready/error and settles picks on termination', async () => {
  let terminated = 0, delivered = 0, errors = 0, closed = 0;
  const native = { postMessage() {}, terminate() { terminated++; } };
  const channel = createGpuCanvasWorker({ worker: native, generation: 0, acceptFrame: () => true });
  channel.onmessage = () => delivered++;
  channel.onerror = () => errors++;
  native.onmessage({ data: { type: 'ready' } });
  const pending = channel.pick([1, 2]);
  channel.terminate(); channel.terminate();
  native.onmessage({ data: { type: 'ready' } });
  native.onerror({ message: 'late failure' });
  native.onmessage({ data: { type: 'frame', bitmap: { close: () => closed++ } } });
  assert.equal(await pending, null);
  assert.equal(terminated, 1);
  assert.equal(delivered, 1);
  assert.equal(errors, 0);
  assert.equal(closed, 1);
});
