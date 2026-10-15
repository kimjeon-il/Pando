import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const modulePath=resolve(process.env.PANDOEDITOR_WASM_MODULE
  ?? 'build-native/p1/pando-wasm/shared/wasm/pandoeditor-core.js');
const {default:createCore}=await import(pathToFileURL(modulePath));
const core=await createCore({wasmBinary:await readFile(modulePath.replace(/\.js$/,'.wasm'))});

// Frozen pre-migration node-bucket and point-projection algorithm. This
// oracle is testing only: production uses the source-matched shared C++ core.
function reference(edges,nodes,epsilon=1e-7) {
  const bucketSize=.25, buckets=new Map();
  const cellKey=(x,y)=>x+':'+y;
  nodes.forEach((point,index)=>{
    const key=cellKey(Math.floor(point[0]/bucketSize),Math.floor(point[1]/bucketSize));
    if(!buckets.has(key))buckets.set(key,[]);
    buckets.get(key).push(index);
  });
  const position=(point,[a,b])=>{
    const dx=b[0]-a[0],dy=b[1]-a[1],length2=dx*dx+dy*dy;
    if(!length2)return null;
    const t=((point[0]-a[0])*dx+(point[1]-a[1])*dy)/length2;
    if(t<-epsilon||t>1+epsilon)return null;
    const x=a[0]+dx*t,y=a[1]+dy*t;
    if(Math.hypot(point[0]-x,point[1]-y)>epsilon)return null;
    return Math.max(0,Math.min(1,t));
  };
  return edges.map(edge=>{
    const [[ax,ay],[bx,by]]=edge;
    const minX=Math.floor((Math.min(ax,bx)-epsilon)/bucketSize);
    const maxX=Math.floor((Math.max(ax,bx)+epsilon)/bucketSize);
    const minY=Math.floor((Math.min(ay,by)-epsilon)/bucketSize);
    const maxY=Math.floor((Math.max(ay,by)+epsilon)/bucketSize);
    const cellCount=(maxX-minX+1)*(maxY-minY+1);
    const near=[];
    if(cellCount>4096)nodes.forEach((_,i)=>near.push(i));
    else for(let x=minX;x<=maxX;x++)for(let y=minY;y<=maxY;y++)
      near.push(...(buckets.get(cellKey(x,y))||[]));
    return near.map(i=>[i,position(nodes[i],edge)])
      .filter(([,t])=>t!==null).sort((a,b)=>a[1]-b[1]);
  });
}
const cases=[
  {edges:[[[0,0],[1,0]],[[1,0],[0,0]]],nodes:[[0,0],[1,0],[.25,0],[.75,0],[.5,0]]},
  {edges:[[[-179,10],[179,10]]],nodes:[[-179,10],[0,10],[179,10],[0,11]]},
  {edges:[[[179.8,85],[-179.8,85]]],nodes:[[179.8,85],[-179.8,85],[0,85]]},
  {edges:[[[.25,0],[.25,0]]],nodes:[[.25,0],[.25,.2]]},
  {edges:[[[0,0],[1,0]]],nodes:[[0,.00000009],[1,-.00000009],[.5,0],[.5,.000001]]},
  {edges:[],nodes:[[0,0]]},
];
for(let k=0;k<84;k++){
  const x=-125+k*.67,y=-25+k%51,step=.125+(k%7)*.0625;
  const nodes=Array.from({length:48},(_,i)=>[x+(i%8)*step,y+Math.floor(i/8)*step]);
  const edges=Array.from({length:28},(_,i)=>{
    const a=nodes[(i*7+k)%nodes.length],b=nodes[(i*9+3+k)%nodes.length];
    return i%2===0?[a,b]:[b,a];
  });
  cases.push({edges,nodes});
}
test('shared topology split candidate ABI is compiled in C++',()=>{
  assert.equal(typeof core.boundarySplitCandidatesBatch,'function');
  assert.equal(core.coreAbiVersion,1);
});
test('C++ returns exactly the historical bucket, projected vertex and stable split order',()=>{
  for(const {edges,nodes} of cases){
    const expected=reference(edges,nodes);
    assert.deepEqual(core.boundarySplitCandidatesBatch(edges,nodes,1e-7),expected);
  }
});
test('invalid split input cannot fall back to JavaScript',()=>{
  for(const args of [
    [null,[],1e-7],
    [[[[0,0],[1,0]]],{},1e-7],
    [[[[NaN,0],[1,0]]],[[0,0]],1e-7],
    [[[[0,0],[1,0]]],[[0,0]],-1],
  ])assert.throws(()=>core.boundarySplitCandidatesBatch(...args),
    e=>e?.code==='PL-BOUNDARY-SPLIT');
});
