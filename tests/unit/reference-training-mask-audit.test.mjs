import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {auditNativeTrainingMask} from '../../tools/map-image/native-resample.mjs';

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
