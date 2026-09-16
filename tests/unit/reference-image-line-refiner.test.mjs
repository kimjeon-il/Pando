import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildReferenceImageGradientField,
  referenceImagePixelsToCoordinates,
  refineReferenceImageLine,
} from '../../assets/js/modules/reference-image-line-refiner.js';

function makeImageData(width, height, pixelValue) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const value = Math.max(0, Math.min(255, Number(pixelValue(x, y)) || 0));
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }
  return { width, height, data };
}

const curvedBoundaryX = y => 31 + 5 * Math.sin(y / 8);

test('A* corridor refinement follows a curved high-contrast boundary', () => {
  const width = 72;
  const height = 68;
  const imageData = makeImageData(width, height, (x, y) => x < curvedBoundaryX(y) ? 28 : 228);
  const field = buildReferenceImageGradientField(imageData, { sourceWidth: width, sourceHeight: height });
  const roughPoints = [];
  for (let y = 5; y <= 62; y += 4) roughPoints.push([curvedBoundaryX(y) + 4, y]);

  const result = refineReferenceImageLine({
    field,
    roughPoints,
    corridorRadius: 8,
    simplifyTolerance: 0.75,
  });

  assert.equal(result.ok, true, result.reason);
  assert.ok(result.points.length >= 4);
  const interior = result.points.slice(1, -1);
  const meanError = interior.reduce((sum, point) => sum + Math.abs(point[0] - curvedBoundaryX(point[1])), 0) / interior.length;
  assert.ok(meanError < 2, `mean boundary error was ${meanError.toFixed(3)} px`);
  assert.ok(result.meanEdgeStrength > 0.15);
});

test('refinement never escapes the requested corridor for a stronger distant edge', () => {
  const width = 80;
  const height = 56;
  const imageData = makeImageData(width, height, x => {
    if (x < 18) return 0;
    if (x < 42) return 255;
    return 120;
  });
  const field = buildReferenceImageGradientField(imageData, { sourceWidth: width, sourceHeight: height });
  const roughPoints = [[43, 5], [43, 18], [43, 34], [43, 50]];

  const result = refineReferenceImageLine({
    field,
    roughPoints,
    corridorRadius: 5,
    simplifyTolerance: 0.5,
  });

  assert.equal(result.ok, true, result.reason);
  assert.ok(result.points.every(point => point[0] >= 38), 'path escaped toward the distant x=18 edge');
  const meanX = result.points.reduce((sum, point) => sum + point[0], 0) / result.points.length;
  assert.ok(Math.abs(meanX - 42) < 2.5, `mean x was ${meanX.toFixed(3)}`);
});

test('flat or unusably blurry imagery returns an explicit failure instead of inventing a line', () => {
  const imageData = makeImageData(48, 48, () => 128);
  const field = buildReferenceImageGradientField(imageData, { sourceWidth: 48, sourceHeight: 48 });
  const result = refineReferenceImageLine({
    field,
    roughPoints: [[8, 8], [24, 24], [40, 40]],
    corridorRadius: 6,
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'insufficient-edge-strength');
});

test('refined source pixels convert back through the existing warp project API', () => {
  const projected = referenceImagePixelsToCoordinates([
    [0, 0],
    [49.5, 24.5],
    [99, 49],
  ], {
    sourceWidth: 100,
    sourceHeight: 50,
    warp: {
      ok: true,
      project: ([u, v]) => [u * 360 - 180, 90 - v * 180],
    },
  });

  assert.deepEqual(projected[0], [-180, 90]);
  assert.deepEqual(projected[1], [0, 0]);
  assert.deepEqual(projected[2], [180, -90]);
});
