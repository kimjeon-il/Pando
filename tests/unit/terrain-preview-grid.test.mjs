import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {assembleTerrainDemLevel,extractTerrainPreviewTile,renderTerrainPreviewLevel} from '../../tools/gis/terrain-preview-grid.mjs';
import {readNativeRawWebp} from '../../tools/map-image/native-resample.mjs';

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
