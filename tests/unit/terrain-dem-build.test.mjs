import { describe as contractSuite } from 'node:test';
import * as __dem_dep0 from "node:assert/strict";
import * as __dem_dep1 from "node:crypto";
import * as __dem_dep2 from "node:child_process";
import * as __dem_dep3 from "node:fs/promises";
import * as __dem_dep4 from "node:os";
import * as __dem_dep5 from "node:path";
import * as __dem_dep6 from "node:test";
import * as __dem_dep7 from "../../tools/map-image/native-resample.mjs";
import * as __dem_dep8 from "../../tools/gis/terrain-dem-webp.mjs";
import * as __dem_dep9 from "../../tools/gis/terrain-dem-gutters.mjs";
import * as __dem_dep10 from "../../tools/gis/terrain-dem-assets.mjs";
import * as __dem_dep11 from "node:util";
import * as __dem_dep12 from "../../tools/gis/terrain-preview-grid.mjs";
import * as __dem_dep13 from "node:fs";
import * as __dem_dep14 from "../../tools/gis/build-physical-hydro.mjs";
import * as __dem_dep15 from "../../tools/gis/terrain-dem-build.mjs";

// Original feature contract: terrain-dem-build.test.mjs
contractSuite("terrain-dem-build", () => {
const assert = __dem_dep0.default;
const { createHash } = __dem_dep1;
const { execFileSync } = __dem_dep2;
const { mkdtemp, readFile, rm, symlink, writeFile } = __dem_dep3;
const { tmpdir } = __dem_dep4;
const { join } = __dem_dep5;
const test = __dem_dep6.default;
const { readNativeRawWebp } = __dem_dep7;
const { encodeDemWebp } = __dem_dep8;
const { restoreDemPolarGutterShade } = __dem_dep9;
const { hashTerrainFile, summarizeTerrainAssets } = __dem_dep10;

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

test('DEM dataset manager requires an explicit protected output',async()=>{
  const module=await import('../../tools/gis/terrain-dem-build.mjs');
  assert.equal(typeof module.buildTerrainDemCandidate,'function');
  await assert.rejects(module.buildTerrainDemCandidate({}),/inputs|output/i);
});

test('small DEM candidate keeps source and output hashes and refuses existing results',
  {skip:!process.env.PANDO_TERRAIN_DEM_RASTER_DIRECTORY||!process.env.PANDO_TERRAIN_DEM_ENCODE_DIRECTORY||
        !process.env.PANDO_MAP_IMAGE_ARTIFACT||!process.env.PANDO_TERRAIN_DEM_GUTTERS_DIRECTORY||
        !process.env.PANDO_TERRAIN_DEM_TINT_DIRECTORY||!process.env.PANDO_TERRAIN_DEM_FILL_DIRECTORY},async()=>{
  const {buildTerrainDemCandidate,rebuildTerrainDemTint,repairTerrainDem}=await import('../../tools/gis/terrain-dem-build.mjs');
  assert.equal(typeof rebuildTerrainDemTint,'function');assert.equal(typeof repairTerrainDem,'function');
  const root=await mkdtemp(join(tmpdir(),'pando-dem-candidate-'));
  try{
    const fixture=JSON.parse(await readFile('tests/fixtures/terrain-dem-raster-oracle.json','utf8'));
    const source=join(root,'source.tif');await writeFile(source,Buffer.from(fixture.sources.valid,'base64'));
    const archive='tests/fixtures/terrain-dem-tint/source.zip',ice='tests/fixtures/terrain-dem-tint/ice.geojson',land='tests/fixtures/terrain-dem-tint/land.geojson';
    const inputs={etopo:source,tintZip:archive,ice,countries:land,output:join(root,'output')};
    const profile={strict:false,levels:[{id:0,width:8,height:4,tileSize:3,columns:3,rows:2}],tintWidth:4,tintHeight:2,
      etopoSha256:(await hashTerrainFile(source)).sha256,tintSha256:(await hashTerrainFile(archive)).sha256,iceSha256:(await hashTerrainFile(ice)).sha256};
    await assert.rejects(buildTerrainDemCandidate({...inputs,output:join(root,'bad-level')},
      {profile:{...profile,levels:[{...profile.levels[0],columns:2}]}}),/level/i);
    const manifest=await buildTerrainDemCandidate(inputs,{profile});
    assert.equal(manifest.sources[0].sha256,profile.etopoSha256);assert.equal(manifest.sources[0].nodata,-32768);
    assert.equal(manifest.levels[0].columns,3);assert.equal(manifest.tileSize,3);assert.equal(manifest.tint.width,4);
    assert.equal(manifest.assetsSha256,(await summarizeTerrainAssets(inputs.output,profile.levels)).assetsSha256);
    const previous=await readFile(join(inputs.output,'manifest.json'));
    await assert.rejects(buildTerrainDemCandidate(inputs,{profile}),/exist/i);
    assert.deepEqual(await readFile(join(inputs.output,'manifest.json')),previous);
    await assert.rejects(buildTerrainDemCandidate({...inputs,output:join(root,'bad')},{profile:{...profile,etopoSha256:'0'.repeat(64)}}),/checksum/i);
    const old=JSON.parse(previous);old.version='0.13.2';await writeFile(join(inputs.output,'manifest.json'),JSON.stringify(old));
    const alias=join(root,'source-alias');await symlink(inputs.output,alias,process.platform==='win32'?'junction':'dir');
    await assert.rejects(rebuildTerrainDemTint({sourceOutput:inputs.output,tintZip:archive,ice,countries:land,output:join(alias,'nested')},{profile}),/inside/i);
    const reused=join(root,'reused');
    const reusedManifest=await rebuildTerrainDemTint({sourceOutput:inputs.output,tintZip:archive,ice,countries:land,output:reused},{profile});
    assert.equal(reusedManifest.version,'0.13.3');
    for(let row=0;row<2;row++)for(let column=0;column<3;column++)
      assert.deepEqual(await readFile(join(reused,'0',`${column}-${row}.webp`)),await readFile(join(inputs.output,'0',`${column}-${row}.webp`)));
    await assert.rejects(rebuildTerrainDemTint({sourceOutput:inputs.output,tintZip:archive,ice,countries:land,output:reused},{profile}),/exist/i);
    const tile=join(inputs.output,'0','0-0.webp'),tileBytes=await readFile(tile);await writeFile(tile,Buffer.from('corrupt'));
    await assert.rejects(rebuildTerrainDemTint({sourceOutput:inputs.output,tintZip:archive,ice,countries:land,output:join(root,'corrupt-copy')},{profile}),/checksum/i);
    await writeFile(tile,tileBytes);
    const repaired=await repairTerrainDem({output:reused});
    assert.equal(repaired.completed,true);
    const final=JSON.parse(await readFile(join(reused,'manifest.json'),'utf8'));
    assert.equal(final.assetsSha256,(await summarizeTerrainAssets(reused,profile.levels)).assetsSha256);
    const cli=JSON.parse(execFileSync(process.execPath,['tools/gis/terrain-dem-build.mjs','--output',reused,'--repair-output'],{encoding:'utf8'}));
    assert.equal(cli.completed,true);assert.equal(cli.manifestSha256,(await hashTerrainFile(join(reused,'manifest.json'))).sha256);
  }finally{await rm(root,{recursive:true,force:true});}
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

test('polar repair updates only changed shade and remains stable',
  {skip:!process.env.PANDO_TERRAIN_DEM_RASTER_DIRECTORY||!process.env.PANDO_TERRAIN_DEM_ENCODE_DIRECTORY||
        !process.env.PANDO_MAP_IMAGE_ARTIFACT||!process.env.PANDO_TERRAIN_DEM_GUTTERS_DIRECTORY},async()=>{
  const {generateTerrainDemLevel}=await import('../../tools/gis/terrain-dem-build.mjs');
  const root=await mkdtemp(join(tmpdir(),'pando-dem-polar-'));
  try{
    const fixture=JSON.parse(await readFile('tests/fixtures/terrain-dem-raster-oracle.json','utf8'));
    const source=join(root,'source.tif');await writeFile(source,Buffer.from(fixture.sources.valid,'base64'));
    const level={id:0,width:8,height:4,tileSize:3,columns:3,rows:2};
    await generateTerrainDemLevel({source,output:root,level,strict:false});
    const path=join(root,'0','0-0.webp'),original=await readNativeRawWebp(await readFile(path));
    const changed={...original,data:Buffer.from(original.data)};changed.data[2]^=255;
    await writeFile(path,await encodeDemWebp(changed));
    assert.equal(await restoreDemPolarGutterShade({output:root,source,levels:[level],strict:false}),1);
    const repaired=await readNativeRawWebp(await readFile(path));assert.deepEqual(repaired.data,original.data);
    assert.equal(await restoreDemPolarGutterShade({output:root,source,levels:[level],strict:false}),0);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('high-resolution polar repair matches frozen Python shade rows',
  {skip:!process.env.PANDO_TERRAIN_DEM_RASTER_DIRECTORY||!process.env.PANDO_TERRAIN_DEM_ENCODE_DIRECTORY||
        !process.env.PANDO_MAP_IMAGE_ARTIFACT||!process.env.PANDO_TERRAIN_DEM_GUTTERS_DIRECTORY},async()=>{
  const {generateTerrainDemLevel}=await import('../../tools/gis/terrain-dem-build.mjs');
  const root=await mkdtemp(join(tmpdir(),'pando-dem-polar-high-'));
  try{
    const fixture=JSON.parse(await readFile('tests/fixtures/terrain-dem-raster-oracle.json','utf8'));
    const source=join(root,'source.tif');await writeFile(source,Buffer.from(fixture.sources.valid,'base64'));
    const level={id:0,width:8,height:1351,tileSize:1351,columns:1,rows:1};
    await generateTerrainDemLevel({source,output:root,level,strict:false});
    const path=join(root,'0','0-0.webp'),before=await readNativeRawWebp(await readFile(path));
    await restoreDemPolarGutterShade({output:root,source,levels:[level],strict:false});
    const after=await readNativeRawWebp(await readFile(path)),expected=Buffer.from('09PU1NTU1NTT0w==','base64');
    assert.equal(after.width,10);assert.equal(after.height,1353);
    for(let x=0;x<after.width;x++){
      assert.equal(after.data[x*4+2],expected[x]);
      assert.equal(after.data[((after.height-1)*after.width+x)*4+2],expected[x]);
    }
    for(let i=0;i<after.data.length;i++)if(i%4!==2||Math.floor(i/4/after.width)>0&&Math.floor(i/4/after.width)<after.height-1)
      assert.equal(after.data[i],before.data[i]);
    assert.equal(await restoreDemPolarGutterShade({output:root,source,levels:[level],strict:false}),0);
  }finally{await rm(root,{recursive:true,force:true});}
});
});

// Original feature contract: terrain-dem-cli.test.mjs
contractSuite("terrain-dem-cli", () => {
const assert = __dem_dep0.default;
const { execFile } = __dem_dep2;
const { createHash } = __dem_dep1;
const { mkdir, mkdtemp, readFile, rm, writeFile } = __dem_dep3;
const { tmpdir } = __dem_dep4;
const { join, resolve } = __dem_dep5;
const { promisify } = __dem_dep11;
const test = __dem_dep6.default;
const { extractTerrainPreviewTile } = __dem_dep12;
const { encodeNativeWebpLossless } = __dem_dep7;

const exec=promisify(execFile),sha=data=>createHash('sha256').update(data).digest();
test('DEM verifier checks pinned synthetic source, tiles, reference and tint without writing them',{
  skip:!process.env.PANDO_TERRAIN_DEM_CHECK_DIRECTORY||!process.env.PANDO_MAP_IMAGE_ARTIFACT||!process.env.PANDO_GDAL_LOCATIONINFO,
},async t=>{
  const root=await mkdtemp(join(tmpdir(),'terrain-dem-check-'));t.after(()=>rm(root,{recursive:true}));
  const output=join(root,'dem');await mkdir(join(output,'5'),{recursive:true});
  const level={id:5,width:3,height:3,columns:2,rows:2,tileSize:2},data=Buffer.alloc(36);
  for(let i=0;i<9;i++)data.set([46,226,4,255],i*4);
  const world={width:3,height:3,data},aggregate=createHash('sha256');
  for(let row=0;row<2;row++)for(let column=0;column<2;column++){
    const path=`5/${column}-${row}.webp`,tile=extractTerrainPreviewTile(world,level,column,row);
    const bytes=(await encodeNativeWebpLossless(tile)).data;await writeFile(join(output,path),bytes);
    aggregate.update(path).update(sha(bytes));
  }
  const tintData=Buffer.alloc(4096*2048*4,255),tint=(await encodeNativeWebpLossless({width:4096,height:2048,data:tintData})).data;
  await writeFile(join(output,'tint.webp'),tint);aggregate.update(sha(tint));
  const etopo=resolve('tests/fixtures/terrain-dem/synthetic-elevation.tif'),source=await readFile(etopo);
  const manifest={version:'0.13.3',representation:'dem-relief-v1',shade:{quantizationStep:4},levels:[level],
    sources:[{sha256:sha(source).toString('hex')}],tint:{sha256:sha(tint).toString('hex')},assetsSha256:aggregate.digest('hex')};
  await writeFile(join(output,'manifest.json'),JSON.stringify(manifest));
  const args=[resolve('tools/verify-terrain-dem.mjs'),'--etopo',etopo,'--output',output,'--reference-output',output];
  const result=JSON.parse((await exec(process.execPath,args,{windowsHide:true,maxBuffer:1024*1024})).stdout);
  assert.equal(result.verified,true);assert.equal(result.levels[0].tiles,4);
  assert.deepEqual(await readFile(etopo),source);
  manifest.sources[0].sha256='0'.repeat(64);await writeFile(join(output,'manifest.json'),JSON.stringify(manifest));
  await assert.rejects(exec(process.execPath,args,{windowsHide:true}),/source checksum/i);
});
});

// Original feature contract: terrain-dem-path.test.mjs
contractSuite("terrain-dem-path", () => {
const assert = __dem_dep0.default;
const { mkdtemp, mkdir, realpath, rm, symlink } = __dem_dep3;
const { realpathSync } = __dem_dep13;
const { tmpdir } = __dem_dep4;
const { join, relative } = __dem_dep5;
const test = __dem_dep6.default;
const { futureRealpath } = __dem_dep14;
const { rebuildTerrainDemTint } = __dem_dep15;

test('DEM reuse cannot write through a junction into its source directory',async t=>{
  const root=await mkdtemp(join(tmpdir(),'pando-dem-path-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const source=join(root,'source'),alias=join(root,'alias');await mkdir(source);
  await symlink(source,alias,process.platform==='win32'?'junction':'dir');
  const destination=join(alias,'nested');
  try{
    await assert.rejects(rebuildTerrainDemTint({sourceOutput:source,output:destination,tintZip:'missing',ice:'missing',countries:'missing'}),/inside/i);
  }catch(error){
    console.error('DEM path diagnostics:',JSON.stringify({source,asyncRealpath:await realpath(source),nativeRealpath:realpathSync.native(source),
      resolved:futureRealpath(destination),relative:relative(await realpath(source),futureRealpath(destination))}));
    throw error;
  }
});
});
