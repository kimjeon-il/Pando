import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';

const binary=process.env.PANDO_TERRAIN_DEM_RASTER_BINARY;
test('GDAL DEM windows preserve area averaging, wrap, polar clamp and NoData',{skip:!binary},t=>{
  const fixture=JSON.parse(readFileSync('tests/fixtures/terrain-dem-raster-oracle.json','utf8'));
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
});
