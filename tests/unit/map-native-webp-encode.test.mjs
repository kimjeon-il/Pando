import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {decodeNativeImageBytes,encodeNativeWebpLossless,readNativeImage,readNativeRawWebp} from '../../tools/map-image/native-resample.mjs';

test('lossless WebP keeps every RGBA byte including transparent color',async t=>{
  const root=await mkdtemp(join(tmpdir(),'pando-webp-encode-'));t.after(()=>rm(root,{recursive:true}));
  const data=Buffer.from([12,34,56,0, 0,255,7,4, 80,40,20,128, 255,254,253,255,
    2,3,4,32, 90,100,110,64, 101,102,103,96, 54,55,56,127,
    220,30,90,250, 200,210,220,255, 33,44,55,20, 77,88,99,0]);
  const before=Buffer.from(data),image={width:4,height:3,data},encoded=await encodeNativeWebpLossless(image);
  assert.equal(encoded.data.subarray(0,4).toString(),'RIFF');assert.equal(encoded.data.subarray(8,12).toString(),'WEBP');
  const path=join(root,'result.webp');await writeFile(path,encoded.data);
  const raw=await readNativeRawWebp(encoded.data);assert.deepEqual(raw.data,data);
  await assert.rejects(readNativeRawWebp(encoded.data,{expectedSha256:'0'.repeat(64)}),/hash/i);
  await assert.rejects(readNativeRawWebp(encoded.data.subarray(0,encoded.data.length-10)),/webp|native/i);
  const opaque=Buffer.alloc(data.length);for(let i=0;i<data.length;i+=4){const alpha=data[i+3];
    for(let c=0;c<3;c++)opaque[i+c]=Math.floor((data[i+c]*alpha+255*(255-alpha)+127)/255);opaque[i+3]=255;}
  const decoded=await readNativeImage({path,format:'webp',maxPixels:256});assert.deepEqual(decoded.data,opaque);
  assert.deepEqual((await decodeNativeImageBytes({bytes:encoded.data,format:'webp',maxPixels:256})).data,opaque);
  assert.deepEqual(image.data,before);
});
test('lossless WebP rejects malformed inputs and cancellation',async()=>{
  await assert.rejects(encodeNativeWebpLossless({width:2,height:2,data:Buffer.alloc(3)}),/length/i);
  await assert.rejects(decodeNativeImageBytes({bytes:Buffer.alloc(0),format:'webp',maxPixels:256}),/source/i);
  const controller=new AbortController();controller.abort();
  await assert.rejects(encodeNativeWebpLossless({width:2,height:2,data:Buffer.alloc(16)},{signal:controller.signal}),/abort/i);
});
