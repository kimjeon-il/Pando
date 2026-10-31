import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {auditNativeTrainingMask} from '../../tools/map-image/native-resample.mjs';
import {auditTrainingRasters} from '../../tools/reference-analysis/training-tiles.mjs';

const load=async name=>{const bytes=await readFile(`tests/fixtures/reference-training-raster/${name}.png`);
  return {bytes,sha256:createHash('sha256').update(bytes).digest('hex')};};
test('streaming training mask audit preserves all channel bits and source dimensions',async()=>{
  const small=await load('oriented-mask'),large=await load('large-valid'),adam=await load('large-valid-adam7');
  assert.deepEqual(await auditNativeTrainingMask(small),{width:3,height:2,observedBits:7});
  const expected={width:4097,height:4097,observedBits:3};
  assert.deepEqual(await auditNativeTrainingMask(large),expected);
  assert.deepEqual(await auditNativeTrainingMask(adam),expected);
  await assert.rejects(auditNativeTrainingMask({...small,sha256:'0'.repeat(64)}),/hash/i);
  await assert.rejects(auditNativeTrainingMask(await load('map')),/grayscale/i);
});
test('training raster audit rejects unobserved channels, bad dimensions and altered source hashes',async()=>{
  const small=await load('oriented-mask');
  const raster={path:'reference-training-raster/oriented-mask.png',sha256:small.sha256};
  const annotation={origin:'macro-vector-supervision',width:3,height:2,observedChannels:['international','administrative','coast'],raster,validRaster:raster};
  const check=changes=>auditTrainingRasters({root:'tests/fixtures',annotation:{...annotation,...changes}});
  await check({});
  await assert.rejects(check({observedChannels:['international','administrative']}),/unobserved/i);
  await assert.rejects(check({observedChannels:['international','international']}),/observed/i);
  await assert.rejects(check({width:2}),/dimensions/i);
  await assert.rejects(check({raster:{...raster,sha256:'0'.repeat(64)}}),/hash/i);
});
