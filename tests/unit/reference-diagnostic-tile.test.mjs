import assert from 'node:assert/strict';
import test from 'node:test';
import {summarizeDiagnosticTile} from '../../tools/reference-analysis/native-diagnostic-preview.mjs';

test('diagnostic tile joins native probabilities, known masks, statistics and overlays',async()=>{
  const width=4,height=1,values=width*height*7,original=Buffer.alloc(width*height*3,255);
  const probability=Buffer.alloc(values*4),target=Buffer.alloc(values*4),valid=Buffer.alloc(values*4),baseline=Buffer.alloc(values*4);
  probability.writeFloatLE(.55,4);probability.writeFloatLE(.9,12);
  target.writeFloatLE(1,4);target.writeFloatLE(1,8);
  valid.writeFloatLE(1,4);valid.writeFloatLE(1,12);
  const options={width,height,original,probability,target,valid,baseline};
  const result=await summarizeDiagnosticTile(options);
  assert.deepEqual(result.channels.international,{supervisedPixels:2,targetPixels:1,predictedPixels:2,overlapPixels:1,
    probabilityMin:0,probabilityMax:Math.fround(.9)});
  assert.equal(result.baselineChannels.international.predictedPixels,0);
  assert.equal(result.panels.length,3);
  assert.deepEqual([...result.panels[0].subarray(3,6)],[243,67,67]);
  assert.deepEqual([...result.panels[1].subarray(3,6)],[255,255,255]);
  assert.deepEqual([...result.panels[2].subarray(9,12)],[243,67,67]);
  assert.equal(result.independentEvaluation,false);assert.equal(result.releaseApproved,false);
  await assert.rejects(summarizeDiagnosticTile({...options,target:Buffer.alloc(1)}),/dimensions/i);
  const bad=Buffer.from(probability);bad.writeFloatLE(NaN,0);
  await assert.rejects(summarizeDiagnosticTile({...options,probability:bad}),/invalid tensor/i);
});
