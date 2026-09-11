import test from 'node:test';
import assert from 'node:assert/strict';
import { scrollbarGeometry, installOverlayScrollbars } from '../../assets/js/modules/overlay-scrollbars.js';

test('overlay thumb represents native scroll range and clamps overscroll', () => {
  assert.deepEqual(scrollbarGeometry(200, 800, 300), { maximum: 600, thumb: 50, travel: 150, top: 75 });
  assert.equal(scrollbarGeometry(200, 800, -20).top, 0);
  assert.equal(scrollbarGeometry(200, 800, 900).top, 150);
});
test('no overflow and tiny viewports do not produce invalid thumb geometry', () => {
  assert.deepEqual(scrollbarGeometry(200, 100, 0), { maximum: 0, thumb: 200, travel: 0, top: 0 });
  assert.equal(scrollbarGeometry(20, 800, 300).thumb, 20);
  assert.equal(scrollbarGeometry(0, 800, 0).travel, 0);
});
test('font-scaled thumb minimum is independent of native scrollbar width', () => {
  assert.equal(scrollbarGeometry(400, 10000, 0, 60).thumb, 60);
  assert.doesNotThrow(() => installOverlayScrollbars({ defaultView: {} })());
});
