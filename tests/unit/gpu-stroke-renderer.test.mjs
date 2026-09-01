import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildGpuStrokeInstances,
  GPU_STROKE_LAYOUT,
  resolveGpuStrokeRanges,
} from '../../assets/js/modules/gpu-stroke-renderer.js';

test('instanced stroke geometry keeps finite non-degenerate segments only', () => {
  const result = buildGpuStrokeInstances(new Float32Array([
    0, 0, 1, 0,
    1, 0, 1, 0,
    Number.NaN, 0, 2, 0,
    2, 0, 3, 1,
  ]));
  assert.equal(GPU_STROKE_LAYOUT.floatsPerInstance, 5);
  assert.equal(GPU_STROKE_LAYOUT.verticesPerSegment, 6);
  assert.equal(result.segmentCount, 2);
  assert.equal(result.invalidSegmentCount, 2);
  assert.equal(result.instances.length, result.segmentCount * GPU_STROKE_LAYOUT.floatsPerInstance);
  assert.equal([...result.instances].every(Number.isFinite), true);
});

test('owner ranges remain compact after invalid country boundary segments are removed', () => {
  const result = buildGpuStrokeInstances(new Float32Array([
    0, 0, 1, 0,
    1, 0, 1, 0,
    10, 0, 11, 0,
  ]), null, {
    DEU: { first: 0, count: 2 },
    FRA: { first: 2, count: 1 },
  });
  assert.deepEqual(result.ownerRanges, {
    DEU: { first: 0, count: 1 },
    FRA: { first: 1, count: 1 },
  });
});

test('explicit chain phases survive the shared stroke packet conversion', () => {
  const result = buildGpuStrokeInstances(new Float32Array([
    0, 0, 1, 0,
    1, 0, 2, 0,
  ]), new Float32Array([12, 28]));
  assert.equal(result.instances[4], 12);
  assert.equal(result.instances[9], 28);
});

test('owner-filtered drawing resolves only finite non-empty ranges inside the uploaded buffer', () => {
  const resource = {
    instanceCount: 5,
    ownerRanges: {
      DEU: { first: 0, count: 2 },
      FRA: { first: 2, count: 99 },
      EMPTY: { first: 4, count: 0 },
      OUTSIDE: { first: 8, count: 1 },
    },
  };
  assert.deepEqual(resolveGpuStrokeRanges(resource, ['DEU', 'DEU', 'FRA', 'EMPTY', 'OUTSIDE', 'MISSING']), [
    { first: 0, count: 2 },
    { first: 2, count: 3 },
  ]);
  assert.deepEqual(resolveGpuStrokeRanges(resource, ['MISSING']), []);
  assert.deepEqual(resolveGpuStrokeRanges(resource), [{ first: 0, count: 5 }]);
});
