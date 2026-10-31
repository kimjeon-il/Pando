import assert from 'node:assert/strict';
import {existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {runMacroTrainingSequence} from '../../tools/reference-analysis/native-training-sequence.mjs';

test('training sequence rejects invalid input and preserves existing output',async t=>{
  const root=mkdtempSync(join(tmpdir(),'pando-training-sequence-'));t.after(()=>rmSync(root,{recursive:true}));
  const output=join(root,'existing');writeFileSync(output,'keep');
  const request={mode:'warm',input:'weights',output,corpus:'corpus',supervision:'supervision',epoch:0,seed:5,
    freezeEpochs:1,learningRate:.00001,device:'cpu',torchLibrary:'library',augment:false,batchSize:1,maxBatches:1};
  await assert.rejects(runMacroTrainingSequence({...request,batchSize:0}),/configuration/i);
  await assert.rejects(runMacroTrainingSequence(request),/exists/i);
  assert.equal(readFileSync(output,'utf8'),'keep');
  const signal=new AbortController();signal.abort();
  await assert.rejects(runMacroTrainingSequence({...request,output:join(root,'new'),signal:signal.signal}),{name:'AbortError'});
  assert.equal(existsSync(join(root,'new')),false);
  const cli=spawnSync(process.execPath,['tools/reference-analysis/native-training-sequence.mjs'],{encoding:'utf8'});
  assert.notEqual(cli.status,0);assert.match(cli.stderr,/explicit/i);
});
