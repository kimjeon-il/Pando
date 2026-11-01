import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import * as diagnostic from '../../tools/reference-analysis/native-diagnostic-preview.mjs';
import {corpusFingerprint} from '../../tools/reference-analysis/training-evidence.mjs';
const {diagnoseMacroTrainingSource,diagnoseReviewedSource,summarizeDiagnosticTile}=diagnostic;

test('combined checkpoint diagnostics require the original auxiliary corpus and lineage fingerprint',async t=>{
  const root=mkdtempSync(join(tmpdir(),'pando-diagnostic-combined-'));t.after(()=>rmSync(root,{recursive:true}));
  const corpus=join(root,'primary.json'),auxiliaryCorpus=join(root,'auxiliary.json'),checkpoint=join(root,'checkpoint.pt');
  writeFileSync(corpus,JSON.stringify({schemaVersion:1,trainingOnly:true,sheets:[]}));
  writeFileSync(auxiliaryCorpus,JSON.stringify({schemaVersion:1,trainingOnly:true,sheets:[]}));writeFileSync(checkpoint,'fixture');
  const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
  const receipt={schemaVersion:1,trainingOnly:true,releaseApproved:false,device:'cpu',checkpointSha256:hash(checkpoint),
    corpusSha256:hash(corpus),auxiliarySha256:hash(auxiliaryCorpus),lineageFingerprint:await corpusFingerprint(corpus,auxiliaryCorpus)};
  const save=()=>writeFileSync(checkpoint+'.receipt.json',JSON.stringify(receipt));save();
  const request={corpus,checkpoint,sourceId:'missing',device:'cpu',torchLibrary:root};
  await assert.rejects(diagnoseMacroTrainingSource(request),/auxiliary.*required/i);
  receipt.auxiliarySha256='0'.repeat(64);save();
  await assert.rejects(diagnoseMacroTrainingSource({...request,auxiliaryCorpus}),/auxiliary.*match/i);
  receipt.auxiliarySha256=hash(auxiliaryCorpus);receipt.lineageFingerprint='0'.repeat(64);save();
  await assert.rejects(diagnoseMacroTrainingSource({...request,auxiliaryCorpus}),/fingerprint/i);
  receipt.lineageFingerprint=await corpusFingerprint(corpus,auxiliaryCorpus);save();
  await assert.rejects(diagnoseMacroTrainingSource({...request,auxiliaryCorpus}),/unique.*source/i);
  await assert.rejects(diagnoseMacroTrainingSource({...request,auxiliaryCorpus,viewCorpus:'auxiliary'}),/unique.*auxiliary.*source/i);
  await assert.rejects(diagnostic.diagnoseTrainingCorpus({...request,auxiliaryCorpus,viewCorpus:'other',output:join(root,'output')}),/corpus view/i);
  await assert.rejects(diagnostic.diagnoseTrainingCorpus({...request,viewCorpus:'auxiliary',output:join(root,'output')}),/auxiliary.*required/i);
  writeFileSync(join(root,'image.png'),'fixture');writeFileSync(join(root,'label.json'),'{}');
  writeFileSync(auxiliaryCorpus,JSON.stringify({schemaVersion:1,trainingOnly:true,sheets:[{id:'selected',split:'train',image:'image.png',annotations:'label.json'}]}));
  receipt.auxiliarySha256=hash(auxiliaryCorpus);receipt.lineageFingerprint=await corpusFingerprint(corpus,auxiliaryCorpus);save();
  await assert.rejects(diagnostic.diagnoseTrainingCorpus({...request,auxiliaryCorpus,viewCorpus:'auxiliary',reviewCorpus:null,output:join(root,'output')}),/Semap training source/i);
  const cli=spawnSync(process.execPath,['tools/reference-analysis/native-diagnostic-preview.mjs','--corpus-sources','--corpus',corpus,
    '--auxiliary-corpus',auxiliaryCorpus,'--view-corpus','auxiliary','--checkpoint',checkpoint,'--output',join(root,'output'),
    '--device','cpu','--torch-library',root],{encoding:'utf8'});
  assert.notEqual(cli.status,0);assert.match(cli.stderr,/Semap training source/i);assert.equal(existsSync(join(root,'output')),false);
});

