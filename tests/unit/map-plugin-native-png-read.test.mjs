import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import test from 'node:test';
import {raster} from '../../plugins/pando-map-tools/lib/raster.mjs';

test('native PNG input preserves original mapping and pixels across colors, alpha, EXIF and crop',async()=>{
  process.env.PANDO_MAP_PYTHON=resolve('definitely-missing-python');
  const root=resolve('tests/fixtures/map-image/png-read');
  for(const name of ['rgba','rgb','orientation-2','orientation-5','orientation-6','orientation-8','palette-alpha','gray1','gray16','crop-resize']){
    const path=resolve(root,name+'.png'),before=readFileSync(path),oracle=JSON.parse(readFileSync(resolve(root,name+'.json'),'utf8'));
    const actual=await raster({...oracle.request,path});const {data,...metadata}=actual;
    assert.deepEqual(metadata,oracle.expected,name+' metadata');
    assert.deepEqual(data,readFileSync(resolve(root,name+'.rgba')),name+' pixels');
    assert.deepEqual(readFileSync(path),before,name+' original');
  }
});

test('native PNG input rejects bad rectangles, budgets and missing files',async()=>{
  process.env.PANDO_MAP_PYTHON=resolve('definitely-missing-python');
  const path=resolve('tests/fixtures/map-image/png-read/rgba.png');
  await assert.rejects(raster({action:'read',path,maxPixels:255}),/budget/i);
  await assert.rejects(raster({action:'read',path,maxPixels:256,rect:{x:10,y:0,width:3,height:3}}),/bounds|rectangle/i);
  await assert.rejects(raster({action:'read',path:path+'.missing',maxPixels:256}));
});
