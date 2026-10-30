import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {resizeNativeOpaqueBilinear,applyNativeTrainingScan} from '../../tools/map-image/native-resample.mjs';

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
test('full training scan augmentation matches Python pixels and repeats for the same tile',async()=>{
  const fixture=JSON.parse(readFileSync('tests/fixtures/map-image/training-scan.json','utf8'));
  const input={width:fixture.width,height:fixture.height,data:Buffer.from(fixture.input,'base64')};
  for(const row of fixture.cases){
    const result=await applyNativeTrainingScan(input,{epoch:row.epoch,index:row.index});
    assert.deepEqual(result.data,Buffer.from(row.output,'base64'),`epoch ${row.epoch} tile ${row.index}`);
  }
  await assert.rejects(applyNativeTrainingScan(input,{epoch:-1,index:0}),/epoch/i);
  const transparent={...input,data:Buffer.from(input.data)};transparent.data[3]=0;
  await assert.rejects(applyNativeTrainingScan(transparent,{epoch:0,index:0}),/opaque/i);
});
