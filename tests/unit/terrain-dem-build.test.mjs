import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {readNativeRawWebp} from '../../tools/map-image/native-resample.mjs';

const expected=[
  '9fb8614b0d2037f720fea17cc998f5e5251e70a4b8f4d8abf5aff524ba310738',
  '1fd25af70b0453fdf4c6ceab8d98cea1c87d9223765a77e774a5bc6b4064225d',
  '4bc5d6732ebf089cf4cfbab0ffd7a1fee1338b66a12e870c1591a09749c92ff1',
  'edac8a8fcecfac03447807add5db4bc30c5d5d424159d5a6e7b889c417850edb',
  '85dffc92c596e808a492faec3fb7dbe3a752ea5fd52fcc45d7acee28f1a49534',
  'e37b24255a8d63c2feb5c862aa1a70312e4cbbc90992c36c22de043c829cdb51',
]; // Frozen pixels from the existing Python producer and GDAL reader.

test('DEM level builder exists and refuses an invalid level',async()=>{
  const module=await import('../../tools/gis/terrain-dem-build.mjs').catch(()=>({}));
  assert.equal(typeof module.generateTerrainDemLevel,'function');
  await assert.rejects(module.generateTerrainDemLevel({source:'x',output:'x',level:{id:0,width:8,height:4,tileSize:0}}),/level/i);
});

test('native level generation preserves Python tile pixels and protects existing output',
  {skip:!process.env.PANDO_TERRAIN_DEM_RASTER_DIRECTORY||!process.env.PANDO_TERRAIN_DEM_ENCODE_DIRECTORY||!process.env.PANDO_MAP_IMAGE_ARTIFACT},async()=>{
  const {generateTerrainDemLevel}=await import('../../tools/gis/terrain-dem-build.mjs');
  const root=await mkdtemp(join(tmpdir(),'pando-dem-level-'));
  try{
    const fixture=JSON.parse(await readFile('tests/fixtures/terrain-dem-raster-oracle.json','utf8'));
    const source=join(root,'source.tif');await writeFile(source,Buffer.from(fixture.sources.valid,'base64'));
    const level={id:0,width:8,height:4,tileSize:3,columns:3,rows:2};
    const report=await generateTerrainDemLevel({source,output:root,level,strict:false});
    assert.equal(report.tileCount,6);
    let n=0;
    for(let row=0;row<2;row++)for(let column=0;column<3;column++){
      const image=await readNativeRawWebp(await readFile(join(root,'0',`${column}-${row}.webp`)));
      assert.equal(createHash('sha256').update(image.data).digest('hex'),expected[n++]);
    }
    const existing=await readFile(join(root,'0','0-0.webp'));
    await assert.rejects(generateTerrainDemLevel({source,output:root,level,strict:false}),/exist/i);
    assert.deepEqual(await readFile(join(root,'0','0-0.webp')),existing);
  }finally{await rm(root,{recursive:true,force:true});}
});
