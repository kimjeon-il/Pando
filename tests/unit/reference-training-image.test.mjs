import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {resizeNativeOpaqueBilinear} from '../../tools/map-image/native-resample.mjs';

test('training RGB bilinear resizing matches original Pillow pixels',async()=>{
  const cases=JSON.parse(readFileSync('tests/fixtures/map-image/bilinear-training.json','utf8'));
  for(const row of cases){
    const [width,height]=row.inputSize,[outWidth,outHeight]=row.outputSize;
    const actual=await resizeNativeOpaqueBilinear({width,height,data:Buffer.from(row.input,'base64')},[outWidth,outHeight]);
    assert.deepEqual(actual.data,Buffer.from(row.output,'base64'),`${width}x${height} -> ${outWidth}x${outHeight}`);
  }
});
test('training RGB bilinear rejects transparency',async()=>{
  await assert.rejects(resizeNativeOpaqueBilinear({width:1,height:1,data:Buffer.from([0,0,0,0])},[1,1]),/opaque/i);
});
