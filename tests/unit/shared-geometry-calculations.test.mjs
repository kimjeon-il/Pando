import '../helpers/spherical-core.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';

import { createCutGeometry } from "../../apps/editor/frontend/js/modules/app-cut-geometry.js";
import { geometryBounds } from "../../shared/frontend/js/modules/map-edit-geometry.js";
import {
  clippingOperationWithPrecisionRetry,
} from "../../apps/editor/frontend/js/modules/polygon-clipping-calculation.js";

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

test('shared clipping retry entry preserves precision, input and empty results', () => {
  const input = [[[[0.1234567896, 1.9876543214], [2, 1], [3, 4], [0.1234567896, 1.9876543214]]]];
  const before = structuredClone(input);
  const actual = clippingOperationWithPrecisionRetry('intersection', input, input);
  assert.equal(actual.length, 1);
  assert.ok(actual[0][0].some(point => point[0] === input[0][0][0][0] && point[1] === input[0][0][0][1]));
  assert.deepEqual(clippingOperationWithPrecisionRetry('intersection', input, []), []);
  assert.deepEqual(input, before);
});

test('shared clipping retry entry propagates technical input errors', () => {
  assert.throws(() => clippingOperationWithPrecisionRetry('invalid', []), error =>
    error instanceof Error && error.code === 'PL-GEOMETRY-CALCULATION' && /Invalid polygon operation/.test(error.message));
  assert.throws(() => clippingOperationWithPrecisionRetry('union', [[[[NaN, 0], [1, 1], [0, 1]]]]), error =>
    error instanceof Error && /coordinate/i.test(error.message));
});
