import assert from 'node:assert/strict';
import test from 'node:test';

import { createCutGeometry } from '../../assets/js/modules/app-cut-geometry.js';
import { geometryBounds } from '../../assets/js/modules/map-edit-geometry.js';
import {
  clippingOperationWithPrecisionRetry,
  quantizePolygonCoordinates,
} from '../../assets/js/modules/polygon-clipping-calculation.js';

const EMPTY_BOUNDS = [Infinity, Infinity, -Infinity, -Infinity];

test('main cut geometry and map-edit bounds share exact normal, empty, malformed, precision and date-line behavior', () => {
  const main = createCutGeometry();
  const fixtures = [
    {
      name: 'normal',
      coordinates: [[[1, 2], [3, 4], [1, 2]]],
      expected: [1, 2, 3, 4],
    },
    {
      name: 'empty',
      coordinates: [],
      expected: EMPTY_BOUNDS,
    },
    {
      name: 'invalid values are ignored',
      coordinates: [[['not-a-number', 5], [7, Number.NaN]]],
      expected: EMPTY_BOUNDS,
    },
    {
      name: 'nested scalar arrays are not coordinates',
      coordinates: [[0], [1]],
      expected: EMPTY_BOUNDS,
    },
    {
      name: 'precision is preserved',
      coordinates: [[[1.123456789123, -2.987654321987], [1.123456789124, -2.987654321986]]],
      expected: [1.123456789123, -2.987654321987, 1.123456789124, -2.987654321986],
    },
    {
      name: 'date line remains an ordinary raw-coordinate extent',
      coordinates: [[[179.75, -1], [-179.5, 2]]],
      expected: [-179.5, -1, 179.75, 2],
    },
  ];

  for (const fixture of fixtures) {
    assert.deepEqual(main.coordinateBounds(fixture.coordinates), fixture.expected, `${fixture.name}: main`);
    assert.deepEqual(geometryBounds({ type: 'MultiPolygon', coordinates: fixture.coordinates }), fixture.expected, `${fixture.name}: map edit`);
  }
});

test('shared clipping retries only known sweep failures with quantized, non-mutating inputs', () => {
  const input = [[[[0.1234567896, 1.9876543214], [2, 1], [0.1234567896, 1.9876543214]]]];
  const snapshot = structuredClone(input);
  const calls = [];
  const originalError = new Error('Unable to find segment #1 in SweepLine tree.');
  const clipper = {
    intersection(value) {
      calls.push(structuredClone(value));
      if (calls.length < 3) throw calls.length === 1 ? originalError : new Error('SweepLine tree invariant');
      return value;
    },
  };

  const result = clippingOperationWithPrecisionRetry(clipper, 'intersection', input);
  assert.deepEqual(result, quantizePolygonCoordinates(input, 8));
  assert.deepEqual(calls, [input, quantizePolygonCoordinates(input, 9), quantizePolygonCoordinates(input, 8)]);
  assert.deepEqual(input, snapshot);
});

test('shared clipping immediately rethrows unrelated errors and preserves the original error after retry exhaustion', () => {
  const unrelated = new Error('bad method input');
  let unrelatedCalls = 0;
  assert.throws(() => clippingOperationWithPrecisionRetry({
    union() {
      unrelatedCalls += 1;
      throw unrelated;
    },
  }, 'union', []), error => error === unrelated);
  assert.equal(unrelatedCalls, 1);

  const original = new Error('Unable to find segment in SweepLine tree');
  let retryCalls = 0;
  assert.throws(() => clippingOperationWithPrecisionRetry({
    difference() {
      retryCalls += 1;
      throw retryCalls === 1 ? original : new Error('SweepLine tree still invalid');
    },
  }, 'difference', [], []), error => error === original);
  assert.equal(retryCalls, 5);
});
