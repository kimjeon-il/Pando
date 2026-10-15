import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const modulePath=resolve(process.env.PANDOEDITOR_WASM_MODULE
  ?? 'build-native/p1/pando-wasm/shared/wasm/pandoeditor-core.js');
const { default: createCore }=await import(pathToFileURL(modulePath));
const core=await createCore({wasmBinary:await readFile(modulePath.replace(/\.js$/,'.wasm'))});

// Frozen historical JS expression: test-only differential oracle.
function reference(segment,refs) {
  const norm=value=>{
    let longitude=Number(value);
    if(!Number.isFinite(longitude))return NaN;
    while(longitude>180)longitude-=360;
    while(longitude< -180)longitude+=360;
    return longitude;
  };
  const near=(value,anchor)=>{
    let longitude=norm(value);
    while(longitude-anchor>180)longitude-=360;
    while(longitude-anchor< -180)longitude+=360;
    return longitude;
  };
  const dx=near(segment[1][0],segment[0][0])-segment[0][0];
  const dy=segment[1][1]-segment[0][1];
  const sides=refs.map(([a,b,interiorSide])=>{
    const edgeDx=near(b[0],a[0])-a[0];
    return Math.sign(edgeDx*dx+(b[1]-a[1])*dy)*interiorSide;
  });
  return new Set(sides).size>1;
}
const cases=[
  [[[0,0],[1,0]],[[[0,0],[1,0],1],[[0,0],[1,0],-1]]],
  [[[0,0],[1,0]],[[[0,0],[1,0],1],[[0,0],[1,0],1]]],
  [[[0,0],[1,0]],[[[0,0],[1,0],1],[[1,0],[0,0],1]]],
  [[[0,0],[1,0]],[[[0,0],[1,0],1],[[1,0],[0,0],-1]]],
  [[[179.5,20],[-179.5,20]],[[[179.5,20],[-179.5,20],1],[[-179.5,20],[179.5,20],1]]],
  [[[179.5,20],[-179.5,20]],[[[179.5,20],[-179.5,20],1],[[-179.5,20],[179.5,20],-1]]],
  [[[-179.5,-10],[179.5,-10]],[[[-179.5,-10],[179.5,-10],1],[[179.5,-10],[-179.5,-10],1]]],
  [[[179.99,89.9],[-179.99,89.9]],[[[179.99,89.9],[-179.99,89.9],1],[[-179.99,89.9],[179.99,89.9],-1]]],
  [[[0,0],[0,0]],[[[0,0],[1,0],1],[[1,0],[0,0],-1]]],
  [[[0,0],[1,0]],[[[0,0],[0,1],1],[[0,0],[0,1],-1]]],
  [[[0,0],[1,0]],[]],
  [[[0,0],[1,0]],[[[0,0],[1,0],0],[[0,0],[1,0],1],[[1,0],[0,0],-1]]]
];
for(let i=0;i<230;i++) {
  const longitude=i%7===0?179.1:i%5===0?-179.1:-40+i*.217;
  const a=[longitude,i%11-5],b=[longitude+(i%7===0?-358.7:.25+(i%4)*.125),i%11-5+(i%3-1)*.23];
  const refs=Array.from({length:i%4+1},(_,k)=>{
    const side=[-1,0,1][(i+k)%3],reversed=(i+k)%2===1;
    return reversed?[b,a,side]:[a,b,side];
  });
  cases.push([[a,b],refs]);
}
test('P5-5 shared C++ owns contact side classification and batch ABI',()=>{
  assert.equal(typeof core.boundaryOpposingInteriors,'function');
  assert.equal(typeof core.boundaryOpposingInteriorsBatch,'function');
  assert.equal(core.coreAbiVersion,1);
});
test('P5-5 matches Web winding, date line and multi-owner side classification',()=>{
  const expected=cases.map(([edge,refs])=>reference(edge,refs));
  assert.deepEqual(core.boundaryOpposingInteriorsBatch(cases),expected);
  for(let i=0;i<cases.length;i++)
    assert.equal(core.boundaryOpposingInteriors(...cases[i]),expected[i],'case '+i);
});
test('P5-5 rejects malformed refs and nonfinite geometry',()=>{
  for(const [edge,refs] of [
    [null,[]],[[[0,0],[1,0]],[[[0,0],[1,0],Infinity]]],
    [[[0,0],[1,0]],[[[0,0],[1,0]]]],
    [[[0,0],[1,0]],[[[0,0],[1,0],"1"]]],
    [[[0,91],[1,0]],[]],
  ]) assert.throws(()=>core.boundaryOpposingInteriors(edge,refs),
    error=>error?.code==='PL-BOUNDARY-INTERIOR');
});
