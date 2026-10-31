import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {createNativeDemWindowReader,readNativeDemWindow} from '../../tools/gis/terrain-dem-raster.mjs';

const binary=process.env.PANDO_TERRAIN_DEM_RASTER_BINARY;
const fixture=JSON.parse(readFileSync('tests/fixtures/terrain-dem-raster-oracle.json','utf8'));
test('GDAL DEM windows preserve area averaging, wrap, polar clamp and NoData',{skip:!binary},t=>{
  const root=mkdtempSync(join(tmpdir(),'pando-dem-raster-'));t.after(()=>rmSync(root,{recursive:true}));
  for(const [name,base64] of Object.entries(fixture.sources))writeFileSync(join(root,name+'.tif'),Buffer.from(base64,'base64'));
  for(const row of fixture.cases){
    const path=join(root,row.source+'.tif'),before=readFileSync(path);
    const result=spawnSync(binary,[path,String(row.width),String(row.height),...row.box.map(String)],{timeout:20000});
    if(row.error){assert.notEqual(result.status,0,JSON.stringify(row));assert.equal(result.stdout.length,0);}
    else{assert.equal(result.status,0,String(result.stderr));const expected=Buffer.from(row.expected,'base64');
      assert.equal(result.stdout.length,expected.length);
      for(let at=0;at<expected.length;at+=4)assert.ok(Math.abs(result.stdout.readFloatLE(at)-expected.readFloatLE(at))<1e-5,JSON.stringify(row));}
    assert.deepEqual(readFileSync(path),before);
  }
  const strict=spawnSync(binary,[join(root,'valid.tif'),'4','2','0','0','2','1','--strict-etopo'],{timeout:20000});
  assert.notEqual(strict.status,0);assert.equal(strict.stdout.length,0);
});
test('DEM window manager verifies the native artifact and requires explicit source bounds',
  {skip:!process.env.PANDO_TERRAIN_DEM_RASTER_DIRECTORY},async t=>{
    const root=mkdtempSync(join(tmpdir(),'pando-dem-window-'));t.after(()=>rmSync(root,{recursive:true}));
    const source=join(root,'표고 원본.tif');writeFileSync(source,Buffer.from(fixture.sources.valid,'base64'));
    const row=fixture.cases.find(value=>value.source==='valid'&&value.width===4);
    const bytes=await readNativeDemWindow({source,width:row.width,height:row.height,box:row.box,strict:false});
    const expected=Buffer.from(row.expected,'base64');assert.equal(bytes.length,expected.length);
    for(let at=0;at<bytes.length;at+=4)assert.ok(Math.abs(bytes.readFloatLE(at)-expected.readFloatLE(at))<1e-5);
    const reader=await createNativeDemWindowReader({source,width:row.width,height:row.height,strict:false});
    try{for(let i=0;i<2;i++)assert.deepEqual(await reader.read(row.box),bytes);}finally{await reader.close();}
    await assert.rejects(reader.read(row.box),/closed/i);
    await assert.rejects(readNativeDemWindow({source,width:row.width,height:row.height,box:row.box}),/EPSG|ETOPO/i);
    const controller=new AbortController();controller.abort();
    await assert.rejects(readNativeDemWindow({source,width:row.width,height:row.height,box:row.box},{signal:controller.signal}),{name:'AbortError'});
  });