test('corpus diagnostics reject unsafe or duplicate sources and existing output',async t=>{
  assert.equal(typeof diagnostic.diagnoseTrainingCorpus,'function');
  const root=mkdtempSync(join(tmpdir(),'pando-diagnostic-corpus-'));t.after(()=>rmSync(root,{recursive:true}));
  const corpus=join(root,'corpus.json'),checkpoint=join(root,'checkpoint.pt'),output=join(root,'output');
  writeFileSync(checkpoint,'fixture');writeFileSync(output,'protected');
  const request={corpus,checkpoint,output,device:'cpu',torchLibrary:root,maximumPreviews:1};
  await assert.rejects(diagnostic.diagnoseTrainingCorpus(request),/exist/i);
  assert.equal(readFileSync(output,'utf8'),'protected');
  writeFileSync(corpus,JSON.stringify({trainingOnly:true,sheets:[{id:'same'},{id:'same'}]}));
  await assert.rejects(diagnostic.diagnoseTrainingCorpus({...request,output:join(root,'new')}),/unique/i);
  writeFileSync(corpus,JSON.stringify({trainingOnly:true,sheets:[{id:'../escape'}]}));
  await assert.rejects(diagnostic.diagnoseTrainingCorpus({...request,output:join(root,'new')}),/source|identifier/i);
  const cli=spawnSync(process.execPath,['tools/reference-analysis/native-diagnostic-preview.mjs','--corpus-sources','--corpus',corpus,
    '--checkpoint',checkpoint,'--output',join(root,'new'),'--device','cpu','--torch-library',root],{encoding:'utf8'});
  assert.notEqual(cli.status,0);assert.match(cli.stderr,/source|identifier/i);
  writeFileSync(corpus,JSON.stringify({trainingOnly:true,sheets:[{id:'지도_1'}]}));
  await assert.rejects(diagnostic.diagnoseTrainingCorpus({...request,output:join(root,'new')}),{code:'ENOENT'});
  const controller=new AbortController();controller.abort();
  await assert.rejects(diagnostic.diagnoseTrainingCorpus({...request,output:join(root,'new')},{signal:controller.signal}),{name:'AbortError'});
  assert.equal(existsSync(join(root,'new')),false);
});

test('corpus diagnostics skip reviewed sources with no supervised pixels',async t=>{
  const root=mkdtempSync(join(tmpdir(),'pando-diagnostic-empty-'));t.after(()=>rmSync(root,{recursive:true}));
  mkdirSync(join(root,'sources'));mkdirSync(join(root,'labels'));
  const image=readFileSync('tests/fixtures/map-image/png-read/orientation-6.png'),hash=value=>createHash('sha256').update(value).digest('hex');
  writeFileSync(join(root,'sources/map.png'),image);
  const annotation={schemaVersion:1,reviewed:true,width:9,height:12,known:{international:[]},lines:[],ignore:[],
    review:{kind:'agent',reviewer:'fixture',reviewedAt:'2026-10-30T00:00:00Z',sourceSha256:hash(image),predictionBlind:true}};
  writeFileSync(join(root,'labels/map.json'),JSON.stringify(annotation));
  const sheet={id:'empty',familyId:'family',editionId:'edition',duplicateGroup:'group',split:'train',image:'sources/map.png',
    annotations:'labels/map.json',sha256:hash(image),language:'fas',script:'Arabic',mapKind:'monochrome',source:{url:'https://example.org',license:'fixture'}};
  const corpus=join(root,'corpus.json'),checkpoint=join(root,'checkpoint.pt'),output=join(root,'output');
  writeFileSync(corpus,JSON.stringify({schemaVersion:1,sheets:[sheet]}));writeFileSync(checkpoint,'checkpoint');
  writeFileSync(checkpoint+'.receipt.json',JSON.stringify({schemaVersion:1,trainingOnly:true,releaseApproved:false,device:'cpu',
    checkpointSha256:hash('checkpoint'),corpusSha256:hash(readFileSync(corpus))}));
  const request={corpus,checkpoint,sourceId:'empty',device:'cpu',torchLibrary:root};
  await assert.rejects(diagnoseMacroTrainingSource(request),/no supervised/i);
  const result=await diagnostic.diagnoseTrainingCorpus({...request,output});
  assert.deepEqual(result.sheets,[]);assert.equal(result.independentEvaluation,false);assert.equal(result.onnxParityVerified,false);
  assert.deepEqual(JSON.parse(readFileSync(join(output,'diagnostics.json'),'utf8')).sheets,[]);
  assert.equal(existsSync(join(output,'tile.f32')),false);
  const auxiliaryCorpus=join(root,'auxiliary.json');writeFileSync(auxiliaryCorpus,JSON.stringify({schemaVersion:1,trainingOnly:true,sheets:[]}));
  const lineageFingerprint=await corpusFingerprint(corpus,auxiliaryCorpus);
  writeFileSync(checkpoint+'.receipt.json',JSON.stringify({schemaVersion:1,trainingOnly:true,releaseApproved:false,device:'cpu',
    checkpointSha256:hash('checkpoint'),corpusSha256:hash(readFileSync(corpus)),auxiliarySha256:hash(readFileSync(auxiliaryCorpus)),lineageFingerprint}));
  const combined=await diagnostic.diagnoseTrainingCorpus({...request,auxiliaryCorpus,output:join(root,'combined')});
  assert.deepEqual(combined.sheets,[]);assert.equal(combined.lineageFingerprint,lineageFingerprint);
});

