import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {crc32} from 'node:zlib';
import test from 'node:test';
import {raster} from '../../plugins/pando-map-tools/lib/raster.mjs';

test('native PNG input preserves original mapping and pixels across colors, alpha, EXIF and crop',async()=>{
  process.env.PANDO_MAP_PYTHON=resolve('definitely-missing-python');
  const root=resolve('tests/fixtures/map-image/png-read');
  for(const name of ['rgba','rgb','orientation-2','orientation-3','orientation-4','orientation-5','orientation-6','orientation-7','orientation-8',
    'palette-alpha','gray1','gray16','gray16-key','rgb16','gray-alpha16','rgba16','gray-alpha','gray-key','rgb-key','adam7','crop-resize']){
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

test('native PNG input detects file content and rejects truncated or oversized input',async t=>{
  process.env.PANDO_MAP_PYTHON=resolve('definitely-missing-python');
  const folder=mkdtempSync(join(tmpdir(),'pando-png-source-'));t.after(()=>rmSync(folder,{recursive:true,force:true}));
  const original=readFileSync('tests/fixtures/map-image/png-read/rgba.png'),disguised=join(folder,'source.jpg');
  writeFileSync(disguised,original);const expected=JSON.parse(readFileSync('tests/fixtures/map-image/png-read/rgba.json','utf8'));
  const {data,...metadata}=await raster({...expected.request,path:disguised});
  assert.deepEqual(metadata,expected.expected);assert.deepEqual(data,readFileSync('tests/fixtures/map-image/png-read/rgba.rgba'));
  const signature=Buffer.from([137,80,78,71,13,10,26,10]),truncated=join(folder,'truncated.png');writeFileSync(truncated,signature);
  await assert.rejects(raster({action:'read',path:truncated,maxPixels:256}),/PNG/i);
  const chunk=(name,body)=>{const type=Buffer.from(name),length=Buffer.alloc(4),crc=Buffer.alloc(4);length.writeUInt32BE(body.length);crc.writeUInt32BE(crc32(Buffer.concat([type,body])));return Buffer.concat([length,type,body,crc]);};
  const header=Buffer.alloc(13);header.writeUInt32BE(4200);header.writeUInt32BE(4200,4);header[8]=8;header[9]=6;
  const oversized=join(folder,'oversized.png');writeFileSync(oversized,Buffer.concat([signature,chunk('IHDR',header),chunk('IDAT',Buffer.alloc(0)),chunk('IEND',Buffer.alloc(0))]));
  await assert.rejects(raster({action:'read',path:oversized,maxPixels:256}),/16MP/i);
});
