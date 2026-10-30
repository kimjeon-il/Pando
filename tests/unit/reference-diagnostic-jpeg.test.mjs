import assert from 'node:assert/strict';
import test from 'node:test';
import {renderDiagnosticJpeg} from '../../tools/reference-analysis/native-diagnostic-preview.mjs';
import {decodeNativeImageBytes} from '../../tools/map-image/native-resample.mjs';

test('diagnostic JPEG contains titled input, target and prediction panels',async()=>{
  const pixels=512*512,original=Buffer.alloc(pixels*3,255),target=Buffer.alloc(pixels*3),predicted=Buffer.alloc(pixels*3);
  for(let i=0;i<pixels;i++){target[i*3]=240;predicted[i*3+1]=200;}
  const result=await renderDiagnosticJpeg({original,panels:[target,predicted]});
  assert.deepEqual([result.width,result.height],[1536,540]);
  const image=await decodeNativeImageBytes({bytes:result.data,format:'jpeg',maxPixels:1536*540});
  assert.deepEqual([image.width,image.height],[1536,540]);
  const pixel=(x,y)=>[...image.data.subarray((y*image.width+x)*4,(y*image.width+x)*4+3)];
  assert.ok(pixel(100,100).every(value=>value>=250));
  assert.ok(pixel(612,100)[0]>230&&pixel(612,100)[1]<10);
  assert.ok(pixel(1124,100)[1]>190&&pixel(1124,100)[0]<10);
  let dark=0;for(let y=0;y<28;y++)for(let x=0;x<1536;x++)if(pixel(x,y)[0]<100)dark++;
  assert.ok(dark>20,'caption text is visible');
  const withBaseline=await renderDiagnosticJpeg({original,panels:[target,original,predicted]});
  assert.deepEqual([withBaseline.width,withBaseline.height],[2048,540]);
  await assert.rejects(renderDiagnosticJpeg({original,panels:[target]}),/panels/i);
});
