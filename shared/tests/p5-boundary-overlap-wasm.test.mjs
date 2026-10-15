import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const modulePath=resolve(process.env.PANDOEDITOR_WASM_MODULE
  ?? 'build-native/p1/pando-wasm/shared/wasm/pandoeditor-core.js');
const {default:createCore}=await import(pathToFileURL(modulePath));
const core=await createCore({wasmBinary:await readFile(modulePath.replace(/\.js$/,'.wasm'))});

// Frozen original source-level parent outline subtraction for parity only.
function reference([[start,end],candidates]) {
  const dx=end[0]-start[0],dy=end[1]-start[1],length2=dx*dx+dy*dy;
  const intervals=candidates.flatMap(([a,b])=>{
    const project=point=>((point[0]-start[0])*dx+(point[1]-start[1])*dy)/length2;
    const aligned=point=>Math.abs((point[0]-start[0])*dy-(point[1]-start[1])*dx)<=1e-7*Math.sqrt(length2);
    if(!aligned(a)||!aligned(b))return [];
    const first=Math.max(0,Math.min(project(a),project(b)));
    const last=Math.min(1,Math.max(project(a),project(b)));
    return last>first?[[first,last]]:[];
  }).sort((a,b)=>a[0]-b[0]);
  const point=t=>[start[0]+dx*t,start[1]+dy*t];
  let cursor=0;const remaining=[];
  for(const [first,last] of intervals) {
    if(first>cursor+1e-9)remaining.push([point(cursor),point(first)]);
    cursor=Math.max(cursor,last);
  }
  if(cursor<1-1e-9)remaining.push([point(cursor),end]);
  return remaining;
}
const e=(a,b)=>[a,b];
const cases=[
  [e([0,0],[10,0]),[e([3,0],[5,0]),e([8,0],[6,0]),e([5,0],[6,0])]],
  [e([0,0],[10,0]),[e([-1,0],[12,0])]],
  [e([10,0],[0,0]),[e([4,0],[6,0])]],
  [e([0,0],[10,0]),[e([2,.001],[8,.001])]],
  [e([0,0],[10,0]),[e([2,0],[2,0])]],
  [e([0,0],[10,0]),[e([10,0],[11,0])]],
  [e([0,0],[0,0]),[]],
  [e([179,20],[180,20]),[e([179.25,20],[179.75,20])]],
  [e([-180,80],[-179,80]),[e([-179.8,80],[-179.4,80])]],
  [e([0,0],[1,1]),[e([.25,.25],[.75,.75])]],
  [e([0,0],[1,1]),[e([.25,.25+.000001],[.75,.75+.000001])]],
  [e([0,0],[10,0]),[]],
];
for(let i=0;i<175;i++) {
  const x=-70+i*.47,y=i%17-8,theta=i*.117;
  const a=[x,y],b=[x+Math.cos(theta)*5,y+Math.sin(theta)*5];
  const lerp=t=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
  const entries=Array.from({length:i%7+1},(_,k)=>{
    const first=(k*.31+i*.077)%1.4-.2;
    const second=first+.04+(k%4)*.13;
    const offset=k%6===0?0:k%4===0?0.000001:0;
    const start=lerp(first),end=lerp(second);
    if(offset){start[1]+=offset;end[1]+=offset;}
    return k%2?[end,start]:[start,end];
  });
  cases.push([[a,b],entries]);
}
test('C++ outline subtraction API exists',()=>assert.equal(typeof core.boundarySubtractOverlapsBatch,'function'));
test('C++ and original JS remove identical overlapped outline intervals',()=>{
  assert.deepEqual(core.boundarySubtractOverlapsBatch(cases),cases.map(reference));
});
test('WASM batch validates malformed and nonfinite input',()=>{
  for(const input of [null,{},[[[0,0],[1,0]]],[[[[0,0],[1,0]],'bad']],
    [[[[0,0],[1,0]],[[[0,0],[NaN,0]]]]]]) {
    assert.throws(()=>core.boundarySubtractOverlapsBatch(input),error=>error?.code==='PL-BOUNDARY-OVERLAP');
  }
});
