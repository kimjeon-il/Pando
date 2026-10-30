import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {nativeCheckpointOnnxExport,nativeOnnxDiagnostic,nativeOnnxExport} from '../../tools/reference-analysis/native-onnx-export.mjs';

test('native exporter refuses missing arguments and existing output',{skip:!process.env.PANDO_REFERENCE_ONNX_EXPORT_BINARY},t=>{
  const directory=mkdtempSync(join(tmpdir(),'pando-onnx-cli-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const output=join(directory,'existing.onnx');writeFileSync(output,'preserve');
  for(const [args,reason] of [[[],/Usage/],[['weights',output],/output exists/]]){
    const result=spawnSync(process.env.PANDO_REFERENCE_ONNX_EXPORT_BINARY,args,{encoding:'utf8',timeout:15000});
    assert.equal(result.error,undefined);assert.equal(result.status,1);assert.match(result.stderr,reason);
  }
  assert.equal(readFileSync(output,'utf8'),'preserve');
});
test('ONNX export preserves existing output and refuses modified warm-start weights',{skip:process.platform!=='win32'},async t=>{
  const root=mkdtempSync(join(tmpdir(),'pando-onnx-refusal-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const weights=join(root,'weights.safetensors'),output=join(root,'model.onnx');
  writeFileSync(weights,'weights');writeFileSync(output,'existing model');
  const request={weights,output,torchLibrary:root};
  await assert.rejects(nativeOnnxExport(request),/output exists/);
  await assert.rejects(nativeOnnxDiagnostic({output,torchLibrary:root}),/output exists/);
  assert.equal(readFileSync(output,'utf8'),'existing model');
  const unused=join(root,'new.onnx');
  writeFileSync(join(root,'transfer.json'),JSON.stringify({trainingOnly:true,evaluationStatus:'pending',releaseApproved:false,
    transfer:'weights-only-no-optimizer',weightsSha256:createHash('sha256').update('original').digest('hex')}));
  await assert.rejects(nativeOnnxExport({...request,output:unused}),/warm-start weights/);
  assert.equal(existsSync(unused),false);
});
test('checkpoint export refuses invalid resume proof and changed checkpoint bytes',{skip:process.platform!=='win32'},async t=>{
  const root=mkdtempSync(join(tmpdir(),'pando-onnx-checkpoint-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const checkpoint=join(root,'checkpoint.pt'),proof=join(root,'proof.json'),output=join(root,'new.onnx');
  writeFileSync(checkpoint,'modified');
  const receipt={purpose:'real-input-resume-proof',trainingOnly:true,releaseApproved:false,independentEvaluation:false,
    preprocessing:'rgb-brightness-then-imagenet-normalization',exactModelResume:true,device:'cpu',checkpointBytes:8,
    checkpointSha256:createHash('sha256').update('original').digest('hex')};
  writeFileSync(proof,JSON.stringify(receipt));
  await assert.rejects(nativeCheckpointOnnxExport({checkpoint,proof,output,torchLibrary:root}),/matching private checkpoint/);
  assert.equal(existsSync(output),false);
  receipt.checkpointSha256=createHash('sha256').update('modified').digest('hex');receipt.releaseApproved=true;
  writeFileSync(proof,JSON.stringify(receipt));
  await assert.rejects(nativeCheckpointOnnxExport({checkpoint,proof,output,torchLibrary:root}),/matching private checkpoint/);
  assert.equal(existsSync(output),false);
});
test('checkpoint export accepts a bound private training receipt and refuses altered receipts',{skip:process.platform!=='win32'},async t=>{
  const root=mkdtempSync(join(tmpdir(),'pando-onnx-batch-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const checkpoint=join(root,'checkpoint.pt'),proof=checkpoint+'.receipt.json',output=join(root,'new.onnx');
  writeFileSync(checkpoint,'checkpoint');
  const receipt={schemaVersion:1,trainingOnly:true,releaseApproved:false,lineageComplete:false,sourceReplayVerified:false,
    initialization:'weights-only-no-optimizer',precision:'amp-fp16',device:'cuda',epoch:0,cursor:2,orderLength:2,
    checkpointBytes:10,checkpointSha256:createHash('sha256').update('checkpoint').digest('hex')};
  const request={checkpoint,proof,output,torchLibrary:root,directory:join(root,'missing-tool')};
  writeFileSync(proof,JSON.stringify(receipt));
  await assert.rejects(nativeCheckpointOnnxExport(request),/ENOENT/);
  receipt.checkpointSha256=createHash('sha256').update('different').digest('hex');
  writeFileSync(proof,JSON.stringify(receipt));
  await assert.rejects(nativeCheckpointOnnxExport(request),/matching private checkpoint/);
  receipt.checkpointSha256=createHash('sha256').update('checkpoint').digest('hex');receipt.releaseApproved=true;
  writeFileSync(proof,JSON.stringify(receipt));
  await assert.rejects(nativeCheckpointOnnxExport(request),/matching private checkpoint/);
  assert.equal(existsSync(output),false);
});
