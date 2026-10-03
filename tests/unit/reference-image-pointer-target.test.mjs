import assert from 'node:assert/strict';
import test from 'node:test';

import { referenceImageEventTargetsMap } from '../../assets/js/modules/reference-image-pointer-target.js';

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
