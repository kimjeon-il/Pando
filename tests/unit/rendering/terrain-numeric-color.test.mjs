import test from 'node:test';
import assert from 'node:assert/strict';
import '../../../src/rendering/workers/canvas-terrain-dem-core.js';

const {convertTile}=globalThis.PandoLabCanvasTerrainDem;
function sample(height,shade=212,extra={}) {
  const value=height+12000;
  return convertTile({dem:new Uint8ClampedArray([value>>8,value&255,shade,255]),
    width:1,height:1,...extra});
}
test('numeric DEM creates separate land and ocean colors without a tint or geographic image',()=>{
  const low=sample(0),deep=sample(-4000),high=sample(6500);
  assert.ok(low.land[1]>low.land[0]&&low.land[1]>low.land[2]);
  assert.ok(deep.ocean[2]>deep.ocean[0]);
  assert.deepEqual(deep.land,low.land,'the land mask, not elevation sign, chooses the plane');
  assert.ok(high.land[0]>low.land[0]);
  assert.equal(low.land[3],255);
});
test('stored DEM shade changes the resulting color at every latitude',()=>{
  const common={bounds:[0,1,1,0],pixelWidth:1,pixelHeight:1,levelWidth:1350,levelHeight:675,
    tint:new Uint8ClampedArray([255,0,0,255]),tintWidth:1,tintHeight:1};
  assert.ok(sample(1000,212,common).land[0]>sample(1000,128,common).land[0]);
  assert.deepEqual(sample(1000,212,common).land,
    sample(1000,212,{...common,bounds:[0,90,1,89]}).land);
});
test('numeric terrain color ignores unrelated precolored imagery',()=>{
  const a=sample(0,212,{tint:new Uint8ClampedArray([255,0,0,255]),tintWidth:1,tintHeight:1,
    bounds:[0,1,1,0],pixelWidth:1,pixelHeight:1,levelWidth:1350,levelHeight:675});
  const b=sample(0,212,{tint:new Uint8ClampedArray([0,0,255,255]),tintWidth:1,tintHeight:1,
    bounds:[0,1,1,0],pixelWidth:1,pixelHeight:1,levelWidth:1350,levelHeight:675});
  assert.deepEqual(a.land,b.land);
});
