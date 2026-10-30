import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {convertNativeSemapLabels,encodeNativeGrayPng,readNativeTrainingMask} from '../../tools/map-image/native-resample.mjs';

test('Semap conversion preserves only reviewed water and road classes',async()=>{
  const labels={width:6,height:1,data:Buffer.from([0,1,2,3,4,5])};const before=Buffer.from(labels.data);
  const converted=await convertNativeSemapLabels(labels);
  assert.deepEqual(converted.target.data,Buffer.from([0,0,0,0,8,16]));
  assert.deepEqual(converted.known.data,Buffer.from([0,0,24,24,24,24]));
  assert.equal(converted.informative,true);assert.deepEqual(labels.data,before);
  for(const plane of [converted.target,converted.known]){
    const png=await encodeNativeGrayPng(plane),sha=createHash('sha256').update(png).digest('hex');
    assert.deepEqual((await readNativeTrainingMask(png,sha)).data,plane.data);
  }
  await assert.rejects(convertNativeSemapLabels({width:1,height:1,data:Buffer.from([7])}),/class/i);
  assert.equal((await convertNativeSemapLabels({width:1,height:1,data:Buffer.from([3])})).informative,false);
});
