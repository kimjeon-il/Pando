import assert from 'node:assert/strict';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import test from 'node:test';
import * as training from '../../tools/reference-analysis/native-training-sequence.mjs';
import {corpusFingerprint} from '../../tools/reference-analysis/training-evidence.mjs';
import {validateReplayReceiptChain,verifyTrainingSourceReplay,verifyTrainingUpdateReplay} from '../../tools/reference-analysis/native-training-replay.mjs';
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
  writeFileSync(input,'checkpoint');writeFileSync(join(root,'image.png'),'image');writeFileSync(join(root,'label.json'),'{}');
  const data={schemaVersion:1,sheets:[{split:'train',image:'image.png',annotations:'label.json'}]};
  writeFileSync(corpus,JSON.stringify(data));writeFileSync(auxiliary,JSON.stringify(data));
  const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
  writeFileSync(previousCampaign,JSON.stringify({checkpointSha256:hash(input),corpusSha256:hash(corpus),auxiliarySha256:'0'.repeat(64)}));
  const request={mode:'resume',input,output,corpus,auxiliary,macroOnly:false,previousCampaign,epoch:0,seed:5,
    freezeEpochs:1,learningRate:.00001,device:'cpu',torchLibrary:root,augment:false,batchSize:1,maxBatches:1,epochs:1};
  await assert.rejects(training.runTrainingCampaign(request),/previous.*corpus/i);
  assert.equal(existsSync(output),false);
});

