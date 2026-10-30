import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
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

test('native JPEG detects file bytes and rejects truncated or oversized sources',async t=>{
  process.env.PANDO_MAP_PYTHON=resolve('definitely-missing-python');
  const folder=mkdtempSync(join(tmpdir(),'pando-jpeg-source-'));t.after(()=>rmSync(folder,{recursive:true,force:true}));
  const original=readFileSync('tests/fixtures/map-image/jpeg-read/rgb.jpg'),disguised=join(folder,'source.png');
  writeFileSync(disguised,original);const expected=JSON.parse(readFileSync('tests/fixtures/map-image/jpeg-read/rgb.json','utf8'));
  const {data,...metadata}=await raster({...expected.request,path:disguised});
  assert.deepEqual(metadata,expected.expected);assert.deepEqual(data,readFileSync('tests/fixtures/map-image/jpeg-read/rgb.rgba'));
  const truncated=join(folder,'truncated.jpg');writeFileSync(truncated,original.subarray(0,original.length-20));
  await assert.rejects(raster({action:'read',path:truncated,maxPixels:256}),/JPEG/i);
  const oversized=Buffer.from(original);let i=2,updated=false;
  while(i+4<oversized.length){
    assert.equal(oversized[i],255);const marker=oversized[i+1],length=oversized.readUInt16BE(i+2);
    if([0xc0,0xc1,0xc2].includes(marker)){oversized.writeUInt16BE(4200,i+5);oversized.writeUInt16BE(4200,i+7);updated=true;break;}
    i+=2+length;
  }
  assert.ok(updated);const path=join(folder,'oversized.jpg');writeFileSync(path,oversized);
  await assert.rejects(raster({action:'read',path,maxPixels:256}),/16MP/i);
});
