import test from 'node:test';
import assert from 'node:assert/strict';
import {assembleTerrainDemLevel,extractTerrainTile,verifyTerrainTileEdges} from '../../../tools/gis/terrain-tile-grid.mjs';
test('terrain level assembly ignores source gutters and numeric tiles wrap and clamp edges',()=>{
  const level={width:3,height:2,columns:2,rows:1,tileSize:2};
  const rgba=values=>Buffer.from(values.flatMap(value=>[value,0,0,255]));
  const tiles=[{column:0,row:0,width:4,height:4,data:rgba([0,0,0,0,0,10,20,0,0,40,50,0,0,0,0,0])},
    {column:1,row:0,width:3,height:4,data:rgba([0,0,0,0,30,0,0,60,0,0,0,0])}];
  const before=tiles.map(tile=>({...tile,data:Buffer.from(tile.data)})),world=assembleTerrainDemLevel(level,tiles);
  assert.deepEqual(world.data,rgba([10,20,30,40,50,60]));assert.deepEqual(tiles,before);
  const first=extractTerrainTile(world,level,0,0),last=extractTerrainTile(world,level,1,0);
  assert.deepEqual([first.width,first.height],[4,4]);assert.deepEqual(first.data,rgba([30,10,20,30,30,10,20,30,60,40,50,60,60,40,50,60]));
  assert.deepEqual([last.width,last.height],[3,4]);assert.deepEqual(last.data,rgba([20,30,10,20,30,10,50,60,40,50,60,40]));
});
test('terrain level assembly rejects missing, duplicate or incorrectly sized tiles',()=>{
  const level={width:2,height:2,columns:1,rows:1,tileSize:2},tile={column:0,row:0,width:4,height:4,data:Buffer.alloc(64)};
  assert.throws(()=>assembleTerrainDemLevel(level,[]),/tile/i);
  assert.throws(()=>assembleTerrainDemLevel(level,[tile,tile]),/tile/i);
  assert.throws(()=>assembleTerrainDemLevel(level,[{...tile,width:3}]),/tile/i);
});
test('numeric verification checks adjoining, antimeridian and polar gutter pixels',()=>{
  const level={id:0,width:3,height:3,columns:2,rows:2,tileSize:2};
  const data=Buffer.from(Array.from({length:9},(_,i)=>[i,0,0,255]).flat());
  const world={width:3,height:3,data},tiles=[];
  for(let row=0;row<2;row++)for(let column=0;column<2;column++)
    tiles.push({row,column,...extractTerrainTile(world,level,column,row)});
  assert.doesNotThrow(()=>verifyTerrainTileEdges(level,tiles));
  const damaged=tiles.map(tile=>({...tile,data:Buffer.from(tile.data)}));
  damaged[0].data[0]^=1;
  assert.throws(()=>verifyTerrainTileEdges(level,damaged),/gutter/i);
  assert.throws(()=>verifyTerrainTileEdges(level,tiles.slice(1)),/tile/i);
});
