import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {verifiedPublicEncoderIdentity,verifyTrainingInitializer} from '../../tools/reference-analysis/training-evidence.mjs';

test('public encoder identity binds official URL, bytes and full hash',t=>{
  const root=mkdtempSync(join(tmpdir(),'pando-encoder-identity-'));t.after(()=>rmSync(root,{recursive:true}));
  const path=join(root,'encoder.pth'),bytes=Buffer.from('fixture weights');writeFileSync(path,bytes);
  const sha256=createHash('sha256').update(bytes).digest('hex'),url=`https://download.pytorch.org/models/encoder-${sha256.slice(0,8)}.pth`;
  assert.deepEqual(verifiedPublicEncoderIdentity({path,url}),{kind:'public-pretrained-image-classification',url,sha256,bytes:15});
  const result=spawnSync(process.execPath,['tools/reference-analysis/training-evidence.mjs','--encoder-identity-stream'],
    {input:JSON.stringify({path,url}),encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),{kind:'public-pretrained-image-classification',url,sha256,bytes:15});
  const weights=join(root,'weights.safetensors'),weightsBytes=Buffer.from('model fixture');writeFileSync(weights,weightsBytes);
  const weightsSha256=createHash('sha256').update(weightsBytes).digest('hex'),encoderInitialization={kind:'public-pretrained-image-classification',url,sha256,bytes:15};
  writeFileSync(join(root,'transfer.json'),JSON.stringify({schemaVersion:1,transfer:'public-encoder-no-optimizer',trainingOnly:true,evaluationStatus:'pending',
    releaseApproved:false,weightsSha256,encoderInitialization,encoderSourcePath:path,tensorCount:340,randomSeed:20261022}));
  const initializer=verifyTrainingInitializer({path:weights});assert.equal(initializer.initialization,'public-encoder-no-optimizer');
  assert.deepEqual(initializer.encoderInitialization,encoderInitialization);assert.equal(initializer.sourceCheckpointSha256,null);
  assert.throws(()=>verifiedPublicEncoderIdentity({path,url:url.replace('download.pytorch.org','example.test')}),/official/i);
  writeFileSync(path,'changed');assert.throws(()=>verifiedPublicEncoderIdentity({path,url}),/hash differs/i);
  assert.throws(()=>verifyTrainingInitializer({path:weights}),/hash differs/i);
});
