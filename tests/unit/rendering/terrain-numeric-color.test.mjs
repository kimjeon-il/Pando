import test from 'node:test';
import assert from 'node:assert/strict';
import '../../../src/rendering/workers/canvas-terrain-dem-core.js';
import {createPchip} from '../../../scripts/terrain-experiment/quality.mjs';

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

const paletteStops = [0, 256, 750, 1500, 2500, 3500, 4500, 6500];
const expected = {
  light: ['#70CFA3', '#9BDE91', '#C3DF8C', '#E6D89A', '#F1C6A1', '#DEB09C', '#C5A9A3', '#F4F1EB'],
  dark: ['#477B60', '#629260', '#87A76B', '#ABA476', '#C0AA86', '#AF9486', '#9F8C8A', '#CEC9C3'],
};
const fromHex = hex => [1,3,5].map(at => parseInt(hex.slice(at,at+2),16));
test('Canvas samples numerical heights before applying the land palette',()=>{
  const dem=new Uint8ClampedArray(16),heights=[0,256,2500,6500];
  heights.forEach((value,i)=>{const n=value+12000;dem.set([n>>8,n&255,212,255],i*4);});
  const actual=globalThis.PandoLabCanvasTerrainDem.sampleInterpolated({dem,width:2,height:2,x:.5,y:.5,theme:'light',channel:'land'});
  const expectedHeight=heights.reduce((a,b)=>a+b,0)/4;
  const expected=sample(expectedHeight,212).land;
  assert.deepEqual([...actual],[...expected]);
});
test('land palette has eight independent sRGB stops in both themes',()=>{
  for(const theme of ['light','dark'])for(let i=0;i<paletteStops.length;i++){
    const actual=sample(paletteStops[i],212,{theme}).land;
    const target=fromHex(expected[theme][i]);
    for(let channel=0;channel<3;channel++)
      assert.ok(Math.abs(actual[channel]-target[channel])<=2,
        theme+' stop '+paletteStops[i]+' channel '+channel);
  }
});
test('sRGB land colors follow the PCHIP curve between palette stops',()=>{
  for(const theme of ['light','dark']){
    for(const height of [64,128,400,1000,2000,3000,4000,5500]){
      const actual=sample(height,212,{theme}).land;
      for(let channel=0;channel<3;channel++){
        const values=expected[theme].map(value=>fromHex(value)[channel]);
        const reference=createPchip(paletteStops,values)(height);
        assert.ok(Math.abs(actual[channel]-reference)<=2,`${theme} ${height} channel ${channel}: ${actual[channel]} vs ${reference}`);
      }
    }
    assert.deepEqual(sample(-10,212,{theme}).land,sample(0,212,{theme}).land);
    assert.deepEqual(sample(9999,212,{theme}).land,sample(6500,212,{theme}).land);
  }
});
test('independent sea palettes share the established depth exponent',()=>{
  const endpoints={light:['#A5D7F1','#6A9FCA'],dark:['#477E99','#1F425F']};
  for(const theme of ['light','dark']){
    for(const [i,depth] of [0,8000].entries()){
      const color=sample(-depth,212,{theme}).ocean;
      for(let channel=0;channel<3;channel++)
        assert.ok(Math.abs(color[channel]-fromHex(endpoints[theme][i])[channel])<=2);
    }
    const shallow=sample(-400,212,{theme}).ocean,medium=sample(-2000,212,{theme}).ocean,
      deep=sample(-8000,212,{theme}).ocean;
    for(let c=0;c<3;c++)assert.ok(shallow[c]>=medium[c]&&medium[c]>=deep[c]);
  }
});
test('political plane, original hillshade response and shared shader color uniforms are unchanged',()=>{
  const source=globalThis.PandoLabCanvasTerrainDem;
  assert.deepEqual(sample(2500,185,{theme:'dark'}).political,sample(2500,185,{theme:'light'}).political);
  assert.ok(sample(2500,212,{theme:'dark'}).land[0]>sample(2500,128,{theme:'dark'}).land[0]);
  assert.equal(sample(0,212,{theme:'dark',includePolitical:false}).political,null);
  const glsl=source.colorGlsl();
  for(const name of ['uTerrainLandColors[8]','uTerrainSeaSurface','uTerrainSeaDeep','0.6','0.38','1.3'])
    assert.ok(glsl.includes(name),'GLSL contract '+name);
  const uniforms=source.paletteForTheme('dark');
  assert.equal(uniforms.landColors.length,24);
  assert.equal(uniforms.seaSurface.length,3);
  assert.equal(uniforms.seaDeep.length,3);
});


test('monochrome land relief has stronger slope contrast without recoloring the source DEM',()=>{
  for (const height of [0, 1000, 3000, 6000]) {
    const shadow=sample(height,128).political;
    const middle=sample(height,212).political;
    const highlight=sample(height,252).political;
    assert.ok(shadow[0] < middle[0] && middle[0] < highlight[0], 'shade order at '+height);
    assert.ok((highlight[0]-shadow[0]) * 0.55 >= 65,
      'national tint must preserve visible grayscale relief at '+height);
    for (const value of [shadow,middle,highlight])
      assert.equal(value[0],value[1]), assert.equal(value[1],value[2]);
    const color=sample(height,128).land;
    assert.deepEqual(color,sample(height,128,{includePolitical:false}).land,
      'grayscale contrast must not alter colored relief');
  }
  const shader=globalThis.PandoLabCanvasTerrainDem.colorGlsl();
  assert.match(shader,/physicalStyle < 0\.5/);
  assert.match(shader,/0\.48 \+ 0\.34 \* smoothstep/);
  assert.match(shader,/0\.60 \* \(illumination - 0\.70710678\)/);
  assert.match(shader,/0\.12, 0\.98/);
});
