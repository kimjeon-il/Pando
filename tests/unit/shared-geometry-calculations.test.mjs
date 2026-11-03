import '../helpers/spherical-core.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';


import { geometryBounds } from "../../shared/frontend/js/modules/map-edit-geometry.js";
import {
  clippingOperationWithPrecisionRetry,
} from "../../tools/gis/polygon-clipping-calculation.js";

const EMPTY_BOUNDS = [Infinity, Infinity, -Infinity, -Infinity];



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
