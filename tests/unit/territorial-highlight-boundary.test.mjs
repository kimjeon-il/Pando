import test from 'node:test';
import assert from 'node:assert/strict';
import { excludeAncestorHighlightBoundary } from '../../assets/js/modules/territorial-highlight-boundary.js';

const polygon = coordinates => ({ type: 'Polygon', coordinates: [coordinates] });
const length = feature => feature.geometry.coordinates.reduce((total, line) => total + line.slice(1).reduce((sum, point, index) => sum + Math.hypot(point[0] - line[index][0], point[1] - line[index][1]), 0), 0);
const parent = polygon([[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]]);
const child = polygon([[0, 0], [2, 0], [2, 4], [0, 4], [0, 0]]);

test('child keeps its internal edge while its highlighted country supplies the outer edge', () => {
  const result = excludeAncestorHighlightBoundary(child, [parent]);
  assert.equal(length(result), 4);
  assert.ok(result.geometry.coordinates.every(line => line.every(point => point[0] === 2)));
  assert.equal(length(excludeAncestorHighlightBoundary(child, [])), 12);
});
test('partial reversed and subdivided overlaps are removed without losing unrelated edges', () => {
  const line = { type: 'LineString', coordinates: [[0, 0], [4, 0]] };
  const ancestor = { type: 'MultiLineString', coordinates: [[[2, 0], [1, 0]], [[3, 0], [2, 0]]] };
  const result = excludeAncestorHighlightBoundary(line, [ancestor]);
  assert.equal(length(result), 2);
  assert.equal(result.geometry.coordinates.length, 2);
});
test('near-coincident shared lines are suppressed but nearby distinct boundaries remain', () => {
  const line = { type: 'LineString', coordinates: [[0, 0], [2, 0]] };
  assert.equal(length(excludeAncestorHighlightBoundary(line, [{ type: 'LineString', coordinates: [[0, 0.00001], [2, 0.00001]] }])), 0);
  assert.equal(length(excludeAncestorHighlightBoundary(line, [{ type: 'LineString', coordinates: [[0, 0.01], [2, 0.01]] }])), 2);
});
