import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {nativeTrainingCheckpointInfer} from '../../tools/reference-analysis/native-training-validation.mjs';

const available=Boolean(process.env.PANDO_REFERENCE_INFER_FIXTURE&&process.env.PANDO_REFERENCE_BATCH_DIRECTORY&&process.env.PANDO_REFERENCE_TORCH_LIBRARY);
test('native checkpoint inference matches the source model output', {skip:!available},async t=>{
  const folder=mkdtempSync(join(tmpdir(),'pando-checkpoint-infer-'));t.after(()=>rmSync(folder,{recursive:true}));
  execFileSync(process.env.PANDO_REFERENCE_INFER_FIXTURE,[folder],{stdio:'pipe',windowsHide:true,timeout:180000});
  const checkpoint=join(folder,'checkpoint.pt'),bytes=readFileSync(checkpoint),checkpointSha256=createHash('sha256').update(bytes).digest('hex');
  writeFileSync(checkpoint+'.receipt.json',JSON.stringify({schemaVersion:1,trainingOnly:true,releaseApproved:false,device:'cpu',checkpointSha256}));
  const inputs={tile:readFileSync(join(folder,'tile.f32')),overview:readFileSync(join(folder,'overview.f32')),position:readFileSync(join(folder,'position.f32'))};
  const options={checkpoint,...inputs,device:'cpu',torchLibrary:process.env.PANDO_REFERENCE_TORCH_LIBRARY,directory:process.env.PANDO_REFERENCE_BATCH_DIRECTORY};
  const result=await nativeTrainingCheckpointInfer(options),expected=readFileSync(join(folder,'expected.f32'));
  assert.equal(result.logits.length,7*512*512*4);assert.equal(expected.length,result.logits.length);
  let maximum=0;for(let i=0;i<expected.length;i+=4)maximum=Math.max(maximum,Math.abs(expected.readFloatLE(i)-result.logits.readFloatLE(i)));
  assert.ok(maximum<=1e-6,`checkpoint inference error ${maximum}`);assert.equal(result.checkpointSha256,checkpointSha256);
  await assert.rejects(nativeTrainingCheckpointInfer({...options,tile:Buffer.alloc(1)}),/tensor/i);
  const badPosition=Buffer.from(inputs.position);badPosition.writeFloatLE(Number.NaN,0);
  await assert.rejects(nativeTrainingCheckpointInfer({...options,position:badPosition}),/nonfinite/i);
  writeFileSync(checkpoint+'.receipt.json',JSON.stringify({schemaVersion:1,trainingOnly:true,releaseApproved:false,device:'cpu',checkpointSha256:'0'.repeat(64)}));
  await assert.rejects(nativeTrainingCheckpointInfer(options),/receipt/i);
});
