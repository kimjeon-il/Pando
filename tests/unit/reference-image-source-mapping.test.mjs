import assert from 'node:assert/strict';
import test from 'node:test';

import { referenceImageMappingSignature } from '../../assets/js/modules/reference-image-model.js';
import { buildReferenceImageSourceMapping } from '../../assets/js/modules/reference-image-source-mapping.js';
import { buildReferenceImageMesh } from '../../assets/js/modules/reference-image-georef.js';
import { referenceImagePlacementCoordinateAtUv } from '../../assets/js/modules/reference-image-transform.js';

const quad = [[10, 20], [20, 20], [20, 10], [10, 10]];

function assertPairClose(actual, expected, epsilon = 1e-8) {
  assert.ok(Array.isArray(actual));
  assert.ok(Math.abs(actual[0] - expected[0]) <= epsilon);
  assert.ok(Math.abs(actual[1] - expected[1]) <= epsilon);
}

test('corner-pin-only source mapping falls back to projective placement and respects flips', () => {
  const record = {
    id: 'corner-only',
    mapQuad: quad,
    cornerPinEnabled: true,
    warpMode: 'auto',
    flipX: true,
    flipY: false,
    controlPoints: [],
    anchor: null,
  };
  const mapping = buildReferenceImageSourceMapping(record);
  assert.equal(mapping.ok, true);
  assert.equal(mapping.mode, 'projective');
  assert.equal(mapping.source, 'corner-pin');
  assertPairClose(mapping.project([0, 0]), quad[1]);
  assertPairClose(mapping.project([1, 1]), quad[3]);
});

test('corner-pin analysis keeps prepared mesh identity, flips, bounds and input unchanged', () => {
  for (const flipX of [false, true]) for (const flipY of [false, true]) {
    const record = { mapQuad: quad, cornerPinEnabled: true, controlPoints: [], anchor: null, flipX, flipY };
    const before = structuredClone(record);
    const mapping = buildReferenceImageSourceMapping(record);
    const mesh = buildReferenceImageMesh(mapping, { columns: 3, rows: 2 });
    assert.equal(mesh.vertices.length, 12);
    assert.equal(mesh.triangles.length, 12);
    for (const vertex of mesh.vertices) {
      const expected = referenceImagePlacementCoordinateAtUv(record, vertex.uv);
      assertPairClose(vertex.coordinate, expected);
      assertPairClose(mapping.project(vertex.uv), expected);
    }
    for (const uv of [[-0.01, 0.5], [1.01, 0.5], [0.5, -0.01], [0.5, 1.01], [NaN, 0], null]) {
      assert.equal(mapping.project(uv), null);
    }
    assert.deepEqual(record, before);
    const repeated = buildReferenceImageMesh(mapping, { columns: 3, rows: 2 });
    assert.deepEqual(repeated, mesh);
    assert.notEqual(repeated.vertices, mesh.vertices);
  }
});

test('anchor plus GCP source mapping uses canonical calibration warp', () => {
  const mapping = buildReferenceImageSourceMapping({
    id: 'calibrated',
    mapQuad: quad,
    cornerPinEnabled: false,
    warpMode: 'auto',
    flipX: false,
    flipY: false,
    anchor: { image: [0, 0], coordinate: [10, 20] },
    controlPoints: [{ id: 'gcp', image: [1, 0], coordinate: [20, 20] }],
  });
  assert.equal(mapping.ok, true);
  assert.equal(mapping.mode, 'similarity');
  assertPairClose(mapping.project([0, 0]), [10, 20]);
  assertPairClose(mapping.project([1, 0]), [20, 20]);
});

test('corner pins combined with calibration use TPS rubber-sheet mapping', () => {
  const mapping = buildReferenceImageSourceMapping({
    id: 'rubber',
    mapQuad: quad,
    cornerPinEnabled: true,
    warpMode: 'auto',
    flipX: false,
    flipY: false,
    anchor: { image: [0.5, 0.5], coordinate: [15, 15] },
    controlPoints: [{ id: 'gcp', image: [0.25, 0.25], coordinate: [12.5, 17.5] }],
  });
  assert.equal(mapping.ok, true);
  assert.equal(mapping.mode, 'tps');
  assert.ok(mapping.diagnostics.hardMaxMeters < 0.01);
  assertPairClose(mapping.project([0.5, 0.5]), [15, 15], 1e-7);
});

test('uncalibrated placement without corner pin remains unavailable to analysis tools', () => {
  const mapping = buildReferenceImageSourceMapping({
    id: 'plain',
    mapQuad: quad,
    cornerPinEnabled: false,
    warpMode: 'auto',
    controlPoints: [],
    anchor: null,
  });
  assert.equal(mapping.ok, false);
  assert.equal(mapping.reason, 'insufficient-control-points');
});

test('mapping signature changes only when mapping-relevant fields change', () => {
  const base = {
    id: 'sig',
    name: 'before',
    opacity: 0.4,
    mapQuad: quad,
    cornerPinEnabled: true,
    warpMode: 'auto',
    flipX: false,
    flipY: false,
    controlPoints: [],
    anchor: null,
  };
  const signature = referenceImageMappingSignature(base);
  assert.equal(referenceImageMappingSignature({ ...base, name: 'after', opacity: 0.8 }), signature);
  assert.notEqual(referenceImageMappingSignature({ ...base, flipX: true }), signature);
  assert.notEqual(referenceImageMappingSignature({
    ...base,
    mapQuad: [[10, 20], [21, 20], [20, 10], [10, 10]],
  }), signature);
});
