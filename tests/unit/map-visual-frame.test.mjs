import assert from 'node:assert/strict';
import test from 'node:test';

import { createMapVisualFrame, isMapVisualFrame } from '../../assets/js/modules/map-visual-frame.js';

test('globe visual frame derives CSS and GPU values from one immutable snapshot', () => {
  const frame = createMapVisualFrame({
    frameId: 12,
    viewRevision: 7,
    projectGeneration: 3,
    projectionRevision: 2,
    viewState: {
      projection: 'globe',
      size: { width: 800, height: 600 },
      dpr: 2,
      translate: [400, 300],
      scale: 280,
      rotation: [10, -20, 0],
      flatCenter: [0, 0],
    },
    projectCoordinate: coordinate => [400 + coordinate[0], 300 - coordinate[1]],
  });

  assert.equal(isMapVisualFrame(frame), true);
  assert.deepEqual(frame.cssViewport, [800, 600]);
  assert.deepEqual(frame.gpuViewport, [1600, 1200]);
  assert.deepEqual(frame.cssTranslate, [400, 300]);
  assert.deepEqual(frame.gpuTranslate, [800, 600]);
  assert.equal(frame.cssScale, 280);
  assert.equal(frame.gpuScale, 560);
  assert.deepEqual(frame.worldOffsets, [0]);
  assert.equal(Object.isFrozen(frame), true);
  assert.equal(Object.isFrozen(frame.viewState), true);
  assert.equal(Object.isFrozen(frame.viewState.rotation), true);
  assert.deepEqual(frame.projectVisibleCoordinate([0, 0]), [400, 300]);
  assert.equal(frame.projectVisibleCoordinate([180, 0]), null);
});

test('flat visual frame keeps visible wrapped worlds in the shared frame', () => {
  const frame = createMapVisualFrame({
    frameId: 4,
    viewRevision: 9,
    projectionRevision: 1,
    viewState: {
      projection: 'flat',
      size: { width: 1200, height: 700 },
      dpr: 1.5,
      translate: [600, 350],
      scale: 190,
      projectionCenter: [179, 0],
      flatCenter: [179, 0],
    },
  });

  assert.equal(frame.mode, 1);
  assert.equal(frame.viewState.flatCenter[0], 179);
  assert.equal(frame.flatCenter[0], 179 * Math.PI / 180);
  assert.ok(frame.worldOffsets.length >= 1);
  assert.ok(frame.worldOffsets.every(Number.isFinite));
  assert.equal(Object.isFrozen(frame.worldOffsets), true);
  const datelinePoint = frame.projectVisibleCoordinate([-179, 0]);
  assert.ok(datelinePoint);
  assert.ok(datelinePoint[0] >= -30 && datelinePoint[0] <= 1230);
  assert.equal(Object.isFrozen(datelinePoint), true);
});
