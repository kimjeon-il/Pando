import '../helpers/spherical-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRenderableBoundarySegments, forEachRenderableBoundarySegment,
} from "../../shared/frontend/js/modules/geographic-boundary.js";
import { prepareBoundaryFeature } from "../../shared/frontend/js/modules/boundary-topology.js";

const cases = [
  ['closed polygon', { type: 'Polygon', coordinates: [[[0,0],[2,0],[2,2],[0,2],[0,0]]] }],
  ['unclosed polygon', { type: 'Polygon', coordinates: [[[0,0],[2,0],[2,2],[0,2]]] }],
  ['antimeridian split', { type: 'Polygon', coordinates: [[[179,5],[-179,5],[-179,6],[179,6],[179,5]]] }],
  ['nested hole', { type: 'Polygon', coordinates: [
    [[0,0],[5,0],[5,5],[0,5],[0,0]],
    [[1,1],[1,2],[2,2],[2,1],[1,1]],
  ] }],
  ['multipolygon with islands', { type: 'MultiPolygon', coordinates: [
    [[[0,0],[1,0],[1,1],[0,0]]],
    [[[179,4],[-179,4],[-179,5],[179,4]]],
  ] }],
  ['artificial polar cap', { type: 'Polygon', coordinates: [[[0,85],[0,90],[180,90],[180,85],[0,85]]] }],
  ['date-line seam', { type: 'LineString', coordinates: [[-180,0],[180,8],[179,8],[179,0]] }],
  ['multilinestring', { type: 'MultiLineString', coordinates: [
    [[0,0],[1,1],[2,1]], [[-179,5],[179,5]],
  ] }],
  ['geometry collection', { type: 'GeometryCollection', geometries: [
    { type: 'LineString', coordinates: [[0,0],[1,1]] },
    { type: 'Polygon', coordinates: [[[3,3],[4,3],[4,4],[3,3]]] },
  ] }],
  ['empty and invalid', { type: 'Polygon', coordinates: [
    [], [[2,2]], [[0,0],[null,1],[1,0],[0,0]],
  ] }],
];

test('streamed geographical segments preserve the array source for all seam, pole and ring cases', () => {
  for (const [name, geometry] of cases) {
    const original = structuredClone(geometry);
    const expected = buildRenderableBoundarySegments(geometry);
    const actual = [];
    forEachRenderableBoundarySegment(geometry, segment => { actual.push(segment); });
    assert.deepEqual(actual, expected, name);
    assert.deepEqual(geometry, original, 'visitor mutated the source: ' + name);
    const replay = [];
    forEachRenderableBoundarySegment({ type: 'Feature', geometry }, segment => replay.push(segment));
    assert.deepEqual(replay, expected, 'Feature wrapper differs: ' + name);
  }
});

test('prepared source geometry retains no eager expanded display-segment array', () => {
  // The visitor accepts partially drawn geometry; the C++ preparation path
  // intentionally rejects unclosed/invalid rings, so test it with valid source.
  for (const [name, geometry] of cases.filter(([name, row]) =>
    (row.type === 'Polygon' || row.type === 'MultiPolygon')
      && name !== 'unclosed polygon' && name !== 'empty and invalid')) {
    const feature = { id: name, geometry };
    const prepared = prepareBoundaryFeature(feature);
    assert.strictEqual(prepared.geometry, geometry);
    assert.equal(Object.hasOwn(prepared, 'renderableSegments'), false, 'display segments should not be retained: ' + name);
    assert.ok(prepared.segments.length > 0, 'source segments must be indexed: ' + name);
  }
});

test('stream visit covers collections and supports early visitor rejection without cache pollution', () => {
  const collection = { type: 'FeatureCollection', features: cases.slice(0, 5).map(([, geometry], i) => ({
    type: 'Feature', id: String(i), geometry,
  })) };
  const before = structuredClone(collection), results = [];
  forEachRenderableBoundarySegment(collection, segment => results.push(segment));
  assert.deepEqual(results, buildRenderableBoundarySegments(collection));
  assert.deepEqual(collection, before);
  assert.throws(() => forEachRenderableBoundarySegment(collection, null), TypeError);
  assert.throws(() => forEachRenderableBoundarySegment(collection, () => { throw new Error('cancelled'); }),
    /cancelled/);
});
