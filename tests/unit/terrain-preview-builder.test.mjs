import { describe as contractSuite } from 'node:test';
import * as __dem_dep0 from "node:assert/strict";
import * as __dem_dep1 from "node:crypto";
import * as __dem_dep2 from "node:fs/promises";
import * as __dem_dep3 from "node:os";
import * as __dem_dep4 from "node:path";
import * as __dem_dep5 from "node:test";
import * as __dem_dep6 from "../../tools/map-image/native-resample.mjs";
import * as __dem_dep7 from "../../tools/gis/terrain-preview-builder.mjs";
import * as __dem_dep8 from "../../tools/gis/terrain-preview-sources.mjs";
import * as __dem_dep9 from "../../tools/build-terrain-preview.mjs";
import * as __dem_dep10 from "node:fs";
import * as __dem_dep11 from "../../tools/gis/terrain-preview-grid.mjs";

// Original feature contract: terrain-preview-builder.test.mjs
contractSuite("terrain-preview-builder", () => {
const assert = __dem_dep0.default;
const { createHash } = __dem_dep1;
const { mkdtemp, readFile, rm, writeFile } = __dem_dep2;
const { tmpdir } = __dem_dep3;
const { join } = __dem_dep4;
const test = __dem_dep5.default;
const { encodeNativeWebpLossless, readNativeRawWebp } = __dem_dep6;
const { buildTerrainPreview, readTerrainPreviewFiles, verifyTerrainPreviewFiles, writeTerrainPreview } = __dem_dep7;
const { validateTerrainPreviewSources } = __dem_dep8;

const sha=data=>createHash('sha256').update(data).digest('hex');
test('pinned small preview produces the expected source-bound manifest and lossless tile inventory',{
  skip:!process.env.PANDO_TERRAIN_PREVIEW_DIRECTORY||!process.env.PANDO_MAP_IMAGE_ARTIFACT,
},async t=>{
  const cache=await mkdtemp(join(tmpdir(),'pando-preview-builder-'));t.after(()=>rm(cache,{recursive:true}));
  const countries=Buffer.from('{"type":"FeatureCollection","features":[]}');
  const tint=await encodeNativeWebpLossless({width:1,height:1,data:Buffer.from([100,150,200,255])});
  const tile=await encodeNativeWebpLossless({width:4,height:4,data:Buffer.from(Array(16).fill([46,224,128,255]).flat())});
  const levels=[0,1].map(id=>({id,width:2,height:2,columns:1,rows:1,tileSize:2}));
  const paths=['terrain/v0.13.0/0/0-0.webp','terrain/v0.13.0/1/0-0.webp','terrain/v0.13.3/tint.webp'];
  const bodies=[tile.data,tile.data,tint.data],assets=paths.map((path,index)=>({path,bytes:bodies[index].length,sha256:sha(bodies[index])}));
  const dem={version:'0.13.3',representation:'dem-relief-v1',levels,urlTemplate:'https://example.test/{level}/{column}-{row}.webp',
    assetsSha256:'a'.repeat(64),tint:{url:'https://example.test/tint.webp',width:1,height:1,sha256:sha(tint.data)}};
  const source=validateTerrainPreviewSources({dem,inventory:{assets},countryBytes:countries,landMaskSha256:sha(countries)});
  const fetcher=async url=>new Response(url.endsWith('tint.webp')?tint.data:tile.data);
  const result=await buildTerrainPreview({source,cache,fetcher,landMaskSha256:sha(countries)});
  assert.deepEqual(result.tiles.map(item=>item.path),['0/0-0.webp','1/0-0.webp']);
  assert.equal(result.manifest.sourceDem.landMaskSha256,sha(countries));
  assert.equal(result.manifest.sourceDem.assetsSha256,dem.assetsSha256);
  assert.equal(result.manifestBytes.toString(),JSON.stringify(result.manifest,null,2)+'\n');
  const digest=createHash('sha256');for(const output of result.tiles){
    assert.equal(result.manifest.tiles[output.path].sha256,sha(output.data));
    const decoded=await readNativeRawWebp(output.data);assert.deepEqual([decoded.width,decoded.height],[4,4]);
    digest.update(output.path+'\0').update(Buffer.from(sha(output.data),'hex'));
  }
  assert.equal(result.manifest.assetsSha256,digest.digest('hex'));
  assert.equal(result.tileBytes,result.tiles.reduce((sum,item)=>sum+item.data.length,0));
  const files=new Map([['manifest.json',result.manifestBytes],...result.tiles.map(tile=>[tile.path,tile.data])]);
  const receipt=await verifyTerrainPreviewFiles({source,files});
  assert.equal(receipt.manifestSha256,result.manifestSha256);assert.equal(receipt.tiles,2);
  const changed=new Map(files);changed.set('0/0-0.webp',Buffer.from('bad'));
  await assert.rejects(verifyTerrainPreviewFiles({source,files:changed}),/hash|identity/i);
  changed.set('extra.txt',Buffer.from('extra'));
  await assert.rejects(verifyTerrainPreviewFiles({source,files:changed}),/inventory/i);
  const output=join(cache,'output');await writeTerrainPreview({source,result,output});
  assert.deepEqual(await readFile(join(output,'manifest.json')),result.manifestBytes);
  assert.deepEqual(await verifyTerrainPreviewFiles({source,files:readTerrainPreviewFiles(output)}),receipt);
  await assert.rejects(writeTerrainPreview({source,result,output}),/exist|overwrite/i);
  await writeFile(join(output,'keep.txt'),'keep');
  await assert.rejects(verifyTerrainPreviewFiles({source,files:readTerrainPreviewFiles(output)}),/inventory/i);
  await assert.rejects(writeTerrainPreview({source,result,output}),/exist|overwrite/i);
  assert.equal(await readFile(join(output,'keep.txt'),'utf8'),'keep');
  const controller=new AbortController();controller.abort();
  await assert.rejects(buildTerrainPreview({source,cache,fetcher,landMaskSha256:sha(countries),signal:controller.signal}),/abort/i);
});
});

