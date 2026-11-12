import test from 'node:test';
import assert from 'node:assert/strict';
import {roundHalfEven,quantizationStep,quantizeHeight,createPchip,createLandPalette,HEIGHT_STOPS,LIGHT_LAND} from '../../../scripts/terrain-experiment/quality.mjs';
import {quantizeSample} from '../../../scripts/terrain-experiment/sample-quality.mjs';

test('Q1/Q2/Q3 classify original elevations and use half-even ties',()=>{
  assert.deepEqual([0.5,1.5,2.5,3.5].map(roundHalfEven),[0,2,2,4]);
  assert.equal(quantizationStep(511.99,'Q1'),4);assert.equal(quantizationStep(512,'Q1'),8);
  assert.equal(quantizationStep(2559.99,'Q1'),8);assert.equal(quantizationStep(2560,'Q1'),16);
  assert.equal(quantizationStep(-255.99,'Q1'),16);assert.equal(quantizationStep(-256,'Q1'),64);
  assert.equal(quantizationStep(-1024,'Q1'),128);
  assert.equal(quantizationStep(0,'Q2'),8);assert.equal(quantizationStep(3000,'Q3'),8);
  assert.equal(quantizeHeight(-8,'Q1'),0);assert.equal(quantizeHeight(-24,'Q1'),-32);
  for(const policy of ['Q1','Q2','Q3'])for(let height=-11000;height<=9000;height+=3.25){
    assert.ok(Math.abs(quantizeHeight(height,policy)-height)<=quantizationStep(height,policy)/2+1e-9);
  }
});

test('PCHIP passes each palette stop and stays within neighboring channel endpoints',()=>{
  const palette=createLandPalette();
  for(let i=0;i<HEIGHT_STOPS.length;i++){
    const rgb=[1,3,5].map(at=>parseInt(LIGHT_LAND[i].slice(at,at+2),16));
    palette(HEIGHT_STOPS[i]).forEach((value,channel)=>assert.ok(Math.abs(value-rgb[channel])<1e-8));
    if(i===HEIGHT_STOPS.length-1)continue;
    const next=[1,3,5].map(at=>parseInt(LIGHT_LAND[i+1].slice(at,at+2),16));
    for(let sample=0;sample<=100;sample++)palette(HEIGHT_STOPS[i]+sample*(HEIGHT_STOPS[i+1]-HEIGHT_STOPS[i])/100)
      .forEach((value,c)=>assert.ok(value>=Math.min(rgb[c],next[c])-1e-8&&value<=Math.max(rgb[c],next[c])+1e-8));
  }
  assert.equal(createPchip([0,1],[2,4])(0.5),3);
});

test('sample quality uses one original-based shade across quantization candidates',()=>{
  const input=Float32Array.from([0,10,20,30,40,50,60,70,80,90,100,110,120,130,140,150]);
  const level={north:100,levelWidth:43200,levelHeight:21600};
  const rows=['Q1','Q2','Q3'].map(policy=>quantizeSample(input,2,2,level,policy));
  assert.equal(new Set(rows.map(row=>row.stats.shadeSha256)).size,1);
  assert.ok(rows.every(row=>row.stats.count===4));
  assert.throws(()=>quantizeSample(Float32Array.of(NaN),2,2,level,'Q1'),/halo/);
});
