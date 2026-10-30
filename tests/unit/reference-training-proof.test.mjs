import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {nativeTrainingProof} from '../../tools/reference-analysis/native-training-proof.mjs';

test('training proof refuses incomplete requests and existing checkpoints',t=>{
  const binary=process.env.PANDO_REFERENCE_TRAINING_PROOF_BINARY;assert(binary,'Native proof executable required');
  const directory=mkdtempSync(join(tmpdir(),'pando-resume-refusal-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const checkpoint=join(directory,'keep.pt');writeFileSync(checkpoint,'preserve checkpoint');
  for(const [args,message] of [[[],/Usage/],[['cpu','weights','tile','overview','position','target','valid',checkpoint,'8'],/already exists/]]){
    const result=spawnSync(binary,args,{encoding:'utf8',timeout:15000});assert.equal(result.error,undefined);assert.equal(result.status,1);assert.match(result.stderr,message);
  }
  assert.equal(readFileSync(checkpoint,'utf8'),'preserve checkpoint');
});
test('training proof rejects modified input tensors or private warm-start weights',{skip:process.platform!=='win32'},async t=>{
  const root=mkdtempSync(join(tmpdir(),'pando-resume-hashes-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const sample=join(root,'sample'),weights=join(root,'weights.safetensors'),checkpoint=join(root,'new.pt');mkdirSync(sample);
  const hash=value=>createHash('sha256').update(value).digest('hex'),names=['tile','overview','position','target','valid'];
  const receipt={trainingOnly:true,releaseApproved:false,sourceId:'synthetic',tileIndex:1,positiveInternationalPixels:1,knownInternationalPixels:1,
    sourceKind:'macro-pdf',augmentationIndex:1,sourceEvidenceSha256:'a'.repeat(64),imageSha256:'b'.repeat(64),annotationSha256:'c'.repeat(64),maskSha256:'d'.repeat(64),validMaskSha256:'e'.repeat(64),tensorSha256:{}};
  for(const name of names){writeFileSync(join(sample,name+'.f32'),name);receipt.tensorSha256[name]=hash(name);}
  writeFileSync(join(sample,'sample.json'),JSON.stringify(receipt));writeFileSync(weights,'weights');
  writeFileSync(join(root,'transfer.json'),JSON.stringify({trainingOnly:true,evaluationStatus:'pending',releaseApproved:false,transfer:'weights-only-no-optimizer',weightsSha256:hash('weights')}));
  const request={weights,sample,checkpoint,torchLibrary:root};writeFileSync(join(sample,'target.f32'),'changed');
  await assert.rejects(nativeTrainingProof(request),/tensor changed/);assert.equal(existsSync(checkpoint),false);
  writeFileSync(join(sample,'target.f32'),'target');writeFileSync(weights,'changed');
  await assert.rejects(nativeTrainingProof(request),/warm-start weights/);assert.equal(existsSync(checkpoint),false);
});