test('diagnostic tile joins native probabilities, known masks, statistics and overlays',async()=>{
  const width=4,height=1,values=width*height*7,original=Buffer.alloc(width*height*3,255);
  const probability=Buffer.alloc(values*4),target=Buffer.alloc(values*4),valid=Buffer.alloc(values*4),baseline=Buffer.alloc(values*4);
  probability.writeFloatLE(.55,4);probability.writeFloatLE(.9,12);
  target.writeFloatLE(1,4);target.writeFloatLE(1,8);
  valid.writeFloatLE(1,4);valid.writeFloatLE(1,12);
  const options={width,height,original,probability,target,valid,baseline};
  const result=await summarizeDiagnosticTile(options);
  assert.deepEqual(result.channels.international,{supervisedPixels:2,targetPixels:1,predictedPixels:2,overlapPixels:1,
    probabilityMin:0,probabilityMax:Math.fround(.9)});
  assert.equal(result.baselineChannels.international.predictedPixels,0);
  assert.equal(result.panels.length,3);
  assert.deepEqual([...result.panels[0].subarray(3,6)],[243,67,67]);
  assert.deepEqual([...result.panels[1].subarray(3,6)],[255,255,255]);
  assert.deepEqual([...result.panels[2].subarray(9,12)],[243,67,67]);
  assert.equal(result.independentEvaluation,false);assert.equal(result.releaseApproved,false);
  await assert.rejects(summarizeDiagnosticTile({...options,target:Buffer.alloc(1)}),/dimensions/i);
  const bad=Buffer.from(probability);bad.writeFloatLE(NaN,0);
  await assert.rejects(summarizeDiagnosticTile({...options,probability:bad}),/invalid tensor/i);
  const invalid=Buffer.from(baseline);invalid.writeFloatLE(1.1,0);
  await assert.rejects(summarizeDiagnosticTile({...options,baseline:invalid}),/invalid tensor/i);
  await assert.rejects(summarizeDiagnosticTile({...options,baseline:null}),/dimensions/i);
  const controller=new AbortController();controller.abort();
  await assert.rejects(summarizeDiagnosticTile(options,{signal:controller.signal}),{name:'AbortError'});
});

