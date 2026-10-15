import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const modulePath=resolve(process.env.PANDOEDITOR_WASM_MODULE
  ?? 'build-native/p1/pando-wasm/shared/wasm/pandoeditor-core.js');
const {default:createCore}=await import(pathToFileURL(modulePath));
const core=await createCore({wasmBinary:await readFile(modulePath.replace(/\.js$/,'.wasm'))});

// A frozen historic JavaScript oracle, used only to prove the replacement's
// output order before its active production implementation is removed.
function reference(segments) {
  const key = point => point.map(value => Number(value).toFixed(7)).join(',');
  const edges = segments.map(([a,b]) => ({a,b,start:key(a),end:key(b)}));
  const nodes = new Map();
  edges.forEach((edge,index) => {
    for (const endpoint of [edge.start,edge.end]) {
      if (!nodes.has(endpoint)) nodes.set(endpoint,[]);
      nodes.get(endpoint).push(index);
    }
  });
  const used = new Set(),lines=[];
  function walk(index,start) {
    const points=[];let cursor=start;
    while(!used.has(index)) {
      used.add(index);
      const edge=edges[index],forward=edge.start===cursor;
      if(!points.length)points.push(forward?edge.a:edge.b);
      points.push(forward?edge.b:edge.a);
      cursor=forward?edge.end:edge.start;
      const incident=nodes.get(cursor);
      if(incident.length!==2)break;
      const next=incident.find(candidate=>!used.has(candidate));
      if(next===undefined)break;
      index=next;
    }
    lines.push(points);
  }
  for(const [node,incident] of nodes)if(incident.length!==2)
    for(const index of incident)if(!used.has(index))walk(index,node);
  edges.forEach((edge,index)=>{if(!used.has(index))walk(index,edge.start)});
  return lines;
}

test('P5-5 exposes a single C++ source of boundary-chain ordering',()=>{
  assert.equal(typeof core.boundaryConnectChains,'function');
  assert.equal(core.coreAbiVersion,1);
});
test('P5-5 C++ matches original JS junction, reversed, loop, multi-owner edge order',()=>{
  const examples=[
    [],
    [[[0,0],[1,0]],[[2,0],[1,0]],[[2,0],[3,0]]],
    [[[0,0],[1,0]],[[1,0],[2,0]],[[1,0],[1,1]],[[4,0],[5,0]]],
    [[[0,0],[1,0]],[[1,0],[1,1]],[[1,1],[0,0]]],
    [[[0,0],[1,0]],[[0,0],[1,0]],[[0,0],[0,0]],[[2,0],[3,0]]],
    [[[0.00390625,1],[1,1]],[[0.0039063,1],[0.00390625,1]]],
    [[[0.00000005,1],[1,1]],[[0,1],[2,1]]],
    [[[180,-89],[-180,-89]],[[180,-89],[-180,-89]]],
    [[[-180,45],[-179,45]],[[-179,45],[-178,45]]],
    [[[-0.00390625,1],[1,1]],[[-0.0039063,1],[-0.00390625,1]]],
  ];
  // Deterministically exercise many distinct insertion and orientation orders.
  for(let i=0;i<65;i++) {
    const base=i*.31;
    const points=Array.from({length:12},(_,k)=>[base+(k%4),Math.floor(k/4)]);
    const edges=Array.from({length:36},(_,k)=>{
      const a=(k*7+i)%points.length,b=(k*5+3*i+1)%points.length;
      return k%3===0?[points[b],points[a]]:[points[a],points[b]];
    });
    examples.push(edges);
  }
  for(const edges of examples) {
    assert.deepEqual(core.boundaryConnectChains(edges),reference(edges),
      JSON.stringify(edges).slice(0,180));
    assert.deepEqual(edges,structuredClone(edges),'source geometry remains immutable');
  }
});
test('P5-5 invalid wire segments fail explicitly',()=>{
  for(const input of [null,{},[[[0,0]]],[[[0,0],[Infinity,0]]],
    [[[0,0],["1",0]]],[[[NaN,0],[0,0]]]]) {
    assert.throws(()=>core.boundaryConnectChains(input),error=>error?.code==='PL-BOUNDARY-001');
  }
});
