import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {encodeNativeWebpLossless,readNativeImage} from '../../tools/map-image/native-resample.mjs';

test('lossless WebP keeps every RGBA byte including transparent color',async t=>{
  const root=await mkdtemp(join(tmpdir(),'pando-webp-encode-'));t.after(()=>rm(root,{recursive:true}));
  const data=Buffer.from([12,34,56,0, 0,255,7,4, 80,40,20,128, 255,254,253,255,
    2,3,4,32, 90,100,110,64, 101,102,103,96, 54,55,56,127,
    220,30,90,250, 200,210,220,255, 33,44,55,20, 77,88,99,0]);
  const image={width:4,height:3,data},encoded=await encodeNativeWebpLossless(image);
  assert.equal(encoded.data.subarray(0,4).toString(),'RIFF');assert.equal(encoded.data.subarray(8,12).toString(),'WEBP');
  const path=join(root,'result.webp');await writeFile(path,encoded.data);
  const decoded=await readNativeImage({path,format:'webp',maxPixels:256});assert.deepEqual(decoded.data,data);
  assert.deepEqual(image.data,data);
});
test('lossless WebP rejects malformed inputs and cancellation',async()=>{
  await assert.rejects(encodeNativeWebpLossless({width:2,height:2,data:Buffer.alloc(3)}),/length/i);
  const controller=new AbortController();controller.abort();
  await assert.rejects(encodeNativeWebpLossless({width:2,height:2,data:Buffer.alloc(16)},{signal:controller.signal}),/abort/i);
});
