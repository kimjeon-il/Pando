import assert from 'node:assert/strict';
import test from 'node:test';
import { referenceImageTilePlan, createReferenceTileAccumulator, validateReferenceBoundaryManifest } from '../../assets/js/modules/reference-image-analysis-tiles.js';

test('overlap blending writes every source pixel once without losing the last short tile', () => {
  const tiles = referenceImageTilePlan(7, 5, { tileSize: 4, overlap: 1 });
  assert.deepEqual(tiles.map(({ x, y }) => [x, y]), [[0, 0], [3, 0], [6, 0], [0, 3], [3, 3], [6, 3]]);
  const accumulator = createReferenceTileAccumulator(7, 5, { tileSize: 4, overlap: 1 });
  const logits = new Float32Array(7 * 4 * 4).fill(-10);
  logits.fill(10, 0, 16);
  let currentY = 0;
  for (const tile of tiles) {
    if (tile.y !== currentY) { accumulator.finishRow(currentY, tile.y); currentY = tile.y; }
    accumulator.add(tile, logits);
  }
  accumulator.finishRow(currentY, 5);
  const result = accumulator.result();
  assert.equal(result.labels.length, 35);
  assert.ok(result.labels.every(value => value === 1));
  assert.ok(result.confidence.every(value => value > .99));
});

test('untrained or unapproved boundary weights are rejected before model loading', () => {
  assert.throws(() => validateReferenceBoundaryManifest({ schemaVersion: 1, releaseApproved: false }), { code: 'PL-REF-MODEL-UNVALIDATED' });
});
