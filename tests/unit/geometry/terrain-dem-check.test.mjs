import { describe as contractSuite } from 'node:test';
import * as __dem_dep0 from "node:assert/strict";
import * as __dem_dep1 from "node:fs";
import * as __dem_dep2 from "node:test";
import * as __dem_dep3 from "../../../tools/gis/terrain-dem-check.mjs";
import * as __dem_dep4 from "../../../tools/gis/terrain-preview-grid.mjs";
import * as __dem_dep5 from "node:child_process";
import * as __dem_dep6 from "node:crypto";
import * as __dem_dep7 from "node:fs/promises";
import * as __dem_dep8 from "node:os";
import * as __dem_dep9 from "node:path";
import * as __dem_dep10 from "node:util";
import * as __dem_dep11 from "../../../tools/map-image/native-resample.mjs";

// Original feature contract: terrain-dem-check.test.mjs
contractSuite("terrain-dem-check", () => {
const assert = __dem_dep0.default;
const { readFileSync } = __dem_dep1;
const test = __dem_dep2.default;
const { checkNativeDemTile } = __dem_dep3;

const directory=process.env.PANDO_TERRAIN_DEM_CHECK_DIRECTORY;
const oracle=JSON.parse(readFileSync('tests/fixtures/terrain-dem-check-oracle.json','utf8'));
function tile(){return {width:3,height:3,data:Buffer.from(Array(9).fill([12,34,4,255]).flat())};}
test('DEM tile check rejects malformed inputs without invoking a native tool',async()=>{
  await assert.rejects(checkNativeDemTile({tile:{width:3,height:3,data:Buffer.alloc(3)}}),/tile/i);
  await assert.rejects(checkNativeDemTile({tile:tile(),shadeStep:0}),/shade/i);
});
test('native DEM tile check preserves opacity, shade, references and gutters',{skip:!directory},async()=>{
  const current=tile(),options={directory};await checkNativeDemTile({tile:current,shadeStep:4},options);
  const badAlpha=tile();badAlpha.data[3]=254;await assert.rejects(checkNativeDemTile({tile:badAlpha,shadeStep:4},options),/alpha/i);
  const offGrid=tile();offGrid.data[2]=3;await assert.rejects(checkNativeDemTile({tile:offGrid,shadeStep:4},options),/shade/i);
  await checkNativeDemTile({tile:offGrid,shadeStep:4,excludeNorth:true},options);
  const reference=tile();reference.data[2]=6;await checkNativeDemTile({tile:current,reference,shadeStep:4},options);
  reference.data[2]=7;await assert.rejects(checkNativeDemTile({tile:current,reference,shadeStep:4},options),/shade/i);
  reference.data[2]=4;reference.data[1]++;await assert.rejects(checkNativeDemTile({tile:current,reference,shadeStep:4},options),/elevation/i);
  const edge=Buffer.from(Array(3).fill([12,34,4,255]).flat());
  await checkNativeDemTile({tile:current,shadeStep:4,left:edge,top:edge,west:edge},options);
  const wrong=Buffer.from(edge);wrong[0]++;
  for(const field of ['left','top','west'])await assert.rejects(checkNativeDemTile({tile:current,shadeStep:4,[field]:wrong},options),/gutter/i);
});
test('native DEM tile results match the original Python verifier',{skip:!directory},async()=>{
  for(const row of oracle){const request={tile:{width:3,height:3,data:Buffer.from(row.pixels)},shadeStep:4,excludeNorth:row.excludeNorth,
    ...(row.reference?{reference:{width:3,height:3,data:Buffer.from(row.reference)}}:{})};
    if(row.expected)assert.equal(await checkNativeDemTile(request,{directory}),true,row.name);
    else await assert.rejects(checkNativeDemTile(request,{directory}),undefined,row.name);
  }
});
});

// Original feature contract: terrain-dem-level.test.mjs
contractSuite("terrain-dem-level", () => {
const assert = __dem_dep0.default;
const test = __dem_dep2.default;
const { extractTerrainPreviewTile } = __dem_dep4;
const { verifyTerrainDemLevel } = __dem_dep3;

const directory=process.env.PANDO_TERRAIN_DEM_CHECK_DIRECTORY;
test('DEM level checks only requested tiles, source sample and published seams',{skip:!directory},async()=>{
  const level={id:5,width:3,height:3,columns:2,rows:2,tileSize:2},pixels=Buffer.alloc(3*3*4);
  for(let i=0;i<9;i++)pixels.set([46,226,4,255],i*4); // decoded elevation 2
  const world={width:3,height:3,data:pixels},calls=[],samples=[];
  const readTile=async(column,row)=>{calls.push([column,row]);return {...extractTerrainPreviewTile(world,level,column,row),encoded:Buffer.from(`${column},${row}`)};};
  const sourceSample=async(x,y)=>{samples.push([x,y]);return 2;};
  const result=await verifyTerrainDemLevel({level,readTile,sourceSample},{directory});
  assert.deepEqual(calls,[[0,0],[1,0],[0,1],[1,1]]);assert.deepEqual(samples,[[0,0]]);
  assert.equal(result.tiles,4);assert.equal(result.bytes,12);assert.equal(result.assets.length,4);
  await assert.rejects(verifyTerrainDemLevel({level,readTile,sourceSample:async()=>3},{directory}),/elevation/i);
  const controller=new AbortController();controller.abort();
  await assert.rejects(verifyTerrainDemLevel({level,readTile,sourceSample},{directory,signal:controller.signal}),/abort/i);
});
});

// Original feature contract: terrain-dem-cli.test.mjs
contractSuite("terrain-dem-cli", () => {
const assert = __dem_dep0.default;
const { execFile } = __dem_dep5;
const { createHash } = __dem_dep6;
const { mkdir, mkdtemp, readFile, rm, writeFile } = __dem_dep7;
const { tmpdir } = __dem_dep8;
const { join, resolve } = __dem_dep9;
const { promisify } = __dem_dep10;
const test = __dem_dep2.default;
const { extractTerrainPreviewTile } = __dem_dep4;
const { encodeNativeWebpLossless } = __dem_dep11;

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
  const args=[resolve('tools/checks/verify-terrain-dem.mjs'),'--etopo',etopo,'--output',output,'--reference-output',output];
  const result=JSON.parse((await exec(process.execPath,args,{windowsHide:true,maxBuffer:1024*1024})).stdout);
  assert.equal(result.verified,true);assert.equal(result.levels[0].tiles,4);
  assert.deepEqual(await readFile(etopo),source);
  manifest.sources[0].sha256='0'.repeat(64);await writeFile(join(output,'manifest.json'),JSON.stringify(manifest));
  await assert.rejects(exec(process.execPath,args,{windowsHide:true}),/source checksum/i);
});
});
