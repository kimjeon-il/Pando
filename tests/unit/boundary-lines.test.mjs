import test from 'node:test';
import assert from 'node:assert/strict';
import { connectBoundarySegments } from "../../shared/frontend/js/modules/boundary-lines.js";

test('short reversed segments form a continuous line for dash spacing', () => {
  const lines = connectBoundarySegments([[[0, 0], [1, 0]], [[2, 0], [1, 0]], [[2, 0], [3, 0]]]);
  assert.deepEqual(lines, [[[0, 0], [1, 0], [2, 0], [3, 0]]]);
});
test('junctions and disconnected boundaries stay separate', () => {
  const lines = connectBoundarySegments([[[0, 0], [1, 0]], [[1, 0], [2, 0]], [[1, 0], [1, 1]], [[4, 0], [5, 0]]]);
  assert.equal(lines.length, 4);
  assert.equal(lines.reduce((sum, line) => sum + line.length - 1, 0), 4);
});
test('binary half-grid and signed-zero junctions match the shared C++ rule', () => {
  const lines = connectBoundarySegments([
    [[0.00390625, 0], [1, 0]],
    [[0.0039063, 0], [2, 0]],
  ]);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].length, 3);
  assert.deepEqual(connectBoundarySegments([]), []);
});

test('closed boundaries preserve every segment', () => {
  const lines = connectBoundarySegments([[[0, 0], [1, 0]], [[1, 0], [1, 1]], [[1, 1], [0, 0]]]);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].length, 4);
  assert.deepEqual(lines[0][0], lines[0].at(-1));
});
