import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import test from 'node:test';
import {reviewMasks,validateReviewedAnnotation} from '../../tools/reference-analysis/review-masks.mjs';

test('native reviewed masks match original known, overlap, ignore, and padded-window pixels',async()=>{
  const root=resolve('tests/fixtures/reference-review-mask');
  for(const name of ['full','crop','padded']){
    const fixture=JSON.parse(readFileSync(resolve(root,name+'.json'),'utf8'));
    const expected=readFileSync(resolve(root,name+'.bin'));
    const result=await reviewMasks(fixture.annotation,{window:fixture.window});
    assert.deepEqual([result.width,result.height],fixture.size,name+' dimensions');
    assert.equal(Buffer.compare(Buffer.concat([result.targetBits,result.knownBits]),expected),0,name+' mask pixels');
  }
});

test('review masks reject missing known regions, unknown classes and invalid windows',async()=>{
  const fixture=JSON.parse(readFileSync('tests/fixtures/reference-review-mask/full.json','utf8'));
  const missing=structuredClone(fixture.annotation);delete missing.known;
  await assert.rejects(reviewMasks(missing),/known/i);
  const unknown=structuredClone(fixture.annotation);unknown.known.nonexistent=[];
  await assert.rejects(reviewMasks(unknown),/class/i);
  await assert.rejects(reviewMasks(fixture.annotation,{window:[0,0,0,4]}),/window|dimensions/i);
  await assert.rejects(reviewMasks(fixture.annotation,{signal:AbortSignal.abort()}),error=>error.name==='AbortError');
});
test('large original dimensions validate in bounded windows across tile boundaries',async()=>{
  const hash='a'.repeat(64),annotation={schemaVersion:1,reviewed:true,width:16385,height:2,
    review:{kind:'human',reviewer:'fixture',reviewedAt:'2026-10-30T00:00:00Z',sourceSha256:hash,predictionBlind:true},
    known:{international:[[[0,0],[16384,0],[16384,1],[0,1]]]},lines:[{kind:'international',width:1,points:[[0,1],[16384,1]]}]};
  await assert.doesNotReject(validateReviewedAnnotation(annotation,{sha256:hash}));
  annotation.known.international=[[[0,0],[16383,0],[16383,1],[0,1]]];
  await assert.rejects(validateReviewedAnnotation(annotation,{sha256:hash}),/outside explicitly known/i);
});
