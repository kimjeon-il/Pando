import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import test from 'node:test';
import {raster} from '../../plugins/pando-map-tools/lib/raster.mjs';

test('native WebP input preserves original pixels and EXIF-oriented mapping',async()=>{
  process.env.PANDO_MAP_PYTHON=resolve('definitely-missing-python');
  const root=resolve('tests/fixtures/map-image/webp-read');
  for(const name of ['rgb','rgba','lossy-alpha','animated','orientation-2','orientation-3','orientation-4','orientation-5','orientation-6','orientation-7','orientation-8','crop-resize']){
    const path=resolve(root,name+'.webp'),before=readFileSync(path),oracle=JSON.parse(readFileSync(resolve(root,name+'.json'),'utf8'));
    const {data,...metadata}=await raster({...oracle.request,path});
    assert.deepEqual(metadata,oracle.expected,name+' metadata');
    assert.deepEqual(data,readFileSync(resolve(root,name+'.rgba')),name+' pixels');
    assert.deepEqual(readFileSync(path),before,name+' original');
  }
});

test('native WebP rejects invalid budgets, crops, and truncated input',async t=>{
  process.env.PANDO_MAP_PYTHON=resolve('definitely-missing-python');
  const path=resolve('tests/fixtures/map-image/webp-read/rgba.webp');
  await assert.rejects(raster({action:'read',path,maxPixels:255}),/budget/i);
  await assert.rejects(raster({action:'read',path,maxPixels:256,rect:{x:22,y:0,width:3,height:3}}),/bounds|rectangle/i);
  const folder=mkdtempSync(join(tmpdir(),'pando-webp-source-'));t.after(()=>rmSync(folder,{recursive:true,force:true}));
  const truncated=join(folder,'truncated.webp'),original=readFileSync(path);
  writeFileSync(truncated,original.subarray(0,original.length-15));
  await assert.rejects(raster({action:'read',path:truncated,maxPixels:256}),/webp/i);
});
