import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import test from 'node:test';
import {resizeNativeRgba} from '../../tools/map-image/native-resample.mjs';

test('native map resize consumes real RGBA bytes and matches the original transparent pixels',async()=>{
  const data=Buffer.alloc(7*5*4),alphas=[0,1,2,127,254,255];
  for(let y=0;y<5;y++)for(let x=0;x<7;x++)for(let c=0;c<4;c++)
    data[(y*7+x)*4+c]=c<3?(x*37+y*19+c*73+x*y*11)%256:alphas[(x+y*7)%6];
  const original=Buffer.from(data);
  for(const [width,height] of [[3,2],[11,8],[130,4]]){
    const actual=await resizeNativeRgba({width:7,height:5,data},[width,height]);
    assert.equal(actual.width,width);assert.equal(actual.height,height);
    assert.deepEqual(actual.data,readFileSync(resolve(`tests/fixtures/map-image/rgba-7x5-to-${width}x${height}.raw`)));
  }
  assert.deepEqual(data,original);
});

test('native map resize rejects invalid dimensions, byte lengths and pre-cancelled work',async()=>{
  const image={width:1,height:1,data:Buffer.from([1,2,3,4])};
  for(const size of [[0,1],[16385,1],[4097,4097],[1.1,1]])await assert.rejects(resizeNativeRgba(image,size));
  await assert.rejects(resizeNativeRgba({...image,data:Buffer.alloc(3)},[1,1]),/length/i);
  const controller=new AbortController();controller.abort();
  await assert.rejects(resizeNativeRgba(image,[1,1],{signal:controller.signal}),/abort/i);
});
