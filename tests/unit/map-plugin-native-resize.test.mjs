import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import test from 'node:test';
import {resizeRaster} from '../../plugins/pando-map-tools/lib/raster.mjs';

test('map plugin resizes RGBA without starting its Python raster adapter',async()=>{
  process.env.PANDO_MAP_PYTHON=resolve('definitely-missing-python');
  const data=Buffer.alloc(7*5*4),alphas=[0,1,2,127,254,255];
  for(let y=0;y<5;y++)for(let x=0;x<7;x++)for(let c=0;c<4;c++)
    data[(y*7+x)*4+c]=c<3?(x*37+y*19+c*73+x*y*11)%256:alphas[(x+y*7)%6];
  const actual=await resizeRaster({width:7,height:5,data},[3,2]);
  assert.deepEqual(actual.data,readFileSync('tests/fixtures/map-image/rgba-7x5-to-3x2.raw'));
});
