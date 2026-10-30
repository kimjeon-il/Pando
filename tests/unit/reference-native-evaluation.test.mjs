import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {evaluateBoundaries,evaluateBoundariesTiled,evaluateIndependentSheet,boundaryAdmission,confounderNonregression,summarizeEvaluation} from '../../tools/reference-analysis/native-evaluation.mjs';
import {buildTrainingLineage} from '../../tools/reference-analysis/training-lineage.mjs';

function annotation(kind='international',width=1){
  const known={};for(const k of ['international','administrative','coast','text'])known[k]=[[[0,0],[19,0],[19,19],[0,19]]];
  return {width:20,height:20,known,lines:[{kind,width,points:[[3,5],[16,5]]}],regions:[{kind:'text',polygon:[[3,3],[16,3],[16,12],[3,12]]}],ignore:[]};
}
function prediction(channel,y){const out=Buffer.alloc(400);for(let x=3;x<=16;x++)out[y*20+x]|=1<<channel;return out;}
test('native evaluation matches Python oracle for all channels and confounders',async()=>{
  const annotation=JSON.parse(readFileSync('tests/fixtures/reference-review-mask/full.json','utf8')).annotation;
  const oracle=JSON.parse(readFileSync('tests/fixtures/reference-review-mask/evaluation.json','utf8'));
  const actual=await evaluateBoundaries(Buffer.from(oracle.predictionBase64,'base64'),annotation);
  assert.deepEqual(actual,{counts:oracle.counts,metrics:oracle.metrics,confounders:oracle.confounders});
});
test('evaluation streams preserve native sheet metrics and group admission',()=>{
  const annotation=JSON.parse(readFileSync('tests/fixtures/reference-review-mask/full.json','utf8')).annotation;
  const oracle=JSON.parse(readFileSync('tests/fixtures/reference-review-mask/evaluation.json','utf8'));
  const packed=Buffer.from(oracle.predictionBase64,'base64'),planes=Buffer.alloc(packed.length*3);
  for(let i=0;i<packed.length;i++)for(let c=0;c<3;c++)planes[c*packed.length+i]=(packed[i]>>c)&1;
  const json=Buffer.from(JSON.stringify(annotation)),header=Buffer.alloc(4);header.writeUInt32BE(json.length);
  const args=['tools/reference-analysis/native-evaluation.mjs','--sheet-stream'];
  const result=spawnSync(process.execPath,args,{input:Buffer.concat([header,json,planes]),encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);const actual=JSON.parse(result.stdout);
  assert.deepEqual(actual,{counts:oracle.counts,metrics:oracle.metrics,confounders:oracle.confounders});
  const input={groups:{fixture:[actual.counts]},perSheet:{sheet:actual.metrics},confounders:{sheet:actual.confounders},baseline:null,requiredChannels:[]};
  const summary=spawnSync(process.execPath,['tools/reference-analysis/native-evaluation.mjs','--summary-stream'],{input:JSON.stringify(input),encoding:'utf8'});
  assert.equal(summary.status,0,summary.stderr);assert.deepEqual(JSON.parse(summary.stdout),summarizeEvaluation(input));
  assert.throws(()=>summarizeEvaluation({...input,groups:{fixture:[[[2,1,0,0],[0,0,0,0],[0,0,0,0]]]}}),/counts/i);
  const bad=Buffer.from(planes);bad[0]=2;
  const rejected=spawnSync(process.execPath,args,{input:Buffer.concat([header,json,bad]),encoding:'utf8'});
  assert.notEqual(rejected.status,0);assert.match(rejected.stderr,/binary/i);
});
test('native evaluation ignores predictions in unknown channel regions',async()=>{
  const label={width:24,height:16,known:{international:[[[0,0],[23,0],[23,9],[0,9]]],text:[[[0,0],[23,0],[23,9],[0,9]]]},
    lines:[{kind:'international',points:[[3,5],[20,5]],width:1}],regions:[{kind:'text',polygon:[[8,3],[12,3],[12,7],[8,7]]}],ignore:[]};
  const packed=Buffer.alloc(24*16,2);for(let x=3;x<=20;x++)packed[5*24+x]|=1;for(let x=0;x<24;x++)packed[12*24+x]|=1;
  const result=await evaluateBoundaries(packed,label);
  assert.deepEqual(result.counts[0],[18,18,18,18]);assert.deepEqual(result.counts[1],[0,0,0,0]);
});
test('bounded evaluation windows preserve line tolerance and confounders at their seams',async()=>{
  const width=2052,height=8,annotation={width,height,known:{international:[[[0,0],[2051,0],[2051,7],[0,7]]],text:[[[1015,0],[1035,0],[1035,7],[1015,7]]]},
    lines:[{kind:'international',width:3,points:[[0.5,4.2],[2051,4.2]]}],regions:[{kind:'text',polygon:[[1015,0],[1035,0],[1035,7],[1015,7]]}],ignore:[]};
  const prediction=Buffer.alloc(width*height);for(let x=0;x<width;x++){prediction[4*width+x]=1;if(x>=1015&&x<=1035)prediction[x]=1;}
  assert.deepEqual(await evaluateBoundariesTiled(prediction,annotation),await evaluateBoundaries(prediction,annotation));
});
test('bounded evaluation supports sources wider than one native window',async()=>{
  const width=16385,height=2,annotation={width,height,known:{international:[[[0,0],[16384,0],[16384,1],[0,1]]]},
    lines:[{kind:'international',width:1,points:[[0,1],[16384,1]]}],regions:[],ignore:[]};
  const prediction=Buffer.alloc(width*height);prediction.fill(1,width);
  const result=await evaluateBoundariesTiled(prediction,annotation);
  assert.deepEqual(result.counts[0],[width,width,width,width]);
});
test('native original-pixel evaluation keeps tolerance, known masks, and confounder scope',async()=>{
  const near=await evaluateBoundaries(prediction(0,7),annotation());
  assert.deepEqual(near.counts[0],[14,14,14,14]);
  const far=await evaluateBoundaries(prediction(0,8),annotation());
  assert.deepEqual(far.counts[0],[0,14,0,14]);
  const wide=await evaluateBoundaries(prediction(2,9),annotation('coast',8));
  assert.deepEqual(wide.counts[2],[14,14,14,14]);
  const ignored=annotation();ignored.ignore=[[[0,7],[19,7],[19,19],[0,19]]];
  assert.deepEqual((await evaluateBoundaries(prediction(0,8),ignored)).counts[0],[0,0,0,14]);
  const good=await evaluateBoundaries(prediction(0,5),annotation());
  const bad=await evaluateBoundaries(prediction(0,11),annotation());
  assert.equal(good.confounders.text.international.falsePositive,0);
  assert.equal(bad.confounders.text.international.falsePositive,14);
  assert.equal(confounderNonregression({map:bad.confounders},{map:good.confounders}).passed,false);
  assert.equal(confounderNonregression({map:good.confounders},{map:bad.confounders}).passed,true);
});
test('admission retains per-map, macro and independent-evidence gates',async()=>{
  const result=await evaluateBoundaries(prediction(0,5),annotation());
  const strong=structuredClone(result.metrics);strong.international={precision:.99,recall:.9,matchedPrediction:99,predicted:100,matchedReference:90,reference:100};
  const weak=structuredClone(strong);weak.international.precision=.8;
  assert.equal(boundaryAdmission({one:strong,two:strong}).passed,true);
  assert.equal(boundaryAdmission({one:strong,two:strong}).macro.coast.precision,null);
  assert.equal(boundaryAdmission({one:strong,two:weak}).passed,false);
  assert.equal(boundaryAdmission({}, {requiredChannels:['international']}).passed,false);
  const noTruth=structuredClone(strong);noTruth.international={precision:null,recall:null,matchedPrediction:0,predicted:0,matchedReference:0,reference:0};
  assert.equal(boundaryAdmission({empty:noTruth}).passed,false);
  noTruth.international.predicted=1;
  assert.ok(boundaryAdmission({empty:noTruth}).failures.some(row=>row.reason==='false-positive-in-known-negative-area'));
  assert.equal(confounderNonregression({map:result.confounders},null).passed,false);
  const zero={text:{international:{falsePositive:0,pixels:0,rate:null}}};
  const measured={text:{international:{falsePositive:0,pixels:10,rate:0}}};
  assert.equal(confounderNonregression({map:zero},{map:zero}).passed,false);
  assert.equal(confounderNonregression({map:measured},{map:zero}).passed,false);
  assert.equal(confounderNonregression({map:measured},{map:{}}).passed,false);
  await assert.rejects(evaluateBoundaries(Buffer.alloc(1),annotation()),/prediction/i);
});
test('independent native evaluation refuses exposure to training ancestry',async()=>{
  const sheet={id:'train',sha256:'a'.repeat(64),familyId:'family',editionId:'edition',duplicateGroup:'group',split:'train'};
  const lineage=buildTrainingLineage([sheet]);
  const leaked={...sheet,id:'different',sha256:'b'.repeat(64),split:'test'};
  await assert.rejects(evaluateIndependentSheet(prediction(0,5),annotation(),{sheet:leaked,lineage}),/familyId/);
  const independent={id:'test',sha256:'c'.repeat(64),familyId:'other',editionId:'other',duplicateGroup:'other',split:'test'};
  const reviewed={...annotation(),schemaVersion:1,reviewed:true,review:{kind:'human',reviewer:'reviewer',reviewedAt:'2026-10-30T00:00:00Z',sourceSha256:independent.sha256,predictionBlind:true}};
  const result=await evaluateIndependentSheet(prediction(0,5),reviewed,{sheet:independent,lineage});
  assert.deepEqual(result.counts[0],[14,14,14,14]);
  await assert.rejects(evaluateIndependentSheet(prediction(0,5),{...reviewed,review:{...reviewed.review,sourceSha256:'d'.repeat(64)}},{sheet:independent,lineage}),/source hash/i);
  await assert.rejects(evaluateIndependentSheet(prediction(0,5),{...reviewed,reviewed:false},{sheet:independent,lineage}),/source.reviewed/i);
});
