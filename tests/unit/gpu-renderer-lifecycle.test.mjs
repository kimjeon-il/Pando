import test from 'node:test';
import assert from 'node:assert/strict';
import { createGpuMapRenderer } from '../../assets/js/modules/gpu-map-renderer.js';
import { createGpuResourceLifecycle } from '../../assets/js/modules/gpu-resource-lifecycle.js';

test('disposing an awaited frame settles AbortError and a late callback is inert', async t => {
  let callback;
  globalThis.requestAnimationFrame = fn => { callback = fn; return 1; };
  globalThis.cancelAnimationFrame = () => {};
  t.after(() => { delete globalThis.requestAnimationFrame; delete globalThis.cancelAnimationFrame; });
  const lifecycle = createGpuResourceLifecycle();
  const pending = lifecycle.nextFrame();
  lifecycle.dispose();
  await assert.rejects(pending, { name: 'AbortError' });
  callback(10);
  await assert.rejects(lifecycle.nextFrame(), { name: 'AbortError' });
});

test('renderer disposal is idempotent and prevents deferred initialization', async t => {
  t.mock.method(globalThis, 'setTimeout', () => { throw new Error('disposed renderer scheduled work'); });
  globalThis.Worker = class {};
  t.after(() => { delete globalThis.Worker; });
  let requestedFrames = 0;
  const renderer = createGpuMapRenderer({
    state: {}, runtimeAssetUrl: path => path,
    scheduleGpuFrame: () => requestedFrames++,
  });
  assert.equal(typeof renderer.dispose, 'function');
  renderer.dispose();
  renderer.dispose();
  assert.equal(await renderer.initialize(), false);
  assert.equal(renderer.getRenderDevice(), null);
  assert.equal(requestedFrames, 0);
});
