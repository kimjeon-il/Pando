import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {encodeNativeDemElevation} from "../../../tools/gis/terrain-dem-encode.mjs";
import {quantizeTerrainMeters} from "../../../tools/gis/terrain-dem-check.mjs";

const directory=process.env.PANDO_TERRAIN_DEM_ENCODE_DIRECTORY;
const cases=JSON.parse(readFileSync('tests/fixtures/terrain-dem-encoding-oracle.json','utf8'));
test('DEM encoding rejects invalid grids before launching native code',async()=>{
  await assert.rejects(encodeNativeDemElevation({width:1,height:1,levelWidth:1,levelHeight:1,north:0,elevation:Buffer.alloc(1)}),/grid/i);
});
test('native DEM encoding matches original elevation and hillshade bytes',{skip:!directory},async()=>{
  for(const row of cases){const actual=await encodeNativeDemElevation({...row,elevation:Buffer.from(row.elevation,'base64')},{directory});
    assert.deepEqual(actual.shade,Buffer.from(row.shade,'base64'),row.name+' shade');
    const original=Buffer.from(row.rgba,'base64'),source=Buffer.from(row.elevation,'base64');
    for(let i=0;i<source.length/4;i++){
      const sourceMeters=source.readFloatLE(i*4);
      const got=actual.rgba[i*4]*256+actual.rgba[i*4+1]-12000;
      assert.equal(got,quantizeTerrainMeters(sourceMeters),row.name+' elevation '+i);
      assert.equal(actual.rgba[i*4+2],original[i*4+2],row.name+' shade '+i);
      assert.equal(actual.rgba[i*4+3],original[i*4+3],row.name+' alpha '+i);
    }
  }
  const row=cases[0],bad=Buffer.from(row.elevation,'base64');bad.writeFloatLE(-12001,0);
  await assert.rejects(encodeNativeDemElevation({...row,elevation:bad},{directory}),/range/i);
  bad.writeFloatLE(NaN,0);await assert.rejects(encodeNativeDemElevation({...row,elevation:bad},{directory}),/range/i);
});

test('signed elevation boundaries and quantized shade survive encoding',{skip:!directory},async()=>{
  const encode=async(values,width,height,levelWidth,levelHeight,north)=>{
    const elevation=Buffer.alloc(values.length*4);values.forEach((value,index)=>elevation.writeFloatLE(value,index*4));
    return encodeNativeDemElevation({width,height,levelWidth,levelHeight,north,elevation},{directory});
  };
  const values=[-12000,-11745,-11744,0,53535],edges=await encode(values,5,1,5,1,0);
  for(let i=0;i<values.length;i++){
    assert.equal(edges.rgba[i*4]*256+edges.rgba[i*4+1]-12000,quantizeTerrainMeters(values[i]));assert.equal(edges.rgba[i*4+3],255);
  }
  assert.deepEqual([...edges.rgba.subarray(4,6)],[0,224]);assert.deepEqual([...edges.rgba.subarray(8,10)],[0,224]);
  const input=[0,120,-100,300,600,-500,2200,-3500],result=await encode(input,4,2,4,2,0);
  for(let i=0;i<input.length;i++){
    assert.equal(result.rgba[i*4]*256+result.rgba[i*4+1]-12000,quantizeTerrainMeters(input[i]));
    const quantized=Math.min(Math.floor((result.shade[i]+2)/4)*4,255);
    assert.equal(result.rgba[i*4+2],quantized);assert.ok(Math.abs(result.rgba[i*4+2]-result.shade[i])<=2);
  }
  const polar=await encode([100,200,300,400,200,300,400,500,300,400,500,600,400,500,600,700],4,4,4,2,-1);
  for(let x=0;x<4;x++){
    assert.equal(polar.rgba[x*4+2],polar.rgba[(4+x)*4+2]);
    assert.equal(polar.rgba[(12+x)*4+2],polar.rgba[(8+x)*4+2]);
  }
});

test('half-to-even quantization respects both depth thresholds and signed error budgets',()=>{
  const checks=[
    [8,0], [24,32], [-8,0],[-24,-32],
    [255.5,256],[256,256],[272,256],[288,288],
    [-255.5,-256],[-256,-256],[-288,-256],[-1024,-1024],[-1088,-1024],
  ];
  for(const [source,expected] of checks)assert.equal(quantizeTerrainMeters(source),expected,'source '+source);
  for(let value=-9000;value<9000;value+=0.25){
    const output=quantizeTerrainMeters(value),magnitude=Math.abs(value);
    const step=value<0?(magnitude<256?16:magnitude<1024?64:128):(magnitude<256?16:32);
    assert.ok(Math.abs(output-value)<=step/2+1e-6, 'source '+value);
    if(value<0)assert.ok(output<=0);
    else assert.ok(output>=0);
  }
});
