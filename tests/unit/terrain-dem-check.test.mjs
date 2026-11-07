import { describe as contractSuite } from 'node:test';
import * as __dem_dep0 from "node:assert/strict";
import * as __dem_dep1 from "node:fs";
import * as __dem_dep2 from "node:test";
import * as __dem_dep3 from "../../tools/gis/terrain-dem-check.mjs";
import * as __dem_dep4 from "../../tools/gis/terrain-preview-grid.mjs";
import * as __dem_dep5 from "node:crypto";
import * as __dem_dep6 from "node:os";
import * as __dem_dep7 from "node:path";
import * as __dem_dep8 from "../../tools/gis/terrain-dem-assets.mjs";

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

// Original feature contract: terrain-dem-assets.test.mjs
contractSuite("terrain-dem-assets", () => {
const assert = __dem_dep0.default;
const { createHash } = __dem_dep5;
const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = __dem_dep1;
const { tmpdir } = __dem_dep6;
const { join } = __dem_dep7;
const test = __dem_dep2.default;
const { hashTerrainFile, summarizeTerrainAssets } = __dem_dep8;

const digest=bytes=>createHash('sha256').update(bytes).digest();
test('DEM asset summary uses level and row order and the original binary hashes', async t => {
  const root=mkdtempSync(join(tmpdir(),'pando-dem-assets-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  mkdirSync(join(root,'0'));mkdirSync(join(root,'1'));
  const files=[['0/0-0.webp','a'],['0/1-0.webp','bb'],['0/0-1.webp','ccc'],['0/1-1.webp','dddd'],['1/0-0.webp','eeeee']];
  for(const [path,bytes] of files)writeFileSync(join(root,path),bytes);
  writeFileSync(join(root,'tint.webp'),'tint');
  assert.equal((await hashTerrainFile(join(root,'tint.webp'))).sha256,digest('tint').toString('hex'));
  const aggregate=createHash('sha256');for(const [path,bytes] of files)aggregate.update(path).update(digest(bytes));
  aggregate.update(digest('tint'));
  assert.deepEqual(await summarizeTerrainAssets(root,[{id:0,columns:2,rows:2},{id:1,columns:1,rows:1}]), {
    assetsSha256:aggregate.digest('hex'),reports:[{level:0,tileCount:4,bytes:10,maxTileBytes:4},{level:1,tileCount:1,bytes:5,maxTileBytes:5}],
  });
  await assert.rejects(summarizeTerrainAssets(root,[{id:'../other',columns:1,rows:1}]), /level/i);
  await assert.rejects(summarizeTerrainAssets(root,[{id:2,columns:1,rows:1}]), /ENOENT/);
});
});
