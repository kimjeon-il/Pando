import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {compareNativeTrainingCheckpoints,nativeTrainingCheckpointInfer,nativeTrainingWeightsInfer} from '../../tools/reference-analysis/native-training-validation.mjs';

const available=Boolean(process.env.PANDO_REFERENCE_INFER_FIXTURE&&process.env.PANDO_REFERENCE_BATCH_DIRECTORY&&process.env.PANDO_REFERENCE_TORCH_LIBRARY);
test('checkpoint comparison rejects a mismatched receipt before launching the native tool',async t=>{
  const folder=mkdtempSync(join(tmpdir(),'pando-checkpoint-compare-'));t.after(()=>rmSync(folder,{recursive:true}));
  const checkpoint=join(folder,'checkpoint.pt');writeFileSync(checkpoint,'fixture');
  writeFileSync(checkpoint+'.receipt.json',JSON.stringify({schemaVersion:1,trainingOnly:true,releaseApproved:false,device:'cpu',checkpointSha256:'0'.repeat(64)}));
  await assert.rejects(compareNativeTrainingCheckpoints({first:checkpoint,second:checkpoint,device:'cpu',torchLibrary:folder}),/receipt differs/i);
  const second=join(folder,'second.pt');writeFileSync(second,'second');
  const base={schemaVersion:1,trainingOnly:true,releaseApproved:false,device:'cpu',corpusSha256:'a'.repeat(64),precision:'fp32',
    ampScale:null,ampGrowthTracker:null,epoch:0,cursor:0,orderLength:1,seed:1,freezeEpochs:0,learningRate:.0001,unobservedMask:0,
    positiveWeightSha256:null,attemptedBatches:0,optimizerUpdates:0,skippedUpdates:0,orderSha256:'b'.repeat(64),
    initialization:'weights-only-no-optimizer',initializationWeightsSha256:'c'.repeat(64),initializationSourceSha256:null,evidence:[{augment:false}]};
  writeFileSync(checkpoint+'.receipt.json',JSON.stringify({...base,checkpointSha256:createHash('sha256').update('fixture').digest('hex')}));
  writeFileSync(second+'.receipt.json',JSON.stringify({...base,learningRate:.0002,checkpointSha256:createHash('sha256').update('second').digest('hex')}));
  await assert.rejects(compareNativeTrainingCheckpoints({first:checkpoint,second,device:'cpu',torchLibrary:folder}),/configuration differs/i);
  const amp={...base,device:'cuda',precision:'amp-fp16',ampScale:65536,ampGrowthTracker:0};
  writeFileSync(checkpoint+'.receipt.json',JSON.stringify({...amp,checkpointSha256:createHash('sha256').update('fixture').digest('hex')}));
  writeFileSync(second+'.receipt.json',JSON.stringify({...amp,ampScale:32768,checkpointSha256:createHash('sha256').update('second').digest('hex')}));
  await assert.rejects(compareNativeTrainingCheckpoints({first:checkpoint,second,device:'cuda',torchLibrary:folder}),/configuration differs/i);
  const cli=spawnSync(process.execPath,['tools/reference-analysis/native-training-validation.mjs','--compare'],{encoding:'utf8'});
  assert.notEqual(cli.status,0);assert.match(cli.stderr,/first, second, device and torch library/i);
});
test('native checkpoint inference matches the source model output', {skip:!available},async t=>{
  const folder=mkdtempSync(join(tmpdir(),'pando-checkpoint-infer-'));t.after(()=>rmSync(folder,{recursive:true}));
  execFileSync(process.env.PANDO_REFERENCE_INFER_FIXTURE,[folder],{stdio:'pipe',windowsHide:true,timeout:180000});
  const checkpoint=join(folder,'checkpoint.pt'),bytes=readFileSync(checkpoint),checkpointSha256=createHash('sha256').update(bytes).digest('hex');
  const receipt={schemaVersion:1,trainingOnly:true,releaseApproved:false,device:'cpu',checkpointSha256,corpusSha256:'a'.repeat(64),
    precision:'fp32',ampScale:null,ampGrowthTracker:null,epoch:0,cursor:0,orderLength:1,seed:20261030,freezeEpochs:0,
    learningRate:.0001,unobservedMask:0,positiveWeightSha256:null,attemptedBatches:0,optimizerUpdates:0,skippedUpdates:0,evidence:[{augment:false}],
    orderSha256:createHash('sha256').update(Buffer.alloc(8)).digest('hex'),initialization:'weights-only-no-optimizer',
    initializationWeightsSha256:'b'.repeat(64),initializationSourceSha256:null};
  writeFileSync(checkpoint+'.receipt.json',JSON.stringify(receipt));
  const inputs={tile:readFileSync(join(folder,'tile.f32')),overview:readFileSync(join(folder,'overview.f32')),position:readFileSync(join(folder,'position.f32'))};
  const options={checkpoint,...inputs,device:'cpu',torchLibrary:process.env.PANDO_REFERENCE_TORCH_LIBRARY,directory:process.env.PANDO_REFERENCE_BATCH_DIRECTORY};
  const result=await nativeTrainingCheckpointInfer(options),expected=readFileSync(join(folder,'expected.f32'));
  const other=join(folder,'different.pt'),otherSha256=createHash('sha256').update(readFileSync(other)).digest('hex');
  writeFileSync(other+'.receipt.json',JSON.stringify({...receipt,checkpointSha256:otherSha256}));
  const comparison={first:checkpoint,second:checkpoint,device:'cpu',torchLibrary:process.env.PANDO_REFERENCE_TORCH_LIBRARY,directory:process.env.PANDO_REFERENCE_BATCH_DIRECTORY};
  const same=await compareNativeTrainingCheckpoints(comparison);
  assert.equal(same.equal,true);assert.equal(same.optimizerStates,0);
  const cli=JSON.parse(execFileSync(process.execPath,['tools/reference-analysis/native-training-validation.mjs','--compare','--first',checkpoint,'--second',checkpoint,
    '--device','cpu','--torch-library',process.env.PANDO_REFERENCE_TORCH_LIBRARY,'--directory',process.env.PANDO_REFERENCE_BATCH_DIRECTORY],{encoding:'utf8',windowsHide:true,timeout:180000}));
  assert.equal(cli.equal,true);assert.equal(cli.firstSha256,checkpointSha256);
  await assert.rejects(compareNativeTrainingCheckpoints({...comparison,second:other}),/parameter differs/i);
  assert.equal(result.logits.length,7*512*512*4);assert.equal(expected.length,result.logits.length);
  let maximum=0;for(let i=0;i<expected.length;i+=4)maximum=Math.max(maximum,Math.abs(expected.readFloatLE(i)-result.logits.readFloatLE(i)));
  assert.ok(maximum<=1e-6,`checkpoint inference error ${maximum}`);assert.equal(result.checkpointSha256,checkpointSha256);
  const probability=await nativeTrainingCheckpointInfer({...options,output:'probabilities'}),expectedProbability=readFileSync(join(folder,'expected-probabilities.f32'));
  assert.equal(probability.probabilities.length,expectedProbability.length);
  maximum=0;for(let i=0;i<expectedProbability.length;i+=4)maximum=Math.max(maximum,Math.abs(expectedProbability.readFloatLE(i)-probability.probabilities.readFloatLE(i)));
  assert.ok(maximum<=1e-6,`checkpoint probability error ${maximum}`);
  await assert.rejects(nativeTrainingCheckpointInfer({...options,output:'other'}),/output/i);
  const weights=join(folder,'weights.safetensors'),weightsSha256=createHash('sha256').update(readFileSync(weights)).digest('hex');
  writeFileSync(join(folder,'transfer.json'),JSON.stringify({trainingOnly:true,evaluationStatus:'pending',releaseApproved:false,
    transfer:'weights-only-no-optimizer',weightsSha256}));
  const baseline=await nativeTrainingWeightsInfer({...options,weights,output:'probabilities'});
  maximum=0;for(let i=0;i<expectedProbability.length;i+=4)maximum=Math.max(maximum,Math.abs(expectedProbability.readFloatLE(i)-baseline.probabilities.readFloatLE(i)));
  assert.ok(maximum<=1e-6,`initializer probability error ${maximum}`);assert.equal(baseline.weightsSha256,weightsSha256);
  const invalidDirectory=join(folder,'invalid-weights');mkdirSync(invalidDirectory);
  const invalidPath=join(invalidDirectory,'weights.safetensors'),raw=readFileSync(weights),headerLength=Number(raw.readBigUInt64LE());
  const header=JSON.parse(raw.subarray(8,8+headerLength));delete header.__metadata__;
  const encoded=Buffer.from(JSON.stringify(header)),padding=Buffer.alloc((8-encoded.length%8)%8,32),length=Buffer.alloc(8);
  length.writeBigUInt64LE(BigInt(encoded.length+padding.length));
  const invalid=Buffer.concat([length,encoded,padding,raw.subarray(8+headerLength)]);writeFileSync(invalidPath,invalid);
  writeFileSync(join(invalidDirectory,'transfer.json'),JSON.stringify({trainingOnly:true,evaluationStatus:'pending',releaseApproved:false,
    transfer:'weights-only-no-optimizer',weightsSha256:createHash('sha256').update(invalid).digest('hex')}));
  await assert.rejects(nativeTrainingWeightsInfer({...options,weights:invalidPath}),/private training-only reference initializer/i);
  writeFileSync(join(folder,'transfer.json'),JSON.stringify({trainingOnly:true,evaluationStatus:'pending',releaseApproved:false,
    transfer:'weights-only-no-optimizer',weightsSha256:'0'.repeat(64)}));
  await assert.rejects(nativeTrainingWeightsInfer({...options,weights}),/initializer/i);
  await assert.rejects(nativeTrainingCheckpointInfer({...options,tile:Buffer.alloc(1)}),/tensor/i);
  const badPosition=Buffer.from(inputs.position);badPosition.writeFloatLE(Number.NaN,0);
  await assert.rejects(nativeTrainingCheckpointInfer({...options,position:badPosition}),/nonfinite/i);
  writeFileSync(checkpoint+'.receipt.json',JSON.stringify({schemaVersion:1,trainingOnly:true,releaseApproved:false,device:'cpu',checkpointSha256:'0'.repeat(64)}));
  await assert.rejects(nativeTrainingCheckpointInfer(options),/receipt/i);
});