// Original feature contract: terrain-preview-cli.test.mjs
contractSuite("terrain-preview-cli", () => {
const assert = __dem_dep0.default;
const test = __dem_dep5.default;
const { parseTerrainPreviewArgs } = __dem_dep9;

test('terrain preview CLI selects one explicit action and rejects invalid arguments',()=>{
  assert.equal(parseTerrainPreviewArgs(['--check']).mode,'check');
  assert.equal(parseTerrainPreviewArgs(['--rebuild-check','--output','somewhere']).mode,'rebuild-check');
  assert.equal(parseTerrainPreviewArgs([]).mode,'build');
  assert.throws(()=>parseTerrainPreviewArgs(['--check','--rebuild-check']),/mode/i);
  assert.throws(()=>parseTerrainPreviewArgs(['--output']),/value/i);
  assert.throws(()=>parseTerrainPreviewArgs(['--unknown']),/argument/i);
});
});

// Original feature contract: terrain-preview-grid.test.mjs
contractSuite("terrain-preview-grid", () => {
const assert = __dem_dep0.default;
const test = __dem_dep5.default;
const { readFileSync } = __dem_dep10;
const { assembleTerrainDemLevel, extractTerrainPreviewTile, renderTerrainPreviewLevel, verifyTerrainPreviewTileEdges } = __dem_dep11;
const { readNativeRawWebp } = __dem_dep6;

test('terrain level assembly ignores source gutters and preview tiles wrap and clamp edges',()=>{
  const level={width:3,height:2,columns:2,rows:1,tileSize:2};
  const rgba=values=>Buffer.from(values.flatMap(value=>[value,0,0,255]));
  const tiles=[{column:0,row:0,width:4,height:4,data:rgba([0,0,0,0,0,10,20,0,0,40,50,0,0,0,0,0])},
    {column:1,row:0,width:3,height:4,data:rgba([0,0,0,0,30,0,0,60,0,0,0,0])}];
  const before=tiles.map(tile=>({...tile,data:Buffer.from(tile.data)})),world=assembleTerrainDemLevel(level,tiles);
  assert.deepEqual(world.data,rgba([10,20,30,40,50,60]));assert.deepEqual(tiles,before);
  const first=extractTerrainPreviewTile(world,level,0,0),last=extractTerrainPreviewTile(world,level,1,0);
  assert.deepEqual([first.width,first.height],[4,4]);assert.deepEqual(first.data,rgba([30,10,20,30,30,10,20,30,60,40,50,60,60,40,50,60]));
  assert.deepEqual([last.width,last.height],[3,4]);assert.deepEqual(last.data,rgba([20,30,10,20,30,10,50,60,40,50,60,40]));
});
test('terrain level assembly rejects missing, duplicate or incorrectly sized tiles',()=>{
  const level={width:2,height:2,columns:1,rows:1,tileSize:2},tile={column:0,row:0,width:4,height:4,data:Buffer.alloc(64)};
  assert.throws(()=>assembleTerrainDemLevel(level,[]),/tile/i);
  assert.throws(()=>assembleTerrainDemLevel(level,[tile,tile]),/tile/i);
  assert.throws(()=>assembleTerrainDemLevel(level,[{...tile,width:3}]),/tile/i);
});
test('preview verification checks adjoining, antimeridian and polar gutter pixels',()=>{
  const level={id:0,width:3,height:3,columns:2,rows:2,tileSize:2};
  const data=Buffer.from(Array.from({length:9},(_,i)=>[i,0,0,255]).flat());
  const world={width:3,height:3,data},tiles=[];
  for(let row=0;row<2;row++)for(let column=0;column<2;column++)
    tiles.push({row,column,...extractTerrainPreviewTile(world,level,column,row)});
  assert.doesNotThrow(()=>verifyTerrainPreviewTileEdges(level,tiles));
  const damaged=tiles.map(tile=>({...tile,data:Buffer.from(tile.data)}));
  damaged[0].data[0]^=1;
  assert.throws(()=>verifyTerrainPreviewTileEdges(level,damaged),/gutter/i);
  assert.throws(()=>verifyTerrainPreviewTileEdges(level,tiles.slice(1)),/tile/i);
});
test('terrain level rendering composes and round-trips a small source-bound preview',{
  skip:!process.env.PANDO_TERRAIN_PREVIEW_DIRECTORY||!process.env.PANDO_MAP_IMAGE_ARTIFACT,
},async()=>{
  const source=JSON.parse(readFileSync('tests/fixtures/terrain-preview-kernel.json','utf8')).find(row=>row.name==='wrap-and-ocean');
  const level={id:0,width:2,height:2,columns:1,rows:1,tileSize:2},dem=Buffer.from(source.dem),tile=Buffer.alloc(4*4*4,255);
  for(let y=0;y<2;y++)tile.set(dem.subarray(y*8,y*8+8),((y+1)*4+1)*4);
  const result=await renderTerrainPreviewLevel({level,tiles:[{column:0,row:0,width:4,height:4,data:tile}],
    tint:{width:2,height:2,data:Buffer.from(source.tint)},land:Buffer.from(source.land)});
  assert.equal(result.tiles.length,1);assert.equal(result.tiles[0].path,'0/0-0.webp');
  const decoded=await readNativeRawWebp(result.tiles[0].data),expected=extractTerrainPreviewTile({width:2,height:2,data:Buffer.from(source.expected)},level,0,0);
  assert.deepEqual(decoded.data,expected.data);assert.equal(result.tileBytes,result.tiles[0].data.length);
});
});
