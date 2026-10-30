import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import test from 'node:test';
import {raster} from '../../plugins/pando-map-tools/lib/raster.mjs';

test('native PDF input preserves page pixels and GeoPDF coordinates',async()=>{
  process.env.PANDO_MAP_PYTHON=resolve('definitely-missing-python');
  const root=resolve('tests/fixtures/map-image/pdf-read');
  for(const name of ['single','multipage','geopdf','geopdf-rotated','geopdf-ref','unsupported-crs','bad-controls','two-viewports','crop-resize',
    'bad-prime','bad-angular-unit','bad-linear-unit','bad-axis','bad-datum']){
    const path=resolve(root,name+'.pdf'),before=readFileSync(path),oracle=JSON.parse(readFileSync(resolve(root,name+'.json'),'utf8'));
    const {data,...metadata}=await raster({...oracle.request,path});
    assert.deepEqual(metadata,oracle.expected,name+' metadata');
    assert.deepEqual(data,readFileSync(resolve(root,name+'.rgba')),name+' pixels');
    assert.deepEqual(readFileSync(path),before,name+' original');
  }
});

test('single-page PDF accepts null and explicit page one',async()=>{
  const path=resolve('tests/fixtures/map-image/pdf-read/single.pdf');
  for(const page of [null,1]){
    const result=await raster({action:'read',path,page,maxPixels:4096});
    assert.equal(result.mapping.page,1);assert.equal(result.mapping.pdfDpi,144);assert.equal(result.originalWidth,400);
  }
});

test('native PDF requires a valid explicit page for multipage documents',async()=>{
  process.env.PANDO_MAP_PYTHON=resolve('definitely-missing-python');
  const path=resolve('tests/fixtures/map-image/pdf-read/multipage.pdf');
  await assert.rejects(raster({action:'read',path,maxPixels:256}),/explicit/i);
  await assert.rejects(raster({action:'read',path,page:3,maxPixels:256}),/page/i);
  await assert.rejects(raster({action:'read',path:resolve('tests/fixtures/map-image/pdf-read/oversized.pdf'),maxPixels:256}),/16MP/i);
});
