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
  assert.deepEqual(shared.slice(0,2),[[1,0],[1,1]]);
  assert.equal(shared[2].length,2);
  assert.deepEqual(shared[2].map(ref=>ref.slice(0,2)),[[0,1],[1,3]]);
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
test('malformed row and pair schemas fail explicitly',()=>{
  for(const args of [
    [null,[]],[[[r([0,0],[1,0])]],[[0,1]]],
    [[[r([0,0],[1,0])]],[[0,0]]],
    [[[[[0,0],[1,0],0,0]]],[[0,1]]],
    [[r([0,0],[1,0])],[[0,1]]],
  ])assert.throws(()=>core.countryContactPairsBatch(...args),e=>e?.code==='PL-COUNTRY-CONTACT');
});
