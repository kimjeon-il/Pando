import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {existsSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {diagnoseMacroTrainingSource,diagnoseReviewedSource,summarizeDiagnosticTile} from '../../tools/reference-analysis/native-diagnostic-preview.mjs';

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
  await assert.rejects(diagnoseMacroTrainingSource(request),/training-only corpus/i);
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
