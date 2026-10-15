import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const modulePath=resolve(process.env.PANDOEDITOR_WASM_MODULE
  ?? 'build-native/p1/pando-wasm/shared/wasm/pandoeditor-core.js');
const {default:createCore}=await import(pathToFileURL(modulePath));
const core=await createCore({wasmBinary:await readFile(modulePath.replace(/\.js$/,'.wasm'))});
// Original JavaScript display refinement is retained only as a test oracle.
function reference(segments,maxEdgeDegrees=0.499) {
  const limit=Math.max(0.01,Number(maxEdgeDegrees)||0.499);
  const radians=Math.PI/180;
  const minimumDot=Math.cos(Math.max(0.01,limit-0.000002)*radians);
  const packed=p=>[Math.round(p[0]*1e6)*1e-6,Math.round(p[1]*1e6)*1e-6];
  const vector=p=>{
    const lon=p[0]*radians,lat=p[1]*radians,cos=Math.cos(lat);
    return [cos*Math.cos(lon),cos*Math.sin(lon),Math.sin(lat)];
  };
  const result=[];
  for(const [a,b] of segments){
    const stack=[[a,b,0]];
    while(stack.length){
      const [left,right,depth]=stack.pop();
      const x=vector(left),y=vector(right);
      const dot=x[0]*y[0]+x[1]*y[1]+x[2]*y[2];
      if(dot<minimumDot-1e-14){
        if(depth>=40)throw new Error('Display boundary refinement did not converge');
        const mid=[(left[0]+right[0])/2,(left[1]+right[1])/2];
        stack.push([mid,right,depth+1],[left,mid,depth+1]);
        continue;
      }
      const first=packed(left),last=packed(right);
      if(first[0]!==last[0]||first[1]!==last[1])result.push([first,last]);
    }
  }
  return result;
}
const fixtures=[
  [[[0,0],[8,5]]],[[[8,5],[0,0]]],
  [[[179,20],[180,20]],[[-180,20],[-179,20]]],
  [[[0,80],[8,80]]],[[[-45,-85],[-44.5,-85]]],
  [[[-0.0000005,0],[0.0000005,0]]],[[[0,0],[0,0]]],
  [[[0,0],[.25,0]],[[.25,0],[.5,0]]],
];
for(let i=0;i<145;i++){
  const x=-165+i*.51,y=i%80-40;
  const a=[x,y],b=[x+(i%6+1)*.31,y+((i*7)%11-5)*.27];
  fixtures.push([[a,b]]);
}
test('refinement and mesh threshold are provided by C++',()=>{
  assert.equal(core.boundaryDefaultMaxEdgeDegrees,0.499);
  assert.equal(typeof core.boundaryRefineSegments,'function');
});
test('C++ web display refinement preserves original JS exact microdegree edges',()=>{
  for(const limit of [0.499,2,.02]) for(const edges of fixtures){
    const result=core.boundaryRefineSegments(edges,limit);
    assert.deepEqual(result,reference(edges,limit),JSON.stringify({limit,edges}));
  }
});
test('invalid input never silently falls back to JavaScript',()=>{
  for(const input of [null,{},[[[0,0]]],[[[NaN,0],[0,0]]]])
    assert.throws(()=>core.boundaryRefineSegments(input,.499),e=>e?.code==='PL-BOUNDARY-REFINEMENT');
});
