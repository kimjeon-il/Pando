import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
const context=vm.createContext({});
vm.runInContext(readFileSync(new URL("../shared/frontend/js/vendor/polygon-clipping.min.js",import.meta.url),'utf8'),context);
const clip=context.polygonClipping;
const box=(x,y,w,h)=>[[[[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]]]];
const cases=[];
const add=(operands)=>{for(const operation of ['union','difference','intersection','xor'])cases.push({operation,operands});};
add([box(0,0,2,2),box(1,0,2,2)]);
add([box(0,0,5,5),box(1,1,1,1),box(3,3,1,1)]);
add([box(0,0,2,2),box(10,10,1,1)]);
add([box(0,0,2,2),box(2,0,2,2)]);
add([box(0,0,2,2),box(2,2,2,2)]);
add([box(0,0,2,2),box(0,0,2,2)]);
add([[],box(0,0,1,1)]);
add([[[[[0,0],[4,0],[4,1],[1,1],[1,4],[0,4],[0,0]]]],box(.5,.5,2,2)]);
add([[[[[0,0],[6,0],[6,6],[0,6],[0,0]],[[1,1],[1,5],[5,5],[5,1],[1,1]]]],box(2,2,2,2)]);
add([[[[[0,0],[1e-15,2],[4,4],[4,0],[0,0]]]],[[[[0,1],[4,3],[4,1],[0,1]]]]]);
let seed=127;
const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
for(let i=0;i<30;i++)add(Array.from({length:3},()=>box(random()*8,random()*8,1+random()*5,1+random()*5)));
for(let i=0;i<20;i++){
  const ring=()=>{const x=random()*4,y=random()*4;const p=Array.from({length:14},(_,j)=>{const angle=j*Math.PI*2/14,r=.5+random()*3;return [x+Math.cos(angle)*r,y+Math.sin(angle)*r];});p.push(p[0]);return [[p]];};
  add([ring(),ring()]);
}
const expected=cases.map(({operation,operands})=>JSON.parse(JSON.stringify(clip[operation](...operands))));
cases.push({operation:'union',operands:[box(0,0,1,1)],cancelled:true});
const output=execFileSync(process.argv[2],[],{input:cases.map(c=>JSON.stringify(c)).join('\n')+'\n',encoding:'utf8',maxBuffer:32*1024*1024,timeout:30000}).trim().split('\n').map(JSON.parse);
assert.equal(output.length,cases.length);
const canonical=multi=>multi.map(poly=>poly.map(ring=>{
  const points=ring.slice(0,-1);let first=0;for(let i=1;i<points.length;i++)if(points[i][0]<points[first][0]||(points[i][0]===points[first][0]&&points[i][1]<points[first][1]))first=i;
  return points.slice(first).concat(points.slice(0,first));
}).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
for(let i=0;i<expected.length;i++)assert.deepEqual(canonical(output[i].result||[]),canonical(expected[i]),`case ${i}: ${JSON.stringify(cases[i])}; error=${output[i].error||''}`);
assert.equal(output.at(-1).cancelled,true);
console.log(`${cases.length} native operations match the pinned JS kernel, including cancellation.`);
