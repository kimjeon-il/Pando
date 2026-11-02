import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import * as exporter from '../../tools/reference-analysis/native-onnx-export.mjs';
import {inspectTransferredWeightsOnnx} from '../../tools/reference-analysis/verify-trained-onnx.mjs';
import {validateCandidateModel} from '../../plugins/pando-map-tools/lib/jobs.mjs';
const {nativeCheckpointOnnxExport,nativeOnnxDiagnostic,nativeOnnxExport}=exporter;

test('Linux ONNX export checks the requested output before native execution',async t=>{
  const root=mkdtempSync(join(tmpdir(),'pando-onnx-linux-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const output=join(root,'existing.onnx');writeFileSync(output,'preserve');
  const descriptor=Object.getOwnPropertyDescriptor(process,'platform');
  try{Object.defineProperty(process,'platform',{value:'linux',configurable:true});
    await assert.rejects(nativeOnnxDiagnostic({output,torchLibrary:root}),/output exists/i);
    assert.equal(readFileSync(output,'utf8'),'preserve');
  }finally{Object.defineProperty(process,'platform',descriptor);}
});

test('transferred weights ONNX receipt preserves unknown ancestry and optimizer state',()=>{
  const initializer={initialization:'weights-only-no-optimizer',weightsSha256:'a'.repeat(64),sourceCheckpointSha256:'b'.repeat(64)};
  const model={file:'candidate.onnx',bytes:123,sha256:'c'.repeat(64)};
  const result=exporter.transferredWeightsOnnxReceipt({initializer,model});
  assert.equal(result.opset,17);assert.equal(result.weightsSha256,initializer.weightsSha256);
  assert.equal(result.sourceCheckpointSha256,initializer.sourceCheckpointSha256);assert.deepEqual(result.model,model);
  assert.equal(result.optimizerStateTransferred,false);assert.equal(result.lineageComplete,false);assert.equal(result.releaseApproved,false);
  assert.throws(()=>exporter.transferredWeightsOnnxReceipt({initializer:{...initializer,sourceCheckpointSha256:null},model}),/identity/i);
  assert.throws(()=>exporter.transferredWeightsOnnxReceipt({initializer,model:{...model,file:'../model.onnx'}}),/identity/i);
});

test('transferred ONNX inspection rejects modified model, weights and export receipt',t=>{
  const root=mkdtempSync(join(tmpdir(),'pando-onnx-transfer-'));t.after(()=>rmSync(root,{recursive:true}));
  const weights=join(root,'weights.safetensors'),model=join(root,'candidate.onnx'),hash=x=>createHash('sha256').update(x).digest('hex');
  writeFileSync(weights,'weights');writeFileSync(model,'model');
  const initializer={initialization:'weights-only-no-optimizer',weightsSha256:hash('weights'),sourceCheckpointSha256:'b'.repeat(64)};
  writeFileSync(join(root,'transfer.json'),JSON.stringify({schemaVersion:1,transfer:initializer.initialization,
    weightsSha256:initializer.weightsSha256,sourceCheckpointSha256:initializer.sourceCheckpointSha256,
    trainingOnly:true,evaluationStatus:'pending',releaseApproved:false}));
  const receipt=exporter.transferredWeightsOnnxReceipt({initializer,model:{file:'candidate.onnx',bytes:5,sha256:hash('model')}});
  const save=()=>writeFileSync(model+'.export.json',JSON.stringify(receipt));save();
  assert.equal(inspectTransferredWeightsOnnx({model,weights}).modelSha256,hash('model'));
  writeFileSync(model,'other');assert.throws(()=>inspectTransferredWeightsOnnx({model,weights}),/does not match/i);writeFileSync(model,'model');
  writeFileSync(weights,'other');assert.throws(()=>inspectTransferredWeightsOnnx({model,weights}),/initializer/i);writeFileSync(weights,'weights');
  receipt.opset=18;save();assert.throws(()=>inspectTransferredWeightsOnnx({model,weights}),/does not match/i);
});

test('checkpoint ONNX manifest preserves pending training lineage and channel visibility',()=>{
  assert.equal(typeof exporter.checkpointOnnxManifest,'function');
  const receipt={schemaVersion:1,trainingOnly:true,releaseApproved:false,corpusSha256:'a'.repeat(64),
    checkpointSha256:'b'.repeat(64),lineageComplete:false,sourceReplayVerified:false,initialization:'weights-only-no-optimizer',
    attemptedBatches:2,optimizerUpdates:2,unobservedMask:126};
  const model={file:'boundary.onnx',bytes:123,sha256:'c'.repeat(64)};
  const manifest=exporter.checkpointOnnxManifest({receipt,model});
  assert.deepEqual(manifest.model,{url:'boundary.onnx',bytes:123,sha256:'c'.repeat(64)});
  assert.equal(manifest.evaluationStatus,'pending');assert.equal(manifest.releaseApproved,false);assert.equal(manifest.trainingOnly,true);
  assert.equal(manifest.lineageComplete,false);assert.equal(manifest.checkpointSha256,receipt.checkpointSha256);
  assert.deepEqual(validateCandidateModel(manifest).observedChannels,['international']);
  assert.deepEqual(manifest.unobservedChannels,['administrative','coast','hydro','transport','text','frame']);
  const combined={...receipt,auxiliarySha256:'d'.repeat(64),lineageFingerprint:'e'.repeat(64)};
  const combinedManifest=exporter.checkpointOnnxManifest({receipt:combined,model});
  assert.equal(combinedManifest.auxiliaryCorpusSha256,combined.auxiliarySha256);
  assert.equal(combinedManifest.lineageFingerprint,combined.lineageFingerprint);
  assert.equal(validateCandidateModel(combinedManifest).auxiliaryCorpusSha256,combined.auxiliarySha256);
  const encoderInitialization={kind:'public-pretrained-image-classification',url:'https://download.pytorch.org/models/encoder-12345678.pth',
    sha256:'12345678'+'d'.repeat(56),bytes:15};
  const fresh={...receipt,initialization:'public-encoder-no-optimizer',encoderInitialization};
  const freshManifest=exporter.checkpointOnnxManifest({receipt:fresh,model});
  assert.equal(freshManifest.initialization,'public-encoder-no-optimizer');assert.deepEqual(freshManifest.encoderInitialization,encoderInitialization);
  assert.throws(()=>exporter.checkpointOnnxManifest({receipt:{...fresh,encoderInitialization:{...encoderInitialization,sha256:'e'.repeat(64)}},model}),/encoder provenance/i);
  assert.throws(()=>exporter.checkpointOnnxManifest({receipt:{...receipt,auxiliarySha256:'d'.repeat(64)},model}),/auxiliary/i);
  assert.throws(()=>exporter.checkpointOnnxManifest({receipt:{...receipt,lineageFingerprint:'e'.repeat(64)},model}),/auxiliary/i);
  assert.throws(()=>exporter.checkpointOnnxManifest({receipt:{...receipt,releaseApproved:true},model}),/receipt/i);
  assert.throws(()=>exporter.checkpointOnnxManifest({receipt:{...receipt,optimizerUpdates:3},model}),/receipt/i);
  assert.throws(()=>exporter.checkpointOnnxManifest({receipt,model:{...model,file:'../unsafe.onnx'}}),/model/i);
  assert.throws(()=>exporter.checkpointOnnxManifest({receipt,model:{...model,file:'bad name.onnx'}}),/model/i);
  assert.throws(()=>exporter.checkpointOnnxManifest({receipt,model:{...model,bytes:64*1024*1024+1}}),/model/i);
});

test('native exporter refuses missing arguments and existing output',{skip:!process.env.PANDO_REFERENCE_ONNX_EXPORT_BINARY},t=>{
  const directory=mkdtempSync(join(tmpdir(),'pando-onnx-cli-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const output=join(directory,'existing.onnx');writeFileSync(output,'preserve');
  for(const [args,reason] of [[[],/Usage/],[['weights',output],/output exists/]]){
    const result=spawnSync(process.env.PANDO_REFERENCE_ONNX_EXPORT_BINARY,args,{encoding:'utf8',timeout:15000});
    assert.equal(result.error,undefined);assert.equal(result.status,1);assert.match(result.stderr,reason);
  }
  assert.equal(readFileSync(output,'utf8'),'preserve');
});
test('ONNX export preserves existing output and refuses modified warm-start weights',{skip:!['win32','linux'].includes(process.platform)},async t=>{
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
test('checkpoint export refuses invalid resume proof and changed checkpoint bytes',{skip:!['win32','linux'].includes(process.platform)},async t=>{
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
test('checkpoint export accepts a bound private training receipt and refuses altered receipts',{skip:!['win32','linux'].includes(process.platform)},async t=>{
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
test('checkpoint export protects an existing matching manifest before generating a model',{skip:!['win32','linux'].includes(process.platform)},async t=>{
  const root=mkdtempSync(join(tmpdir(),'pando-onnx-manifest-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const checkpoint=join(root,'checkpoint.pt'),proof=checkpoint+'.receipt.json',output=join(root,'new.onnx'),manifestOutput=join(root,'new.manifest.json');
  writeFileSync(checkpoint,'checkpoint');writeFileSync(manifestOutput,'protected');
  const receipt={schemaVersion:1,trainingOnly:true,releaseApproved:false,lineageComplete:false,sourceReplayVerified:false,
    initialization:'weights-only-no-optimizer',precision:'fp32',device:'cpu',epoch:0,cursor:1,orderLength:2,
    attemptedBatches:1,optimizerUpdates:1,unobservedMask:126,corpusSha256:'a'.repeat(64),checkpointBytes:10,
    checkpointSha256:createHash('sha256').update('checkpoint').digest('hex')};
  writeFileSync(proof,JSON.stringify(receipt));
  await assert.rejects(nativeCheckpointOnnxExport({checkpoint,proof,output,manifestOutput,torchLibrary:root}),/manifest output exists/i);
  assert.equal(readFileSync(manifestOutput,'utf8'),'protected');assert.equal(existsSync(output),false);
});
