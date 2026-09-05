import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  countryDrawRangesForFrame,
  createCountryTriangleRangeMap,
  mergeCountryDrawRanges,
} from '../../assets/js/modules/gpu-map-renderer.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function mesh(bounds, flags = bounds.map(() => 0)) {
  const countryCount = bounds.length;
  return {
    triangleIndices: new Uint32Array(countryCount * 6),
    lineIndices: new Uint32Array(countryCount * 4),
    countryTriangleRanges: new Uint32Array(bounds.flatMap((_, index) => [index * 6, 6])),
    countryBoundaryRanges: new Uint32Array(bounds.flatMap((_, index) => [index * 4, 4])),
    countryBounds: new Int32Array(bounds.flatMap(values => values.map(value => Math.round(value * 1e6)))),
    countryBoundsFlags: new Uint32Array(flags),
    metadataCountryIds: bounds.map((_, index) => `C${index}`),
  };
}

function flatFrame({ center = [0, 0], scale = 100, viewport = [200, 100] } = {}) {
  return {
    mode: 1,
    cssViewport: viewport,
    cssTranslate: [viewport[0] / 2, viewport[1] / 2],
    cssScale: scale,
    flatCenter: center.map(value => value * Math.PI / 180),
    worldOffsets: [0],
  };
}

test('country draw culling merges adjacent visible canonical ranges', () => {
  const source = mesh([
    [-20, -5, -10, 5],
    [0, -5, 10, 5],
    [100, -5, 110, 5],
  ]);
  const result = countryDrawRangesForFrame(source, flatFrame(), { paddingPixels: 0 });
  assert.equal(result.culled, true);
  assert.equal(result.visibleCountryCount, 2);
  assert.deepEqual(result.ranges, [{ first: 0, count: 12 }]);
  assert.equal(result.indexCount, 12);
  assert.equal(result.fullIndexCount, 18);
});

test('country draw culling keeps date-line bounds visible around a 180 degree center', () => {
  const source = mesh([
    [179, -5, -179, 5],
    [0, -5, 10, 5],
  ], [1, 0]);
  const result = countryDrawRangesForFrame(source, flatFrame({ center: [180, 0], scale: 300 }), { paddingPixels: 0 });
  assert.equal(result.culled, true);
  assert.equal(result.visibleCountryCount, 1);
  assert.deepEqual(result.ranges, [{ first: 0, count: 6 }]);
});

test('globe culling rejects a country wholly behind the current hemisphere', () => {
  const source = mesh([
    [-5, -5, 5, 5],
    [175, -5, -175, 5],
  ], [0, 1]);
  const result = countryDrawRangesForFrame(source, {
    mode: 0,
    cssViewport: [400, 400],
    cssTranslate: [200, 200],
    cssScale: 100, // The entire globe fits: the rear hemisphere must still be culled.
    rowX: [0, 1, 0],
    rowY: [0, 0, -1],
    rowZ: [1, 0, 0],
    worldOffsets: [0],
  }, { paddingPixels: 0, fullRangeThreshold: 0.1 });
  assert.equal(result.culled, true);
  assert.equal(result.visibleCountryCount, 1);
  assert.deepEqual(result.ranges, [{ first: 0, count: 6 }]);
});

test('world view and legacy meshes retain one full draw range', () => {
  const source = mesh([
    [-20, -5, -10, 5],
    [100, -5, 110, 5],
  ]);
  const world = countryDrawRangesForFrame(source, flatFrame({ scale: 20, viewport: [400, 200] }), { paddingPixels: 0 });
  assert.equal(world.culled, false);
  assert.deepEqual(world.ranges, [{ first: 0, count: 12 }]);

  const legacy = countryDrawRangesForFrame({ triangleIndices: new Uint32Array(9) }, flatFrame());
  assert.equal(legacy.fallback, true);
  assert.deepEqual(legacy.ranges, [{ first: 0, count: 9 }]);
});

test('range merge keeps gaps and combines overlap or adjacency', () => {
  assert.deepEqual(mergeCountryDrawRanges([
    { first: 12, count: 3 },
    { first: 0, count: 6 },
    { first: 6, count: 6 },
    { first: 20, count: 4 },
    { first: 22, count: 4 },
  ]), [
    { first: 0, count: 15 },
    { first: 20, count: 6 },
  ]);
});

test('selection range map is materialized from metadata without reading triangle indices', () => {
  const source = {
    countryTriangleRanges: new Uint32Array([0, 6, 6, 12]),
    metadataCountryIds: ['AAA', 'BBB'],
    get triangleIndices() {
      throw new Error('metadata-backed range creation must not scan triangle indices');
    },
  };
  const ranges = createCountryTriangleRangeMap(source, source.metadataCountryIds);
  assert.deepEqual(ranges.get('AAA'), [{ first: 0, count: 6 }]);
  assert.deepEqual(ranges.get('BBB'), [{ first: 6, count: 12 }]);
});

test('selection interaction hot path performs only precomputed map lookups', () => {
  const source = fs.readFileSync(path.join(projectRoot, 'assets/js/modules/gpu-map-renderer.js'), 'utf8');
  const start = source.indexOf('function drawCountryInteractionFills()');
  const end = source.indexOf('function drawInteractionPasses', start);
  assert.ok(start >= 0 && end > start);
  const interactionSource = source.slice(start, end);
  assert.match(interactionSource, /triangleRangesByCountryId\?\.get\(id\)/);
  assert.doesNotMatch(interactionSource, /countryTriangleRanges|createCountryTriangleRangeMap|for\s*\(/);
});
