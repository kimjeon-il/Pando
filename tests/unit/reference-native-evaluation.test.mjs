import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {evaluateBoundaries,boundaryAdmission,confounderNonregression} from '../../tools/reference-analysis/native-evaluation.mjs';

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
