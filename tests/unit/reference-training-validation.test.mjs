import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {nativeTrainingValidation} from '../../tools/reference-analysis/native-training-validation.mjs';

test('validation refuses incomplete ancestry and training-only validation data',async t=>{
  const root=mkdtempSync(join(tmpdir(),'pando-native-validation-'));t.after(()=>rmSync(root,{recursive:true}));
  const checkpoint=join(root,'model.pt'),corpus=join(root,'corpus.json'),sha=value=>createHash('sha256').update(value).digest('hex');
  writeFileSync(checkpoint,'checkpoint');writeFileSync(checkpoint+'.receipt.json',JSON.stringify({schemaVersion:1,trainingOnly:true,releaseApproved:false,
    lineageComplete:false,checkpointSha256:sha('checkpoint'),device:'cpu'}));
  writeFileSync(corpus,JSON.stringify({schemaVersion:1,trainingOnly:true,sheets:[]}));
  const request={checkpoint,corpus,device:'cpu',torchLibrary:root};
  await assert.rejects(nativeTrainingValidation(request),/lineage|ancestr/i);
  await assert.rejects(nativeTrainingValidation({...request,diagnosticOnly:true}),/training.only/i);
  assert.equal(existsSync(checkpoint),true);
});
