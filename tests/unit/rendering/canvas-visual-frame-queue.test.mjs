import assert from 'node:assert/strict';
import test from 'node:test';
import { createCanvasVisualFrameQueue } from '../../../src/rendering/canvas-visual-frame-queue.js';

test('Canvas admission requires matching view, projection and project generation', () => {
  const queue = createCanvasVisualFrameQueue();
  const frame = { frameId: 7, viewRevision: 4, projectionRevision: 2, projectGeneration: 3 };
  queue.stage(frame);
  assert.equal(queue.has(frame), true);
  assert.equal(queue.matchingFrame(frame), frame);
  assert.equal(queue.matchingFrame({ ...frame, viewRevision: 5 }), null);
  assert.equal(queue.matchingFrame({ ...frame, projectGeneration: 4 }), null);
  queue.stage({ ...frame, frameId: 8 });
  queue.retire({ frameId: 8 }, { canvasPresented: true });
  assert.equal(queue.matchingFrame(frame), null);
});

test('newer view and project invalidate superseded bitmap tickets', () => {
  const queue = createCanvasVisualFrameQueue();
  const old = { frameId: 1, viewRevision: 1, projectionRevision: 1, projectGeneration: 2 };
  const next = { ...old, frameId: 2, viewRevision: 2 };
  queue.stage(old);
  queue.stage(next);
  assert.equal(queue.matchingFrame(old), null);
  assert.equal(queue.matchingFrame(next), next);
  queue.retire(next);
  assert.equal(queue.has(next), false);
  queue.stage({ ...old, frameId: 3, projectGeneration: 3 });
  assert.equal(queue.matchingFrame(next), null);
  queue.clear();
  assert.equal(queue.matchingFrame({ ...old, frameId: 3, projectGeneration: 3 }), null);
});
