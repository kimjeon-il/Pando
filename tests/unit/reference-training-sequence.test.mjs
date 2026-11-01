import assert from 'node:assert/strict';
import {existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import test from 'node:test';
import * as training from '../../tools/reference-analysis/native-training-sequence.mjs';
const {runTrainingSequence}=training;

test('mixed sequence requires an explicit auxiliary scope and rejects mismatched settings',async t=>{
  const root=mkdtempSync(join(tmpdir(),'pando-training-mixed-sequence-'));t.after(()=>rmSync(root,{recursive:true}));
  const request={mode:'warm',input:'weights',output:join(root,'new'),corpus:'corpus',auxiliary:'auxiliary',epoch:0,seed:5,
    freezeEpochs:1,learningRate:.00001,device:'cpu',torchLibrary:'library',augment:false,batchSize:1,maxBatches:1};
  await assert.rejects(runTrainingSequence(request),/scope|configuration/i);
  await assert.rejects(runTrainingSequence({...request,macroOnly:true}),/scope|configuration/i);
  await assert.rejects(runTrainingSequence({...request,macroOnly:false,supervision:'other'}),/scope|configuration/i);
  await assert.rejects(runTrainingSequence({...request,auxiliary:undefined,macroOnly:false,supervision:'other'}),/scope|configuration/i);
  assert.equal(existsSync(request.output),false);
});

test('mixed campaign refuses history from a different auxiliary corpus',async t=>{
  const root=mkdtempSync(join(tmpdir(),'pando-training-mixed-history-'));t.after(()=>rmSync(root,{recursive:true}));
  const input=join(root,'checkpoint.pt'),corpus=join(root,'primary.json'),auxiliary=join(root,'auxiliary.json');
  const previousCampaign=join(root,'previous.json'),output=join(root,'new');
  writeFileSync(input,'checkpoint');writeFileSync(corpus,JSON.stringify({sheets:[]}));writeFileSync(auxiliary,JSON.stringify({sheets:[]}));
  const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
  writeFileSync(previousCampaign,JSON.stringify({checkpointSha256:hash(input),corpusSha256:hash(corpus),auxiliarySha256:'0'.repeat(64)}));
  const request={mode:'resume',input,output,corpus,auxiliary,macroOnly:false,previousCampaign,epoch:0,seed:5,
    freezeEpochs:1,learningRate:.00001,device:'cpu',torchLibrary:root,augment:false,batchSize:1,maxBatches:1,epochs:1};
  await assert.rejects(training.runTrainingCampaign(request),/previous.*corpus/i);
  assert.equal(existsSync(output),false);
});

test('training campaign requires bounded epochs and protects existing output',async t=>{
  assert.equal(typeof training.runTrainingCampaign,'function');
  const root=mkdtempSync(join(tmpdir(),'pando-training-campaign-'));t.after(()=>rmSync(root,{recursive:true}));
  const output=join(root,'existing');writeFileSync(output,'protected');
  const request={mode:'warm',input:'weights',output,corpus:'corpus',supervision:'supervision',epoch:0,seed:5,
    freezeEpochs:1,learningRate:.00001,device:'cpu',torchLibrary:'library',augment:false,batchSize:1,maxBatches:1,epochs:1};
  await assert.rejects(training.runTrainingCampaign({...request,epochs:0}),/configuration/i);
  await assert.rejects(training.runTrainingCampaign({...request,output:join(root,'new'),onProgress:'invalid'}),/configuration/i);
  await assert.rejects(training.runTrainingCampaign(request),/exists/i);
  assert.equal(readFileSync(output,'utf8'),'protected');
  const controller=new AbortController();controller.abort();
  await assert.rejects(training.runTrainingCampaign({...request,output:join(root,'new'),signal:controller.signal}),{name:'AbortError'});
  assert.equal(existsSync(join(root,'new')),false);
});

test('campaign continuation rejects a prior history bound to another checkpoint',async t=>{
  const root=mkdtempSync(join(tmpdir(),'pando-training-history-'));t.after(()=>rmSync(root,{recursive:true}));
  const input=join(root,'checkpoint.pt'),corpus=join(root,'corpus.json'),previousCampaign=join(root,'campaign.json'),output=join(root,'new');
  writeFileSync(input,'checkpoint');writeFileSync(corpus,'corpus');
  const hash=value=>createHash('sha256').update(value).digest('hex');
  writeFileSync(previousCampaign,JSON.stringify({schemaVersion:1,status:'partial',trainingOnly:true,independentEvaluation:false,
    releaseApproved:false,lineageComplete:false,checkpointSha256:'0'.repeat(64),corpusSha256:hash('corpus')}));
  const request={mode:'resume',input,output,corpus,supervision:root,previousCampaign,epoch:0,seed:5,
    freezeEpochs:1,learningRate:.00001,device:'cpu',torchLibrary:root,augment:false,batchSize:1,maxBatches:1,epochs:1};
  await assert.rejects(training.runTrainingCampaign(request),/previous.*checkpoint|campaign.*checkpoint/i);
  assert.equal(existsSync(output),false);assert.equal(readFileSync(input,'utf8'),'checkpoint');
  const history={schemaVersion:1,status:'partial',trainingOnly:true,independentEvaluation:false,releaseApproved:false,lineageComplete:false,
    selectionMetric:'trainingLoss',selectionScope:'campaign-completed-epochs',checkpointSha256:hash('checkpoint'),corpusSha256:hash('corpus'),
    inputSha256:hash('initializer'),requestedEpochs:1,completedEpochs:0,batches:1,bestCheckpoint:null,bestCheckpointSha256:null,bestScore:null,
    configuration:{seed:5,freezeEpochs:1,learningRate:.00001,device:'cpu',amp:false,augment:false,batchSize:1},
    epochs:[{epoch:0,status:'epoch-complete',cursor:2,orderLength:14,batches:1,checkpoint:input,checkpointSha256:hash('checkpoint'),trainingLoss:1}]};
  writeFileSync(previousCampaign,JSON.stringify(history));
  await assert.rejects(training.runTrainingCampaign(request),/epoch order/i);
  assert.equal(existsSync(output),false);
});

test('training sequence rejects invalid input and preserves existing output',async t=>{
  const root=mkdtempSync(join(tmpdir(),'pando-training-sequence-'));t.after(()=>rmSync(root,{recursive:true}));
  const output=join(root,'existing');writeFileSync(output,'keep');
  const request={mode:'warm',input:'weights',output,corpus:'corpus',supervision:'supervision',epoch:0,seed:5,
    freezeEpochs:1,learningRate:.00001,device:'cpu',torchLibrary:'library',augment:false,batchSize:1,maxBatches:1};
  await assert.rejects(runTrainingSequence({...request,batchSize:0}),/configuration/i);
  await assert.rejects(runTrainingSequence(request),/exists/i);
  assert.equal(readFileSync(output,'utf8'),'keep');
  const signal=new AbortController();signal.abort();
  await assert.rejects(runTrainingSequence({...request,output:join(root,'new'),signal:signal.signal}),{name:'AbortError'});
  assert.equal(existsSync(join(root,'new')),false);
  const cli=spawnSync(process.execPath,['tools/reference-analysis/native-training-sequence.mjs'],{encoding:'utf8'});
  assert.notEqual(cli.status,0);assert.match(cli.stderr,/explicit/i);
});
