import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_MAP_GEOMETRY_ERROR_PX,
  resolveScreenLodBucket,
  createSharedPolygonLodIndex,
} from '../../../src/rendering/render-lod.js';

const aToB = [[4, 1], [3.5, 1.01], [3, 1], [2.5, 0.99], [2, 1],
  [1.5, 1.01], [1, 1], [0.5, 0.99], [0, 1]];
const countries = [
  { id: 'west', geometry: { type: 'Polygon', coordinates: [[
    [0, 0], [4, 0], ...aToB, [0, 0],
  ]] } },
  { id: 'east', geometry: { type: 'Polygon', coordinates: [[
    ...[...aToB].reverse(), [0, 2], [4, 2], [4, 1],
  ]] } },
];

function sharedArc(features) {
  const west = features[0].geometry.coordinates[0];
  const east = features[1].geometry.coordinates[0];
  const westFrom = west.findIndex(([x, y]) => x === 4 && y === 1);
  const westTo = west.findIndex(([x, y]) => x === 0 && y === 1);
  const eastTo = east.findIndex(([x, y]) => x === 4 && y === 1);
  return [west.slice(westFrom, westTo + 1), [...east.slice(0, eastTo + 1)].reverse()];
}

function distanceToSegment(point, start, end) {
  const dx = end[0] - start[0], dy = end[1] - start[1];
  const t = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx
    + (point[1] - start[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(point[0] - (start[0] + t * dx), point[1] - (start[1] + t * dy));
}

test('shared boundary uses exactly the same derivative with opposite winding', () => {
  const original = JSON.stringify(countries);
  const index = createSharedPolygonLodIndex(countries);
  const result = index.derive({ cssScale: 120 });
  const [west, east] = sharedArc(result.features);
  assert.deepEqual(west, east);
  assert.ok(index.stats().sharedEdgeCount >= 8);
  assert.ok(result.keptVertices < result.originalVertices);
  assert.equal(result.fallback, false);
  assert.equal(JSON.stringify(countries), original);
});

test('zoomed-in views retain vertices and screen deviation stays below the budget', () => {
  const index = createSharedPolygonLodIndex(countries);
  const scales = [100, 400, 1600, 6400];
  const variants = scales.map(cssScale => index.derive({ cssScale }));
  for (let i = 1; i < variants.length; i += 1)
    assert.ok(variants[i].keptVertices >= variants[i - 1].keptVertices);
  for (const [i, scale] of scales.entries()) {
    const oldRing = countries[0].geometry.coordinates[0];
    const newRing = variants[i].features[0].geometry.coordinates[0];
    for (const point of oldRing) {
      const deviation = Math.min(...newRing.slice(1).map((next, k) =>
        distanceToSegment(point, newRing[k], next)));
      assert.ok(deviation * Math.PI / 180 * scale < MAX_MAP_GEOMETRY_ERROR_PX + 1e-7);
    }
  }
});

test('LOD buckets always bound CSS scale, avoiding visible downgrade jitter', () => {
  const first = resolveScreenLodBucket({ cssScale: 500 });
  assert.ok(first.upperScale >= 500);
  const within = resolveScreenLodBucket({ cssScale: 505, previous: first });
  assert.equal(within.key, first.key);
  const zoomIn = resolveScreenLodBucket({ cssScale: 900, previous: within });
  assert.ok(zoomIn.upperScale >= 900);
  assert.ok(zoomIn.toleranceRadians <= MAX_MAP_GEOMETRY_ERROR_PX / 900);
});

test('selected source keeps all vertices on its neighbor shared boundary', () => {
  const index = createSharedPolygonLodIndex(countries);
  const result = index.derive({ cssScale: 120, protectedIds: ['west'] });
  assert.deepEqual(result.features[0].geometry, countries[0].geometry);
  assert.deepEqual(...sharedArc(result.features));
});

test('hole-bearing and dateline-crossing polygons remain exact and unchanged', () => {
  const withHole = { id: 'hole', geometry: { type: 'Polygon', coordinates: [
    [[0, 0], [3, 0], [3, 1], [3, 3], [0, 3], [0, 0]],
    [[1, 1], [2, 1], [2, 2], [1, 2], [1, 1]],
  ] } };
  const withDateline = { id: 'date', geometry: { type: 'Polygon', coordinates: [[
    [179, 0], [-179, 0], [-179, 2], [179, 2], [179, 0],
  ]] } };
  const result = createSharedPolygonLodIndex([withHole, withDateline])
    .derive({ cssScale: 30 });
  assert.deepEqual(result.features[0].geometry, withHole.geometry);
  assert.deepEqual(result.features[1].geometry, withDateline.geometry);
});

test('invalid scale or unclosed rings cannot become an accepted derivative', () => {
  assert.throws(() => resolveScreenLodBucket({ cssScale: 0 }), TypeError);
  assert.throws(() => createSharedPolygonLodIndex([{
    id: 'invalid', geometry: { type: 'Polygon', coordinates: [[
      [0, 0], [1, 0], [1, 1], [0, 1],
    ]] },
  }]), TypeError);
});
