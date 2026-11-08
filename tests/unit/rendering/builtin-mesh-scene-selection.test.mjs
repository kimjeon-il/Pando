import test from 'node:test';
import assert from 'node:assert/strict';
import { builtinMeshMatchesScene } from '../../../src/rendering/country-mesh-content-key.js';

const feature=(id,coords=[[[0,0],[1,0],[1,1],[0,0]]])=>({
  id,geometry:{type:'Polygon',coordinates:coords},
});
const sources=[feature('AAA'),feature('BBB')];
const sourceById=new Map(sources.map(f=>[f.id,JSON.stringify(f.geometry)]));
const equals=(id,geometry)=>sourceById.get(id)===JSON.stringify(geometry);

test('accepts exact country slots and geometry without altering source',()=>{
  assert.equal(builtinMeshMatchesScene({slotIds:['AAA','BBB'],features:sources,geometryEquals:equals}),true);
  assert.deepEqual(sources.map(f=>f.id),['AAA','BBB']);
});
test('rejects shifted slots, removed territories and duplicates',()=>{
  for(const [slotIds,features] of [
    [['BBB','AAA'],sources],
    [['AAA','BBB'],[feature('AAA')]],
    [['AAA','AAA'],[sources[0],sources[0]]],
    [['AAA','BBB'],[sources[0],feature('AAA')]],
  ]) assert.equal(builtinMeshMatchesScene({slotIds,features,geometryEquals:equals}),false);
});
test('rejects same-ID changed geometry, scope merges and absent source proof',()=>{
  assert.equal(builtinMeshMatchesScene({slotIds:['AAA','BBB'],
    features:[feature('AAA',[[[0,0],[2,0],[2,2],[0,0]]]),sources[1]],geometryEquals:equals}),false);
  assert.equal(builtinMeshMatchesScene({slotIds:['AAA','BBB'],
    features:[feature('AAA'),{id:'BBB',geometry:null}],geometryEquals:equals}),false);
  assert.equal(builtinMeshMatchesScene({slotIds:['AAA','BBB'],
    features:sources,geometryEquals:()=>false}),false);
  assert.equal(builtinMeshMatchesScene({slotIds:['AAA','BBB'],features:sources}),false);
});
