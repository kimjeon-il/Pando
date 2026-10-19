import assert from 'node:assert/strict';
import test from 'node:test';

import { referenceImageEventTargetsMap, createReferenceImageTouchTracker } from '../../assets/js/modules/reference-image-pointer-target.js';

function mapElement() {
  return {
    getBoundingClientRect: () => ({ left: 100, top: 50, right: 900, bottom: 650 }),
  };
}

test('map pointer targeting accepts overlay-layer descendants inside the map bounds', () => {
  const target = {
    closest(selector) {
      return selector.includes('.reference-image-panel') ? null : null;
    },
  };
  assert.equal(referenceImageEventTargetsMap({
    clientX: 400,
    clientY: 300,
    target,
  }, mapElement()), true);
});

test('map pointer targeting rejects reference-image panel controls even inside map bounds', () => {
  const target = {
    closest(selector) {
      return selector.includes('.reference-image-panel') ? { className: 'reference-image-panel' } : null;
    },
  };
  assert.equal(referenceImageEventTargetsMap({
    clientX: 400,
    clientY: 300,
    target,
  }, mapElement()), false);
});

test('map pointer targeting rejects coordinates outside the visible map rectangle', () => {
  const target = { closest: () => null };
  assert.equal(referenceImageEventTargetsMap({ clientX: 99, clientY: 300, target }, mapElement()), false);
  assert.equal(referenceImageEventTargetsMap({ clientX: 400, clientY: 651, target }, mapElement()), false);
});

test('a second tracing touch promotes pinch and keeps suppressing release commits until all fingers lift', () => {
  const tracker = createReferenceImageTouchTracker();
  const first = { pointerType: 'touch', pointerId: 1 };
  const second = { pointerType: 'touch', pointerId: 2 };
  assert.equal(tracker.begin(first), false);
  assert.equal(tracker.begin(second), true);
  assert.equal(tracker.pinching, true);
  assert.equal(tracker.end(second), true);
  assert.equal(tracker.pinching, true);
  assert.equal(tracker.end(first), true);
  assert.equal(tracker.pinching, false);
  assert.equal(tracker.begin(first), false);
  assert.equal(tracker.end(first), false);
  tracker.reset();
  assert.equal(tracker.pinching, false);
});
