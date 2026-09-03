import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildReferenceImageMesh,
  buildReferenceImageWarp,
  REFERENCE_IMAGE_WARP_MODES,
} from '../../assets/js/modules/reference-image-georef.js';

const point = (id, image, coordinate) => ({ id, image, coordinate });

test('similarity warp fits two control points', () => {
  const warp = buildReferenceImageWarp([
    point('a', [0, 0], [10, 20]),
    point('b', [1, 0], [20, 20]),
  ], { mode: REFERENCE_IMAGE_WARP_MODES.SIMILARITY });
  assert.equal(warp.ok, true);
  assert.deepEqual(warp.project([0.5, 0]), [15, 20]);
});

test('affine warp reproduces a skewed plane', () => {
  const controlPoints = [
    point('a', [0, 0], [30, 10]),
    point('b', [1, 0], [40, 12]),
    point('c', [0, 1], [28, 20]),
    point('d', [1, 1], [38, 22]),
  ];
  const warp = buildReferenceImageWarp(controlPoints, { mode: REFERENCE_IMAGE_WARP_MODES.AFFINE });
  assert.equal(warp.ok, true);
  const center = warp.project([0.5, 0.5]);
  assert.ok(Math.abs(center[0] - 34) < 1e-8);
  assert.ok(Math.abs(center[1] - 16) < 1e-8);
});

test('projective warp passes through four corner control points', () => {
  const controlPoints = [
    point('a', [0, 0], [0, 0]),
    point('b', [1, 0], [12, 1]),
    point('c', [1, 1], [10, 10]),
    point('d', [0, 1], [-1, 9]),
  ];
  const warp = buildReferenceImageWarp(controlPoints, { mode: REFERENCE_IMAGE_WARP_MODES.PROJECTIVE });
  assert.equal(warp.ok, true);
  for (const controlPoint of controlPoints) {
    const projected = warp.project(controlPoint.image);
    assert.ok(Math.abs(projected[0] - controlPoint.coordinate[0]) < 1e-7);
    assert.ok(Math.abs(projected[1] - controlPoint.coordinate[1]) < 1e-7);
  }
});

test('TPS warp interpolates its control points and auto selects TPS with six points', () => {
  const controlPoints = [
    point('a', [0, 0], [100, 30]),
    point('b', [1, 0], [110, 31]),
    point('c', [1, 1], [109, 40]),
    point('d', [0, 1], [99, 39]),
    point('e', [0.5, 0.25], [105, 33]),
    point('f', [0.4, 0.7], [103.5, 37.5]),
  ];
  const warp = buildReferenceImageWarp(controlPoints);
  assert.equal(warp.ok, true);
  assert.equal(warp.mode, REFERENCE_IMAGE_WARP_MODES.TPS);
  for (const controlPoint of controlPoints) {
    const projected = warp.project(controlPoint.image);
    assert.ok(Math.abs(projected[0] - controlPoint.coordinate[0]) < 1e-6);
    assert.ok(Math.abs(projected[1] - controlPoint.coordinate[1]) < 1e-6);
  }
});

test('mesh uses geographic coordinates from the solved warp', () => {
  const warp = buildReferenceImageWarp([
    point('a', [0, 0], [10, 20]),
    point('b', [1, 0], [20, 20]),
    point('c', [0, 1], [10, 30]),
  ], { mode: REFERENCE_IMAGE_WARP_MODES.AFFINE });
  const mesh = buildReferenceImageMesh(warp, { columns: 2, rows: 2 });
  assert.equal(mesh.vertices.length, 9);
  assert.equal(mesh.triangles.length, 8);
  assert.deepEqual(mesh.vertices[4].uv, [0.5, 0.5]);
  const coordinate = mesh.vertices[4].coordinate;
  assert.ok(Math.abs(coordinate[0] - 15) < 1e-8);
  assert.ok(Math.abs(coordinate[1] - 25) < 1e-8);
});

test('diagnostics flags control points concentrated in a small image area', () => {
  const warp = buildReferenceImageWarp([
    point('a', [0.1, 0.1], [10, 20]),
    point('b', [0.2, 0.1], [11, 20]),
    point('c', [0.1, 0.2], [10, 21]),
  ], { mode: REFERENCE_IMAGE_WARP_MODES.AFFINE });
  assert.equal(warp.ok, true);
  assert.ok(warp.diagnostics.warnings.includes('control-points-concentrated'));
});
