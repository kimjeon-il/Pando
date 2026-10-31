import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {buildPhysicalTerrain} from '../../tools/gis/build-physical-terrain.mjs';
import {readNativeRawWebp} from '../../tools/map-image/native-resample.mjs';

test('physical terrain candidate CLI requires explicit input and output',()=>{
  const result=spawnSync(process.execPath,['tools/gis/build-physical-terrain.mjs'],{encoding:'utf8'});
  assert.notEqual(result.status,0);assert.match(result.stderr,/explicit/i);
});
const enabled=Boolean(process.env.PANDO_PHYSICAL_RASTER_DIRECTORY&&process.env.PANDO_TERRAIN_PREVIEW_DIRECTORY&&process.env.PANDO_MAP_IMAGE_ARTIFACT);
test('Node physical terrain candidate matches frozen Python tiles and preserves originals',{skip:!enabled},async t=>{
  const root=mkdtempSync(join(tmpdir(),'pando-physical-builder-'));t.after(()=>rmSync(root,{recursive:true}));
  const source=join(root,'source'),input=join(root,'input'),output=join(root,'candidate');mkdirSync(source);mkdirSync(join(input,'hydro'),{recursive:true});
  const oracle=JSON.parse(readFileSync('tests/fixtures/physical-build-mini-oracle.json','utf8'));
  const tiffs=JSON.parse(readFileSync('tests/fixtures/physical-build-mini-tiffs.json','utf8'));
  const names={gray:'GRAY_HR_SR_OB.tif',land:'HYP_HR_SR.tif',ocean:'HYP_HR_SR_OB_DR.tif'},hash=bytes=>createHash('sha256').update(bytes).digest('hex');
  for(const [key,name] of Object.entries(names))writeFileSync(join(source,name),Buffer.from(tiffs[key],'base64'));
  const countries=join(input,'countries.geojson'),lakes=join(input,'hydro','lakes_base.geojson');
  writeFileSync(countries,JSON.stringify(oracle.countries));writeFileSync(lakes,JSON.stringify(oracle.lakes));
  const args={sourceRoot:source,outputRoot:output,countriesPath:countries,root,sourceSize:[4,2],levelWidths:[2,4],tileSize:2};
  await assert.rejects(buildPhysicalTerrain({...args,outputRoot:join(source,'nested')}),/outside/i);
  const controller=new AbortController();controller.abort();await assert.rejects(buildPhysicalTerrain({...args,signal:controller.signal}),{name:'AbortError'});
  const manifest=await buildPhysicalTerrain(args);
  assert.deepEqual(manifest.levels,[{id:0,width:2,height:1,columns:1,rows:1,tileSize:2},{id:1,width:4,height:2,columns:2,rows:1,tileSize:2}]);
  assert.equal(manifest.gutter,1);assert.equal(manifest.crs,'EPSG:4326');
  for(const [key,name] of Object.entries(names)){
    const bytes=readFileSync(join(source,name));assert.equal(hash(bytes),hash(Buffer.from(tiffs[key],'base64')));
    assert.equal(manifest.sources.find(row=>row.file===name).sha256,hash(bytes));
  }
  for(const tile of oracle.tiles){
    const bytes=readFileSync(join(output,'terrain','v0.12.6',String(tile.level),`${tile.column}-0.webp`));
    const image=await readNativeRawWebp(bytes);assert.equal(image.width,tile.width);assert.equal(image.height,tile.height);
    assert.deepEqual(image.data,Buffer.from(tile.rgba,'base64'));
  }
  const manifestPath=join(output,'terrain','v0.12.6','manifest.json'),before=readFileSync(manifestPath);
  assert.deepEqual(JSON.parse(before),manifest);await assert.rejects(buildPhysicalTerrain(args),/exists/i);assert.deepEqual(readFileSync(manifestPath),before);
});
