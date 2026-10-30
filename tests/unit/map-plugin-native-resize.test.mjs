import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import test from 'node:test';
import {raster,resizeRaster} from '../../plugins/pando-map-tools/lib/raster.mjs';

test('map plugin resizes RGBA without starting its Python raster adapter',async()=>{
  process.env.PANDO_MAP_PYTHON=resolve('definitely-missing-python');
  const data=Buffer.alloc(7*5*4),alphas=[0,1,2,127,254,255];
  for(let y=0;y<5;y++)for(let x=0;x<7;x++)for(let c=0;c<4;c++)
    data[(y*7+x)*4+c]=c<3?(x*37+y*19+c*73+x*y*11)%256:alphas[(x+y*7)%6];
  const actual=await resizeRaster({width:7,height:5,data},[3,2]);
  assert.deepEqual(actual.data,readFileSync('tests/fixtures/map-image/rgba-7x5-to-3x2.raw'));
});

test('map plugin rotates RGBA pixels clockwise without Python',async()=>{
  process.env.PANDO_MAP_PYTHON=resolve('definitely-missing-python');
  const pixels=Buffer.from([1,2,3,0, 4,5,6,127, 7,8,9,255, 10,11,12,1, 13,14,15,254, 16,17,18,255]);
  for(const [degrees,width,height,order] of [[0,3,2,[0,1,2,3,4,5]],[90,2,3,[3,0,4,1,5,2]],
    [180,3,2,[5,4,3,2,1,0]],[270,2,3,[2,5,1,4,0,3]]]){
    const actual=await raster({action:'rotate',width:3,height:2,degrees},pixels);
    assert.deepEqual([actual.width,actual.height],[width,height]);
    assert.deepEqual(actual.data,Buffer.concat(order.map(i=>pixels.subarray(i*4,i*4+4))));
  }
  await assert.rejects(raster({action:'rotate',width:3,height:2,degrees:45},pixels),/rotation/i);
});
