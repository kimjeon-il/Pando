import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import test from 'node:test';
import {raster} from '../../plugins/pando-map-tools/lib/raster.mjs';

test('native JPEG input matches original pixels and mapping for color, orientation and crop',async()=>{
  process.env.PANDO_MAP_PYTHON=resolve('definitely-missing-python');
  const root=resolve('tests/fixtures/map-image/jpeg-read');
  for(const name of ['rgb','progressive','orientation-2','orientation-3','orientation-4','orientation-5','orientation-6','orientation-7','orientation-8','gray','cmyk','crop-resize']){
    const path=resolve(root,name+'.jpg'),before=readFileSync(path),oracle=JSON.parse(readFileSync(resolve(root,name+'.json'),'utf8'));
    const {data,...metadata}=await raster({...oracle.request,path});
    assert.deepEqual(metadata,oracle.expected,name+' metadata');
    assert.deepEqual(data,readFileSync(resolve(root,name+'.rgba')),name+' pixels');
    assert.deepEqual(readFileSync(path),before,name+' original');
  }
});

test('native JPEG input rejects bad rectangle and budget values',async()=>{
  process.env.PANDO_MAP_PYTHON=resolve('definitely-missing-python');
  const path=resolve('tests/fixtures/map-image/jpeg-read/rgb.jpg');
  await assert.rejects(raster({action:'read',path,maxPixels:255}),/budget/i);
  await assert.rejects(raster({action:'read',path,maxPixels:256,rect:{x:10,y:0,width:3,height:3}}),/bounds|rectangle/i);
});
