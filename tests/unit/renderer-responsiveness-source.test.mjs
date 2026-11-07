import test from 'node:test';
import assert from 'node:assert/strict';
import { createMapVisualFrame, isMapVisualFrame } from '../../shared/frontend/js/modules/map-visual-frame.js';
import { createSceneColorCache } from '../../shared/frontend/js/modules/scene-color-cache.js';
import { createGpuUploadScheduler } from '../../shared/frontend/js/modules/gpu-upload-scheduler.js';

test('changing the camera changes the immutable Viewer frame, not the caller-owned view input', () => {
  const viewState = {projection: 'flat', size: {width: 640, height: 480}, dpr: 2,
    translate: [320, 240], scale: 150, projectionCenter: [0, 0]};
  const original = structuredClone(viewState);
  const frame = createMapVisualFrame({frameId: 1, viewRevision: 1, projectGeneration: 1, viewState});
  assert.ok(isMapVisualFrame(frame));
  assert.ok(Object.isFrozen(frame) && Object.isFrozen(frame.cssViewport));
  assert.deepEqual(frame.cssViewport, [viewState.size.width, viewState.size.height]);
  assert.deepEqual(frame.gpuViewport, frame.cssViewport.map(value => value * viewState.dpr));
  assert.deepEqual(frame.projectVisibleCoordinate([0, 0]), viewState.translate);
  const previousSignature = frame.signature;
  viewState.projectionCenter = [20, 0];
  const moved = createMapVisualFrame({frameId: 2, viewRevision: 2, projectGeneration: 1, viewState});
  assert.notEqual(moved.signature, previousSignature);
  assert.deepEqual(frame.projectVisibleCoordinate([0, 0]), original.translate,
    'a previous frame must retain its original camera');
  assert.notDeepEqual(moved.projectCoordinate([0, 0]), frame.projectCoordinate([0, 0]));
});

test('invalidated scene-cache state cannot be mistaken for an accepted visual frame', () => {
  const cache = createSceneColorCache();
  assert.equal(cache.isValid(), false);
  assert.equal(cache.canComposite('current-view', 1), false);
  cache.invalidate('territorial-input-updated');
  assert.equal(cache.stats().lastInvalidationReason, 'territorial-input-updated');
  assert.equal(cache.canComposite('current-view', 1), false);
  cache.reset({dropActive: true});
  assert.equal(cache.isValid(), false);
  cache.dispose();
  assert.equal(cache.isAvailable(), false);
});

test('a failed GPU upload releases its resource and lets the next current-frame upload proceed', async () => {
  const frames = [], disposed = [];
  const scheduler = createGpuUploadScheduler({
    requestFrame: callback => { frames.push(callback); return frames.length; },
    cancelFrame() {}, now: () => 0, isHidden: () => false, isInputPending: () => false,
  });
  const old = scheduler.enqueueUpload({key: 'current-background', priority: 10,
    step: () => { throw new Error('current upload failed'); },
    dispose: () => disposed.push('failed')});
  frames.shift()();
  await assert.rejects(old, /current upload failed/);
  assert.deepEqual(disposed, ['failed']);
  assert.equal(scheduler.getStats().pending, 0);
  const accepted = scheduler.enqueueUpload({key: 'current-background',
    step: ({byteBudget}) => ({done: true, bytes: Math.min(byteBudget, 1024), value: 'presentable'})});
  frames.shift()();
  assert.equal(await accepted, 'presentable');
  assert.equal(scheduler.getStats().completed, 1);
  scheduler.dispose();
});
