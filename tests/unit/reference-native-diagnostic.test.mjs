import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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
  probability.writeFloatLE(NaN, 0);
  await assert.rejects(diagnosticPixelStatistics({width: 4, height: 1, probability, target, known}, {directory}), /non-finite/i);
});

test('diagnostic stream returns the native result and rejects truncated input', {skip: !directory}, () => {
  const header=Buffer.alloc(16);header.write('PDIAG001');header.writeUInt32BE(1,8);header.writeUInt32BE(1,12);
  const probability=Buffer.alloc(28);for(let c=0;c<7;c++)probability.writeFloatLE(0.75,c*4);
  const input=Buffer.concat([header,probability,Buffer.alloc(7,1),Buffer.alloc(7,1)]);
  const args=['tools/reference-analysis/native-evaluation.mjs','--diagnostic-stream'];
  const run=spawnSync(process.execPath,args,{input,encoding:'utf8',env:{...process.env,PANDO_MAP_EVALUATION_ARTIFACT:directory}});
  assert.equal(run.status,0,run.stderr);assert.equal(JSON.parse(run.stdout).coast.overlapPixels,1);
  const bad=spawnSync(process.execPath,args,{input:header,encoding:'utf8'});
  assert.notEqual(bad.status,0);assert.match(bad.stderr,/length/i);
});