test('macro diagnostics refuse a checkpoint for a different corpus before execution',async t=>{
  const folder=mkdtempSync(join(tmpdir(),'pando-diagnostic-scope-'));t.after(()=>rmSync(folder,{recursive:true}));
  const corpus=join(folder,'corpus.json'),checkpoint=join(folder,'checkpoint.pt');
  writeFileSync(corpus,'{}');writeFileSync(checkpoint,'fixture');
  const hash=value=>createHash('sha256').update(value).digest('hex');
  const receipt={schemaVersion:1,trainingOnly:true,releaseApproved:false,device:'cpu',checkpointSha256:hash('fixture'),corpusSha256:'0'.repeat(64)};
  writeFileSync(checkpoint+'.receipt.json',JSON.stringify(receipt));
  const request={corpus,checkpoint,sourceId:'fixture',device:'cpu',torchLibrary:folder};
  await assert.rejects(diagnoseMacroTrainingSource(request),/does not match/i);
  receipt.corpusSha256=hash('{}');writeFileSync(checkpoint+'.receipt.json',JSON.stringify(receipt));
  const weights=join(folder,'weights.safetensors');writeFileSync(weights,'other initializer');
  await assert.rejects(diagnoseMacroTrainingSource({...request,baselineWeights:weights}),/checkpoint initializer/i);
  receipt.initializationWeightsSha256='0'.repeat(64);writeFileSync(checkpoint+'.receipt.json',JSON.stringify(receipt));
  await assert.rejects(diagnoseMacroTrainingSource({...request,baselineWeights:weights}),/checkpoint initializer/i);
  await assert.rejects(diagnoseMacroTrainingSource(request),/schemaVersion|training-only corpus/i);
  const cli=spawnSync(process.execPath,['tools/reference-analysis/native-diagnostic-preview.mjs','--macro-source','--corpus',corpus,
    '--source','fixture','--checkpoint',checkpoint,'--output',folder,'--device','cpu','--torch-library',folder],{encoding:'utf8'});
  assert.notEqual(cli.status,0);assert.match(cli.stderr,/output exists/i);
  const output=join(folder,'new-diagnostic');
  const wrongBaseline=spawnSync(process.execPath,['tools/reference-analysis/native-diagnostic-preview.mjs','--macro-source','--corpus',corpus,
    '--source','fixture','--checkpoint',checkpoint,'--baseline-weights',weights,'--output',output,'--device','cpu','--torch-library',folder],{encoding:'utf8'});
  assert.notEqual(wrongBaseline.status,0);assert.match(wrongBaseline.stderr,/checkpoint initializer/i);assert.equal(existsSync(output),false);
});

test('reviewed diagnostics refuse mismatched checkpoint and missing source without outputs',async t=>{
  const root=mkdtempSync(join(tmpdir(),'pando-reviewed-diagnostic-'));t.after(()=>rmSync(root,{recursive:true}));
  const corpus=join(root,'training.json'),reviewCorpus=join(root,'review.json'),checkpoint=join(root,'checkpoint.pt');
  writeFileSync(corpus,'{}');writeFileSync(reviewCorpus,JSON.stringify({schemaVersion:1,sheets:[]}));writeFileSync(checkpoint,'fixture');
  const sha=value=>createHash('sha256').update(value).digest('hex');
  const receipt={schemaVersion:1,trainingOnly:true,releaseApproved:false,device:'cpu',checkpointSha256:sha('fixture'),corpusSha256:'0'.repeat(64)};
  writeFileSync(checkpoint+'.receipt.json',JSON.stringify(receipt));
  const request={corpus,reviewCorpus,checkpoint,sourceId:'missing',device:'cpu',torchLibrary:root};
  await assert.rejects(diagnoseReviewedSource(request),/does not match/i);
  receipt.corpusSha256=sha('{}');writeFileSync(checkpoint+'.receipt.json',JSON.stringify(receipt));
  await assert.rejects(diagnoseReviewedSource(request),/unique.*source/i);
  writeFileSync(reviewCorpus,JSON.stringify({schemaVersion:1,sheets:[{id:'missing'},{id:'missing'}]}));
  await assert.rejects(diagnoseReviewedSource(request),/unique.*source/i);
  const controller=new AbortController();controller.abort();
  await assert.rejects(diagnoseReviewedSource(request,{signal:controller.signal}),{name:'AbortError'});
  const output=join(root,'new-output');
  const cli=spawnSync(process.execPath,['tools/reference-analysis/native-diagnostic-preview.mjs','--reviewed-source','--corpus',corpus,
    '--review-corpus',reviewCorpus,'--source','missing','--checkpoint',checkpoint,'--output',output,'--device','cpu','--torch-library',root],{encoding:'utf8'});
  assert.notEqual(cli.status,0);assert.equal(existsSync(output),false);
});
