import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyReferenceImagePlacementDrag,
  createReferenceImagePlacementDrag,
  normalizeReferenceImageRotation,
  normalizeReferenceImageScreenRect,
  referenceImagePlacementGeometry,
  referenceImagePlacementHit,
} from '../../assets/js/modules/reference-image-placement.js';

test('reference image rotation normalizes into the signed half-turn range', () => {
  assert.equal(normalizeReferenceImageRotation(0), 0);
  assert.equal(normalizeReferenceImageRotation(190), -170);
  assert.equal(normalizeReferenceImageRotation(-190), 170);
  assert.equal(normalizeReferenceImageRotation('bad'), 0);
});

test('screen rect normalization rejects invalid values and enforces the current minimum size', () => {
  assert.equal(normalizeReferenceImageScreenRect(null), null);
  assert.equal(normalizeReferenceImageScreenRect({ x: 0, y: 0, width: 'bad', height: 10 }), null);
  assert.deepEqual(
    normalizeReferenceImageScreenRect({ x: 10, y: 20, width: 12, height: 8 }),
    { x: 10, y: 20, width: 48, height: 36 },
  );
});

test('placement geometry rotates corners and keeps the center stable', () => {
  const record = { screenRect: { x: 100, y: 50, width: 200, height: 100 }, rotation: 90 };
  const geometry = referenceImagePlacementGeometry(record);
  assert.deepEqual(geometry.center, [200, 100]);
  assert.ok(Math.abs(geometry.corners[0][0] - 250) < 1e-9);
  assert.ok(Math.abs(geometry.corners[0][1] - 0) < 1e-9);
});

test('placement hit distinguishes body, corner scale and rotation handle', () => {
  const record = { screenRect: { x: 100, y: 100, width: 200, height: 100 }, rotation: 0 };
  const geometry = referenceImagePlacementGeometry(record);
  assert.equal(referenceImagePlacementHit(record, [200, 150]).type, 'move');
  assert.equal(referenceImagePlacementHit(record, geometry.corners[2]).type, 'scale');
  assert.equal(referenceImagePlacementHit(record, geometry.rotateHandle).type, 'rotate');
  assert.equal(referenceImagePlacementHit(record, [10, 10]), null);
});

test('placement drag moves the current screen-space placement', () => {
  const value = { id: 'a', screenRect: { x: 10, y: 20, width: 100, height: 80 }, rotation: 0 };
  const drag = createReferenceImagePlacementDrag(value, { type: 'move' }, [20, 30], 1);
  assert.equal(applyReferenceImagePlacementDrag(value, drag, [45, 60]), true);
  assert.deepEqual(value.screenRect, { x: 35, y: 50, width: 100, height: 80 });
});

test('placement resize currently keeps the center fixed and shift preserves aspect ratio', () => {
  const value = { id: 'b', screenRect: { x: 100, y: 100, width: 100, height: 80 }, rotation: 0 };
  const drag = createReferenceImagePlacementDrag(value, { type: 'scale', corner: 'se' }, [200, 180], 2);
  const startCenter = [...drag.center];
  assert.equal(applyReferenceImagePlacementDrag(value, drag, [225, 205], { shiftKey: true }), true);
  assert.equal(value.screenRect.x + value.screenRect.width / 2, startCenter[0]);
  assert.equal(value.screenRect.y + value.screenRect.height / 2, startCenter[1]);
  assert.ok(Math.abs(value.screenRect.width / value.screenRect.height - 1.25) < 1e-9);
});

test('placement rotation snaps to 15 degree increments while shift is held', () => {
  const value = { id: 'c', screenRect: { x: 100, y: 100, width: 100, height: 100 }, rotation: 0 };
  const drag = createReferenceImagePlacementDrag(value, { type: 'rotate' }, [150, 74], 3);
  assert.equal(applyReferenceImagePlacementDrag(value, drag, [250, 150], { shiftKey: true }), true);
  assert.equal(value.rotation, 90);
});
