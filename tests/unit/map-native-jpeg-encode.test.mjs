import assert from 'node:assert/strict';
import test from 'node:test';
import {decodeNativeImageBytes,encodeNativeJpeg} from '../../tools/map-image/native-resample.mjs';

test('native diagnostic JPEG encodes opaque pixels and refuses alpha loss',async()=>{
  const width=16,height=16,data=Buffer.alloc(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const at=(y*width+x)*4;data[at]=data[at+1]=data[at+2]=y*16;data[at+3]=255;
  }
  const encoded=await encodeNativeJpeg({width,height,data});
  assert.equal(encoded.data.readUInt16BE(0),0xffd8);
  const decoded=await decodeNativeImageBytes({bytes:encoded.data,format:'jpeg',rect:{x:0,y:0,width,height},maxPixels:256});
  assert.deepEqual([decoded.width,decoded.height],[width,height]);
  for(let i=0;i<data.length;i+=4){for(let c=0;c<3;c++)assert.ok(Math.abs(decoded.data[i+c]-data[i+c])<=3);assert.equal(decoded.data[i+3],255);}
  const transparent=Buffer.from(data);transparent[3]=254;
  await assert.rejects(encodeNativeJpeg({width,height,data:transparent}),/opaque/i);
});
