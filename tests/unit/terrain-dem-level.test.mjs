import assert from 'node:assert/strict';
import test from 'node:test';
import {extractTerrainPreviewTile} from '../../tools/gis/terrain-preview-grid.mjs';
import {verifyTerrainDemLevel} from '../../tools/gis/terrain-dem-check.mjs';

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
