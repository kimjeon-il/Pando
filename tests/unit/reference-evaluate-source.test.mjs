import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {evaluateReviewedCheckpointCorpus,evaluateReviewedCheckpointSource,finalizeReviewedEvaluation,trainingCorpusIdentity} from '../../tools/reference-analysis/native-evaluate-source.mjs';
import {metricsFromCounts} from '../../tools/reference-analysis/native-evaluation.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
test('evaluation distinguishes a manifest hash from the full training fingerprint',()=>{
  const manifest='a'.repeat(64),fingerprint='b'.repeat(64);
  assert.deepEqual(trainingCorpusIdentity({mode:'checkpoint',receipt:{corpusSha256:manifest}}),
    {trainingCorpusSha256:null,trainingCorpusManifestSha256:manifest});
  assert.deepEqual(trainingCorpusIdentity({mode:'checkpoint',receipt:{corpusSha256:manifest},replayedFingerprint:fingerprint}),
    {trainingCorpusSha256:fingerprint,trainingCorpusManifestSha256:manifest});
  assert.equal(trainingCorpusIdentity({mode:'checkpoint',receipt:{corpusSha256:manifest,lineageFingerprint:fingerprint}}).trainingCorpusSha256,fingerprint);
  assert.throws(()=>trainingCorpusIdentity({mode:'checkpoint',receipt:{corpusSha256:manifest,lineageFingerprint:'invalid'}}),/fingerprint/i);
});
test('diagnostic and partial review cannot claim independent admission',()=>{
  const counts=[[4,4,4,4],[0,0,0,0],[0,0,0,0]],perSheet={fixture:metricsFromCounts(counts)};
  const confounders={fixture:{text:{international:{falsePositive:0,pixels:4}}}};
  const result=finalizeReviewedEvaluation({groups:{'monochrome/Latin/eng':[counts]},perSheet,confounders,baseline:{confounders},requiredChannels:['international'],
    reviewScopes:{fixture:'partial'},independenceRows:[{passed:false,reason:'incomplete-training-ancestry'}],diagnosticOnly:true});
  assert.equal(result.independence.passed,false);assert.equal(result.admission.passed,false);assert.equal(result.reviewCoverage.complete,false);
  assert.ok(result.admission.failures.some(row=>row.reason==='incomplete-source-map-review'));
  assert.ok(result.admission.failures.some(row=>row.reason==='diagnostic-baseline-is-not-qualification'));
});
test('source evaluation protects test scope and incomplete training ancestry',async t=>{
  const root=mkdtempSync(join(tmpdir(),'pando-evaluate-source-'));t.after(()=>rmSync(root,{recursive:true}));
  const image=readFileSync('tests/fixtures/map-image/png-read/orientation-6.png'),imageSha=sha(image),checkpoint=join(root,'checkpoint.pt'),corpus=join(root,'corpus.json');
  writeFileSync(join(root,'image.png'),image);writeFileSync(checkpoint,'fixture checkpoint');
  const annotation={schemaVersion:1,reviewed:true,width:9,height:12,known:{international:[[[0,0],[8,0],[8,11],[0,11]]]},
    lines:[{kind:'international',points:[[1,2],[7,9]],width:2}],ignore:[],
    review:{kind:'agent',reviewer:'fixture',reviewedAt:'2026-10-30T00:00:00Z',sourceSha256:imageSha,predictionBlind:true,coverage:'partial'}};
  writeFileSync(join(root,'labels.json'),JSON.stringify(annotation));
  const sheet={id:'fixture',familyId:'family',editionId:'edition',duplicateGroup:'group',split:'test',image:'image.png',annotations:'labels.json',
    sha256:imageSha,language:'eng',script:'Latin',mapKind:'monochrome',source:{url:'https://example.test',license:'fixture'}};
  const manifest={schemaVersion:1,sheets:[sheet]};writeFileSync(corpus,JSON.stringify(manifest));
  const receipt={schemaVersion:1,trainingOnly:true,releaseApproved:false,lineageComplete:false,device:'cpu',checkpointSha256:sha('fixture checkpoint'),
    corpusSha256:'a'.repeat(64),optimizerUpdates:1};
  const save=()=>writeFileSync(checkpoint+'.receipt.json',JSON.stringify(receipt));save();
  const request={checkpoint,corpus,sourceId:'fixture',device:'cpu',torchLibrary:root};
  await assert.rejects(evaluateReviewedCheckpointSource(request),/ancestry/i);
  receipt.lineageComplete=true;receipt.lineage={schemaVersion:1,complete:true,sheets:[],parents:[]};save();
  await assert.rejects(evaluateReviewedCheckpointSource(request),/replay|ancestry/i);
  receipt.lineageComplete=false;delete receipt.lineage;save();
  await assert.rejects(evaluateReviewedCheckpointSource({...request,lineageReplay:{checkpoints:[]}}),/replay.*checkpoint/i);
  const incomplete=spawnSync(process.execPath,['tools/reference-analysis/native-evaluate-source.mjs','--checkpoint',checkpoint,'--corpus',corpus,
    '--output',join(root,'incomplete.json'),'--device','cpu','--torch-library',root,'--replay-checkpoint',checkpoint],{encoding:'utf8'});
  assert.notEqual(incomplete.status,0);assert.match(incomplete.stderr,/replay.*configuration/i);
  const protectedOutput=join(root,'protected.json');writeFileSync(protectedOutput,'keep');
  await assert.rejects(evaluateReviewedCheckpointCorpus({...request,output:protectedOutput}),/output already exists/i);
  assert.equal(readFileSync(protectedOutput,'utf8'),'keep');
  await assert.rejects(evaluateReviewedCheckpointCorpus({...request,output:join(root,'new.json')}),/supervision channels/i);
  receipt.unobservedMask=0;save();const baseline=join(root,'baseline.json');writeFileSync(baseline,'null');
  await assert.rejects(evaluateReviewedCheckpointCorpus({...request,output:join(root,'new.json'),baselineReport:baseline}),/baseline report object/i);
  manifest.sheets[0].split='train';writeFileSync(corpus,JSON.stringify(manifest));
  await assert.rejects(evaluateReviewedCheckpointSource({...request,diagnosticOnly:true}),/final-test/i);
  await assert.rejects(evaluateReviewedCheckpointCorpus({...request,output:join(root,'new.json')}),/final-test/i);
  receipt.optimizerUpdates=0;save();await assert.rejects(evaluateReviewedCheckpointSource(request),/checkpoint receipt/i);
  const weights=join(root,'weights.safetensors');writeFileSync(weights,'transferred fixture');
  writeFileSync(join(root,'transfer.json'),JSON.stringify({schemaVersion:1,trainingOnly:true,evaluationStatus:'pending',releaseApproved:false,
    transfer:'weights-only-no-optimizer',weightsSha256:sha('transferred fixture'),sourceCheckpointSha256:'b'.repeat(64)}));
  await assert.rejects(evaluateReviewedCheckpointSource({...request,checkpoint:undefined,weights}),/diagnostic-only/i);
  await assert.rejects(evaluateReviewedCheckpointSource({...request,weights,diagnosticOnly:true}),/choose one/i);
  writeFileSync(join(root,'transfer.json'),JSON.stringify({schemaVersion:1,trainingOnly:true,evaluationStatus:'pending',releaseApproved:false,
    transfer:'public-encoder-no-optimizer',weightsSha256:sha('transferred fixture'),tensorCount:340,randomSeed:20261022,
    encoderSourcePath:weights,encoderInitialization:{kind:'public-pretrained-image-classification',
      url:'https://download.pytorch.org/models/fake-00000000.pth',sha256:'0'.repeat(64),bytes:19}}));
  await assert.rejects(evaluateReviewedCheckpointSource({...request,checkpoint:undefined,weights,diagnosticOnly:true}),/weights receipt/i);
  writeFileSync(weights,'changed');
  await assert.rejects(evaluateReviewedCheckpointSource({...request,checkpoint:undefined,weights,diagnosticOnly:true}),/weights receipt/i);
  const controller=new AbortController();controller.abort();
  await assert.rejects(evaluateReviewedCheckpointSource(request,{signal:controller.signal}),{name:'AbortError'});
  assert.equal(readFileSync(checkpoint,'utf8'),'fixture checkpoint');
});
