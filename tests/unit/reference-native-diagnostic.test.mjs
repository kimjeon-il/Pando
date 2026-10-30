import assert from 'node:assert/strict';
import test from 'node:test';
import { diagnosticPixelStatistics } from '../../tools/reference-analysis/native-evaluation.mjs';

const directory = process.env.PANDO_MAP_EVALUATION_ARTIFACT;
test('diagnostic statistics reject mismatched tensor shapes', async () => {
  await assert.rejects(diagnosticPixelStatistics({width: 2, height: 1, probability: Buffer.alloc(1), target: Buffer.alloc(14), known: Buffer.alloc(14)}), /tensor/i);
});

test('diagnostic statistics count known pixels and preserve probability bounds', {skip: !directory}, async () => {
  const probability = Buffer.alloc(7 * 4 * 4), target = Buffer.alloc(7 * 4), known = Buffer.alloc(7 * 4);
  for (let channel = 0; channel < 7; channel++) {
    for (let index = 0; index < 4; index++) probability.writeFloatLE([0.1, 0.55, 0.8, 0.9][index], (channel * 4 + index) * 4);
    target.set([0, 1, 1, 1], channel * 4);
    known.set([1, 1, 0, 1], channel * 4);
  }
  const rows = await diagnosticPixelStatistics({width: 4, height: 1, probability, target, known}, {directory});
  for (const row of Object.values(rows)) assert.deepEqual(row, {
    supervisedPixels: 3, targetPixels: 2, predictedPixels: 2, overlapPixels: 2,
    probabilityMin: Math.fround(0.1), probabilityMax: Math.fround(0.9),
  });
});
