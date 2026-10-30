import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import test from 'node:test';
import {reviewMasks} from '../../tools/reference-analysis/review-masks.mjs';

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
