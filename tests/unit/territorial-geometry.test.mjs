import test from 'node:test';
import assert from 'node:assert/strict';
import { snapLineEndpointsToBoundary } from '../../assets/js/modules/territorial-geometry.js';








test('cut-line endpoint snapping uses screen distance and preserves intermediate points', () => {
  const geometry = {
    type: 'Polygon',
    coordinates: [
      [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
      [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]],
    ],
  };
  const result = snapLineEndpointsToBoundary([
    [0.8, 5],
    [5, 7],
    [9.2, 5],
  ], geometry, {
    project: ([x, y]) => [x * 10, y * 10],
    maxDistance: 10,
  });

  assert.deepEqual(result.line, [[0, 5], [5, 7], [10, 5]]);
  assert.equal(result.snaps.start.distance, 8);
  assert.equal(result.snaps.end.distance, 8);
});

test('cut-line endpoint snapping ignores holes and points outside the pixel tolerance', () => {
  const geometry = {
    type: 'Polygon',
    coordinates: [
      [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
      [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]],
    ],
  };
  const result = snapLineEndpointsToBoundary([[4.2, 5], [12, 5]], geometry, {
    project: coordinate => coordinate,
    maxDistance: 1,
  });

  assert.deepEqual(result.line, [[4.2, 5], [12, 5]]);
  assert.equal(result.snaps.start, null);
  assert.equal(result.snaps.end, null);
});
