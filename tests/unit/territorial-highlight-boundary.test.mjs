import test from 'node:test';
import assert from 'node:assert/strict';
import { excludeAncestorHighlightBoundary } from "../../shared/frontend/js/modules/territorial-highlight-boundary.js";
import { createMapDisplayPreparation } from "../../shared/frontend/js/modules/map-display-preparation.js";

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

test('highlight preparation removes the same parent perimeter for wrapped and continuous dateline coordinates', async () => {
  const child = polygon([[179, 0], [179, 1], [179.5, 1], [179.5, 0], [179, 0]]);
  for (const east of [-179, 181]) {
    const parent = { type: 'Feature', properties: {}, geometry: polygon([[179, 0], [179, 1], [east, 1], [east, 0], [179, 0]]) };
    const before = structuredClone([child, parent]);
    const { feature: result } = await createMapDisplayPreparation().prepare({
      kind: 'highlight', feature: child, occluders: [{feature:parent}],
    }, [], []);
    assert.equal(length(result), 1, `parent east ${east}`);
    assert.ok(result.geometry.coordinates.every(line => line.every(point => point[0] === 179.5)));
    assert.deepEqual([child, parent], before);
  }
});

test('partial overlaps across the dateline leave only two short non-overlapping segments', () => {
  const line = { type: 'LineString', coordinates: [[179, 0], [-179, 0]] };
  const ancestor = { type: 'MultiLineString', coordinates: [
    [[-179.5, 0], [-180, 0]], [[180, 0], [179.5, 0]],
  ] };
  const result = excludeAncestorHighlightBoundary(line, [ancestor]);
  assert.equal(length(result), 1);
  assert.equal(result.geometry.coordinates.length, 2);
  assert.deepEqual(result.geometry.coordinates.map(line => [line[0], line.at(-1)]),
    [[[179, 0], [179.5, 0]], [[-179.5, 0], [-179, 0]]]);
  assert.ok(result.geometry.coordinates.every(line => line.length > 2),
    'the selected coastline must use refined fill-compatible intervals');
});

test('polar and seam closure edges never become selection highlight strokes', () => {
  const cap = polygon([[-180, 80], [-90, 80], [0, 80], [90, 80], [180, 80], [180, 90], [-180, 90], [-180, 80]]);
  const result = excludeAncestorHighlightBoundary(cap, []);
  assert.equal(length(result), 360);
  assert.ok(result.geometry.coordinates.every(line => line.every(point => point[1] === 80)));
  assert.equal(length(excludeAncestorHighlightBoundary(cap, [cap])), 0);
});
