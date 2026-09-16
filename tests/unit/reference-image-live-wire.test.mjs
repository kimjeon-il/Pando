import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildReferenceImageLiveWireField,
  snapLiveWireAnchor,
  buildLiveWireTree,
  traceLiveWirePath,
  simplifyLiveWireSegments,
  analysisPointFromUv,
  sourcePixelsFromAnalysis,
} from '../../assets/js/modules/reference-image-live-wire.js';

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

const curvedBoundaryX = y => 34 + 7 * Math.sin(y / 10);

test('live-wire Sobel field keeps signed direction components', () => {
  const field = buildReferenceImageLiveWireField(makeImageData(48, 40, x => x < 24 ? 0 : 255));
  assert.equal(field.gradientX.length, 48 * 40);
  assert.equal(field.gradientY.length, 48 * 40);
  const index = 20 * 48 + 23;
  assert.ok(Math.abs(field.gradientX[index]) > 0.2);
  assert.ok(Math.abs(field.gradientY[index]) < 0.05);
});

test('anchor snaps onto a nearby strong boundary', () => {
  const field = buildReferenceImageLiveWireField(makeImageData(64, 48, x => x < 31 ? 10 : 240));
  const snapped = snapLiveWireAnchor(field, [35, 24], { radius: 8 });
  assert.ok(Math.abs(snapped[0] - 30.5) <= 2, `snapped x=${snapped[0]}`);
});

test('local Dijkstra follows a curved high-contrast boundary', () => {
  const width = 80;
  const height = 72;
  const field = buildReferenceImageLiveWireField(makeImageData(width, height, (x, y) => x < curvedBoundaryX(y) ? 24 : 232));
  const anchor = snapLiveWireAnchor(field, [curvedBoundaryX(6) + 2, 6], { radius: 6 });
  const target = [curvedBoundaryX(66) - 2, 66];
  const tree = buildLiveWireTree(field, anchor, { target, searchRadius: 18 });
  const result = traceLiveWirePath(tree, target, { snapRadius: 6 });
  assert.equal(result.ok, true, result.reason);
  assert.ok(result.points.length > 30);
  const sample = result.points.filter((_, index) => index % 6 === 0);
  const meanError = sample.reduce((sum, point) => sum + Math.abs(point[0] - curvedBoundaryX(point[1])), 0) / sample.length;
  assert.ok(meanError < 2.5, `mean error ${meanError}`);
});

test('weak cursor corridor keeps the path on the intended branch', () => {
  const width = 96;
  const height = 72;
  const image = makeImageData(width, height, (x, y) => {
    const main = Math.abs(x - 44) <= 1;
    const branch = y > 32 && Math.abs(x - (44 + (y - 32) * 0.7)) <= 1;
    return main || branch ? 250 : 20;
  });
  const field = buildReferenceImageLiveWireField(image);
  const anchor = snapLiveWireAnchor(field, [44, 8], { radius: 5 });
  const target = [72, 66];
  const tree = buildLiveWireTree(field, anchor, { target, searchRadius: 24, corridorWeight: 0.12 });
  const result = traceLiveWirePath(tree, target, { snapRadius: 8 });
  assert.equal(result.ok, true, result.reason);
  assert.ok(result.points.at(-1)[0] > 64, `ended at ${result.points.at(-1)}`);
});

test('flat imagery is rejected explicitly', () => {
  const field = buildReferenceImageLiveWireField(makeImageData(40, 40, () => 128));
  const tree = buildLiveWireTree(field, [8, 8], { target: [30, 30] });
  assert.equal(tree.ok, false);
  assert.equal(tree.reason, 'insufficient-edge-strength');
});

test('segment simplification preserves committed anchors', () => {
  const segments = [
    [[0, 0], [1, 0.1], [2, 0], [3, 0]],
    [[3, 0], [4, 0.2], [5, 0], [6, 0]],
  ];
  const points = simplifyLiveWireSegments(segments, { tolerance: 1 });
  assert.deepEqual(points[0], [0, 0]);
  assert.ok(points.some(point => point[0] === 3 && point[1] === 0));
  assert.deepEqual(points.at(-1), [6, 0]);
});

test('UV/analysis/source conversions preserve endpoints', () => {
  const field = { width: 101, height: 51, sourceWidth: 1001, sourceHeight: 501, scaleX: 0.1, scaleY: 0.1 };
  assert.deepEqual(analysisPointFromUv(field, [0.5, 0.5]), [50, 25]);
  assert.deepEqual(sourcePixelsFromAnalysis(field, [[0, 0], [100, 50]]), [[0, 0], [1000, 500]]);
});
