import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {readPhysicalRaster} from '../../tools/gis/physical-raster-native.mjs';

const binary=process.env.PANDO_PHYSICAL_RASTER_BINARY;
const oracle=JSON.parse(readFileSync('tests/fixtures/physical-raster-oracle.json','utf8'));
test('GDAL reads bounded RGB and grayscale TIFF source pixels like Pillow', {skip:!binary}, t=>{
  const root=mkdtempSync(join(tmpdir(),'pando-physical-raster-'));t.after(()=>rmSync(root,{recursive:true}));
  for(const row of oracle.cases){
    const file=join(root,'지도 '+row.mode+'.tif'),source=Buffer.from(row.tiff,'base64');writeFileSync(file,source);
    const info=spawnSync(binary,['inspect',file],{timeout:20000});
    const pixels=spawnSync(binary,['read-rgb',file],{timeout:20000});
    if(row.mode==='RGBA'){
      assert.notEqual(info.status,0);assert.notEqual(pixels.status,0);assert.equal(pixels.stdout.length,0);
    }else{
      assert.equal(info.status,0,String(info.stderr));assert.deepEqual(JSON.parse(info.stdout),{width:row.width,height:row.height,mode:row.mode});
      assert.equal(pixels.status,0,String(pixels.stderr));assert.deepEqual(pixels.stdout,Buffer.from(row.rgb,'base64'));
    }
    assert.deepEqual(readFileSync(file),source);
  }
  const invalid=join(root,'invalid.tif');writeFileSync(invalid,'not a TIFF');
  const failure=spawnSync(binary,['read-rgb',invalid],{timeout:20000});assert.notEqual(failure.status,0);assert.equal(failure.stdout.length,0);
});
test('physical raster owner verifies TIFF bytes and reports read failures', {skip:!process.env.PANDO_PHYSICAL_RASTER_DIRECTORY}, async t=>{
  const root=mkdtempSync(join(tmpdir(),'pando-physical-owner-'));t.after(()=>rmSync(root,{recursive:true}));
  for(const row of oracle.cases){
    const path=join(root,`원본 ${row.mode}.tif`),bytes=Buffer.from(row.tiff,'base64');writeFileSync(path,bytes);
    if(row.mode==='RGBA'){await assert.rejects(readPhysicalRaster(path),/inspection failed/i);continue;}
    const result=await readPhysicalRaster(path);
    assert.deepEqual({width:result.width,height:result.height,mode:result.mode},{width:row.width,height:row.height,mode:row.mode});
    assert.deepEqual(result.pixels,Buffer.from(row.rgb,'base64'));
    assert.equal(result.sha256,createHash('sha256').update(bytes).digest('hex'));
    assert.deepEqual(readFileSync(path),bytes);
  }
  const controller=new AbortController();controller.abort();
  await assert.rejects(readPhysicalRaster(join(root,'RGB.tif'),{signal:controller.signal}),{name:'AbortError'});
});
