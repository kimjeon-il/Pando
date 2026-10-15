import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const path=resolve(process.env.PANDOEDITOR_WASM_MODULE
  ?? 'build-native/p1/pando-wasm/shared/wasm/pandoeditor-core.js');
const {default:createCore}=await import(pathToFileURL(path));
const core=await createCore({wasmBinary:await readFile(path.replace(/\.js$/,'.wasm'))});
const r=(a,b,i=0)=>[a,b,0,0,i];
const box=(x0,y0,x1,y1)=>[
  r([x0,y0],[x1,y0],0),r([x1,y0],[x1,y1],1),
  r([x1,y1],[x0,y1],2),r([x0,y1],[x0,y0],3)];
test('C++ country candidate and shared-contact source ABI is callable',()=>{
  assert.equal(typeof core.countryContactPairsBatch,'function');
});
test('country contact topology keeps ordered source refs for split and reversed edges',()=>{
  const a=box(0,0,1,1),b=box(1,0,2,1);
  const result=core.countryContactPairsBatch([a,b],[[0,1]])[0];
  assert.equal(result[1].length,1);
  const shared=result[1][0];
  // The earliest encountered source row may run north-to-south. C++ must
  // retain that real orientation; original Web parity checks it independently.
  assert.ok(shared[0][0]===1 && shared[1][0]===1);
  assert.deepEqual([shared[0][1],shared[1][1]].sort((a,b)=>a-b),[0,1]);
  assert.equal(shared[2].length,2);
  assert.deepEqual(shared[2].map(ref=>ref.slice(0,2)).sort((a,b)=>a[0]-b[0]),[[0,1],[1,3]]);
  const reverse=core.countryContactPairsBatch([a,b],[[1,0]])[0];
  assert.equal(reverse[1].length,1);
  const split=core.countryContactPairsBatch([a,[r([1,0],[1,.5]),r([1,.5],[1,1],1)]],[[0,1]])[0];
  assert.equal(split[1].length,2);
});
test('distant and polar contacts have no visible shared segments',()=>{
  assert.deepEqual(core.countryContactPairsBatch([box(0,0,1,1),box(20,20,21,21)],[[0,1]])[0][1],[]);
  assert.deepEqual(core.countryContactPairsBatch([
    [r([-179,90],[179,90])],[r([-179,90],[179,90])]],[[0,1]])[0][1],[]);
});
test('dateline crossings cannot create a shared boundary at Greenwich',()=>{
  const dateline=box(179,0,-179,1),greenwich=box(0,1,1,2);
  const snapshot=structuredClone([dateline,greenwich]);
  for(const pair of [[[0,1]],[[1,0]]])
    assert.deepEqual(core.countryContactPairsBatch([dateline,greenwich],pair)[0][1],[]);
  assert.deepEqual([dateline,greenwich],snapshot);
});
test('real dateline shared boundaries retain split geometry and original rows',()=>{
  const left=box(179,0,-179,1),right=box(179,1,-179,2);
  const segments=core.countryContactPairsBatch([left,right],[[0,1]])[0][1];
  assert.equal(segments.length,2);
  for(const [a,b,refs] of segments){
    assert.equal(a[1],1);assert.equal(b[1],1);
    assert.ok(Math.abs(a[0])>=179&&Math.abs(b[0])>=179);
    assert.ok(Math.abs(a[0]-b[0])<=1);
    assert.deepEqual(refs.map(ref=>ref.slice(0,2)).sort((a,b)=>a[0]-b[0]),[[0,2],[1,0]]);
  }
  const shifted=box(539,0,541,1);
  assert.equal(core.countryContactPairsBatch([shifted,right],[[0,1]])[0][1].length,2);
});
test('malformed row and pair schemas fail explicitly',()=>{
  for(const args of [
    [null,[]],[[[r([0,0],[1,0])]],[[0,1]]],
    [[[r([0,0],[1,0])]],[[0,0]]],
    [[[[[0,0],[1,0],0,0]]],[[0,1]]],
    [[r([0,0],[1,0])],[[0,1]]],
  ])assert.throws(()=>core.countryContactPairsBatch(...args),e=>e?.code==='PL-COUNTRY-CONTACT');
});
