import test from 'node:test';
import assert from 'node:assert/strict';
import { retainedLabelAnchors } from '../../tools/publication-label-anchors.mjs';

const square = x => ({ type: 'Polygon', coordinates: [[[x, 0], [x + 1, 0], [x + 1, 1], [x, 1], [x, 0]]] });
test('publication retains only label anchors for countries whose geometry is unchanged', () => {
  const before = { features: [{ id: 'A', geometry: square(0) }, { id: 'B', geometry: square(2) }] };
  const after = { features: [{ id: 'A', geometry: square(0) }, { id: 'B', geometry: square(3) }] };
  const anchors = { version: '0.10.1', anchors: { A: [0.5, 0.5], B: [2.5, 0.5] } };
  assert.deepEqual(retainedLabelAnchors({ before, after, anchors }).anchors, { A: [0.5, 0.5] });
});