test('validation selection requires an explicit scope, patience and verified replay weights',async t=>{
  const root=mkdtempSync(join(tmpdir(),'pando-training-validation-scope-'));t.after(()=>rmSync(root,{recursive:true}));
  const request={mode:'warm',input:'weights',output:join(root,'new'),corpus:'corpus',supervision:'supervision',epoch:0,seed:5,
    freezeEpochs:1,learningRate:.00001,device:'cpu',torchLibrary:'library',augment:false,batchSize:1,maxBatches:1,epochs:2};
  await assert.rejects(training.runTrainingCampaign({...request,validationCorpus:'validation'}),/validation.*scope/i);
  await assert.rejects(training.runTrainingCampaign({...request,validationCorpus:'validation',diagnosticOnly:true,patience:0}),/validation.*scope/i);
  await assert.rejects(training.runTrainingCampaign({...request,patience:1}),/validation.*scope/i);
  await assert.rejects(training.runTrainingCampaign({...request,validationCorpus:'validation',diagnosticOnly:false,patience:1}),/replay weights/i);
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

const hash=char=>char.repeat(64),weightsSha256=hash('a'),corpusSha256=hash('b');
function fixture(){
  const evidence={sourceId:'fixture',sourceKind:'macro-pdf',imageSha256:hash('1'),annotationSha256:hash('2'),sourceEvidenceSha256:hash('3'),
    maskSha256:hash('4'),validMaskSha256:hash('5'),tileIndex:0,augmentationIndex:0,pixelOrigin:[0,0],augment:false,
    tensorSha256:Object.fromEntries(['tile','overview','position','target','valid'].map(name=>[name,hash('6')]))};
  const receipt={schemaVersion:1,checkpointSha256:hash('7'),trainingOnly:true,releaseApproved:false,lineageComplete:false,sourceReplayVerified:false,
    batchSourceReplayVerified:true,initialization:'public-encoder-no-optimizer',initializationWeightsSha256:weightsSha256,initializationSourceSha256:null,
    encoderInitialization:{kind:'public-pretrained-image-classification',url:'https://download.pytorch.org/models/model-12345678.pth',sha256:'12345678'+'9'.repeat(56),bytes:1},
    corpusSha256,device:'cpu',precision:'fp32',epoch:0,seed:1,freezeEpochs:2,learningRate:.0001,unobservedMask:0,
    orderSha256:hash('8'),positiveWeightSha256:hash('9'),orderLength:4,cursor:1,evidence:[evidence],attemptedBatches:1,optimizerUpdates:1,skippedUpdates:0,
    parentCheckpointSha256:null,parentReceiptSha256:null};
  const first={checkpointSha256:hash('7'),receiptSha256:hash('c'),receipt};
  const second={checkpointSha256:hash('d'),receiptSha256:hash('e'),receipt:{...structuredClone(receipt),checkpointSha256:hash('d'),cursor:2,
    evidence:[{...structuredClone(evidence),tileIndex:1,augmentationIndex:1}],attemptedBatches:2,optimizerUpdates:2,
    parentCheckpointSha256:first.checkpointSha256,parentReceiptSha256:first.receiptSha256}};
  return [first,second];
}
test('source replay requires a complete linked chain and exact batch evidence',()=>{
  const entries=fixture(),scope={weightsSha256,corpusSha256};
  assert.deepEqual(validateReplayReceiptChain(entries,scope),{batches:2,samples:2});
  for(const change of [
    rows=>{rows[1].receipt.parentReceiptSha256=hash('f');},
    rows=>{rows[1].receipt.cursor=3;},
    rows=>{rows[1].receipt.epoch=1;},
    rows=>{rows[1].receipt.evidence[0].maskSha256=undefined;},
    rows=>{rows[1].receipt.evidence[0].tensorSha256.valid=hash('x');},
    rows=>{rows[1].receipt.evidence[0].augment=true;},
    rows=>{rows[1].receipt.auxiliarySha256=hash('f');},
    rows=>{rows[1].receipt.selectionExposure={schemaVersion:1,manifestSha256:hash('a'),fingerprint:hash('b')};},
    rows=>{rows[0].receipt.batchSourceReplayVerified=false;},
  ]){const altered=structuredClone(entries);change(altered);assert.throws(()=>validateReplayReceiptChain(altered,scope));}
});
test('source replay binds the declared validation selection for every batch',()=>{
  const entries=fixture(),scope={weightsSha256,corpusSha256};
  const selectionExposure={schemaVersion:1,manifestSha256:hash('a'),fingerprint:hash('b')};
  for(const entry of entries)entry.receipt.selectionExposure={...selectionExposure};
  assert.deepEqual(validateReplayReceiptChain(entries,scope),{batches:2,samples:2});
  const altered=structuredClone(entries);altered[1].receipt.selectionExposure.fingerprint=hash('c');
  assert.throws(()=>validateReplayReceiptChain(altered,scope),/configuration differs/i);
  altered[0].receipt.selectionExposure.fingerprint='invalid';
  assert.throws(()=>validateReplayReceiptChain(altered,scope),/selection/i);
});
test('source replay rejects missing and repeated checkpoint paths',async()=>{
  await assert.rejects(verifyTrainingSourceReplay({checkpoints:[],weights:'x',corpus:'x',supervision:'x'}),/checkpoint chain/i);
  await assert.rejects(verifyTrainingSourceReplay({checkpoints:['same','same'],weights:'x',corpus:'x',supervision:'x'}),/checkpoint chain/i);
});
test('update replay allows long bounded chains but rejects invalid chains and existing scratch',async t=>{
  const root=mkdtempSync(join(tmpdir(),'pando-update-replay-'));t.after(()=>rmSync(root,{recursive:true}));
  await assert.rejects(verifyTrainingUpdateReplay({checkpoints:[],scratch:join(root,'new'),torchLibrary:root}),/bounded/i);
  await assert.rejects(verifyTrainingUpdateReplay({checkpoints:Array(100001).fill('x'),scratch:join(root,'new'),torchLibrary:root}),/bounded/i);
  await assert.rejects(verifyTrainingUpdateReplay({checkpoints:Array(17).fill('x'),scratch:join(root,'new'),torchLibrary:root}),/distinct checkpoint chain/i);
  await assert.rejects(verifyTrainingUpdateReplay({checkpoints:['x'],scratch:root,torchLibrary:root}),/output exists/i);
  assert.equal(existsSync(join(root,'new')),false);
  const cli=spawnSync(process.execPath,['tools/reference-analysis/native-training-replay.mjs','--weights','x','--corpus','x','--supervision','x',
    '--replay-updates','x'],{encoding:'utf8'});
  assert.notEqual(cli.status,0);assert.match(cli.stderr,/explicit weights/i);
});
test('mixed source replay binds the auxiliary corpus and local augmentation index',()=>{
  const entries=fixture(),auxiliarySha256=hash('1'),lineageFingerprint=hash('2'),scope={weightsSha256,corpusSha256,auxiliarySha256,lineageFingerprint};
  for(const entry of entries){entry.receipt.auxiliarySha256=auxiliarySha256;entry.receipt.lineageFingerprint=lineageFingerprint;}
  Object.assign(entries[1].receipt.evidence[0],{sourceKind:'semap-label',tileIndex:20,augmentationIndex:6});
  assert.deepEqual(validateReplayReceiptChain(entries,scope),{batches:2,samples:2});
  assert.throws(()=>validateReplayReceiptChain(entries,{weightsSha256,corpusSha256}),/receipt/i);
  assert.throws(()=>validateReplayReceiptChain(entries,{...scope,auxiliarySha256:hash('3')}),/receipt/i);
  const invalid=structuredClone(entries);invalid[1].receipt.evidence[0].augmentationIndex=-1;
  assert.throws(()=>validateReplayReceiptChain(invalid,scope),/evidence/i);
});
