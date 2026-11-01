import assert from 'node:assert/strict';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import test from 'node:test';
import * as training from '../../tools/reference-analysis/native-training-sequence.mjs';
import {corpusFingerprint} from '../../tools/reference-analysis/training-evidence.mjs';
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

test('validation selection requires an explicit diagnostic scope and patience',async t=>{
  const root=mkdtempSync(join(tmpdir(),'pando-training-validation-scope-'));t.after(()=>rmSync(root,{recursive:true}));
  const request={mode:'warm',input:'weights',output:join(root,'new'),corpus:'corpus',supervision:'supervision',epoch:0,seed:5,
    freezeEpochs:1,learningRate:.00001,device:'cpu',torchLibrary:'library',augment:false,batchSize:1,maxBatches:1,epochs:2};
  await assert.rejects(training.runTrainingCampaign({...request,validationCorpus:'validation'}),/validation.*scope/i);
  await assert.rejects(training.runTrainingCampaign({...request,validationCorpus:'validation',diagnosticOnly:true,patience:0}),/validation.*scope/i);
  await assert.rejects(training.runTrainingCampaign({...request,patience:1}),/validation.*scope/i);
  assert.equal(existsSync(request.output),false);
});

test('validation campaign refuses changed validation evidence on resume',async t=>{
  const root=mkdtempSync(join(tmpdir(),'pando-validation-history-'));t.after(()=>rmSync(root,{recursive:true}));
  const sha=value=>createHash('sha256').update(value).digest('hex'),image=readFileSync('tests/fixtures/map-image/png-read/orientation-6.png');
  mkdirSync(join(root,'sources'));mkdirSync(join(root,'labels'));writeFileSync(join(root,'sources/map.png'),image);
  const annotation={schemaVersion:1,reviewed:true,width:9,height:12,known:{international:[[[0,0],[8,0],[8,11],[0,11]]]},
    lines:[{kind:'international',width:1,points:[[1,4],[6,4]]}],ignore:[],review:{kind:'agent',reviewer:'fixture',
      reviewedAt:'2026-10-30T00:00:00Z',sourceSha256:sha(image),predictionBlind:true}};
  writeFileSync(join(root,'labels/map.json'),JSON.stringify(annotation));
  const sheet={id:'validation',familyId:'validation-family',editionId:'validation-edition',duplicateGroup:'validation-group',
    split:'validation',image:'sources/map.png',annotations:'labels/map.json',sha256:sha(image),language:'fas',script:'Arabic',
    mapKind:'monochrome',source:{url:'https://example.org',license:'fixture'}};
  const validationCorpus=join(root,'validation.json'),corpus=join(root,'training.json'),checkpoint=join(root,'checkpoint.pt');
  writeFileSync(validationCorpus,JSON.stringify({schemaVersion:1,sheets:[sheet]}));
  writeFileSync(corpus,JSON.stringify({sheets:[{id:'train',familyId:'train-family',editionId:'train-edition',duplicateGroup:'train-group',split:'train',sha256:'a'.repeat(64)}]}));
  writeFileSync(checkpoint,'checkpoint');const corpusHash=sha(readFileSync(corpus)),checkpointHash=sha('checkpoint');
  writeFileSync(checkpoint+'.receipt.json',JSON.stringify({checkpointSha256:checkpointHash,corpusSha256:corpusHash,epoch:0,cursor:1,orderLength:1,epochLossSum:1,epochLossCount:1}));
  const proof=join(root,'proof.json');writeFileSync(proof,'changed');
  const configuration={seed:5,freezeEpochs:1,learningRate:.00001,device:'cpu',amp:false,augment:false,batchSize:1,
    validationSha256:sha(readFileSync(validationCorpus)),validationFingerprint:await corpusFingerprint(validationCorpus),diagnosticOnly:true,patience:2};
  const history={schemaVersion:1,status:'partial',trainingOnly:true,independentEvaluation:false,releaseApproved:false,lineageComplete:false,
    selectionMetric:'validationLoss',selectionScope:'campaign-completed-epochs',configuration,checkpointSha256:checkpointHash,corpusSha256:corpusHash,
    inputSha256:'b'.repeat(64),requestedEpochs:2,completedEpochs:1,batches:1,staleEpochs:0,bestCheckpoint:checkpoint,bestCheckpointSha256:checkpointHash,bestScore:.5,
    epochs:[{epoch:0,status:'epoch-complete',cursor:1,orderLength:1,batches:1,checkpoint,checkpointSha256:checkpointHash,trainingLoss:1,
      validationLoss:.5,validationReceipt:proof,validationReceiptSha256:'c'.repeat(64)}]};
  const previousCampaign=join(root,'campaign.json');writeFileSync(previousCampaign,JSON.stringify(history));
  const output=join(root,'new'),request={mode:'resume',input:checkpoint,output,corpus,supervision:root,
    validationCorpus,diagnosticOnly:true,patience:2,previousCampaign,epoch:1,seed:5,freezeEpochs:1,learningRate:.00001,
    device:'cpu',torchLibrary:root,augment:false,batchSize:1,maxBatches:1,epochs:2};
  await assert.rejects(training.runTrainingCampaign(request),/validation receipt differs/i);
  writeFileSync(validationCorpus,JSON.stringify({schemaVersion:1,sheets:[{...sheet,familyId:'train-family'}]}));
  await assert.rejects(training.runTrainingCampaign(request),/familyId/i);
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
