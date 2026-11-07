import '../helpers/spherical-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import "../../shared/frontend/js/workers/gpu-mesh-core.js";
import { createCountryMeshPreparation } from "../../shared/frontend/js/modules/country-mesh-preparation.js";
const engine = globalThis.PandoLabGpuMeshCore;
const shape = (id, size = 2) => ({ id, geometry: { type: 'Polygon', coordinates: [[[0,0],[size,0],[size,2],[0,2],[0,0]]] } });
const context = { throwIfCancelled() {} };
test('prepared country parts keep exact engine output and reuse only unchanged shapes', async () => {
  const store = createCountryMeshPreparation({ engine });
  const features = [shape('A'), shape('B', 3)];
  const first = await store.build(features, context);
  const expected = engine.buildGpuMeshFeatures(features);
  for (const [key, value] of Object.entries(expected)) {
    if (ArrayBuffer.isView(value)) assert.deepEqual(first[key], value, key);
  }
  assert.deepEqual(first.strokeOwnerRanges, expected.strokeOwnerRanges);
  const copied = structuredClone(first, { transfer: [first.positions.buffer] });
  assert.equal(first.positions.byteLength, 0);
  const second = await store.build([shape('renamed', 3), shape('A')], context);
  assert.equal(second.preparation.builtCount, 0); assert.equal(second.preparation.reusedCount, 2);
  assert.deepEqual(second.countryIds, ['renamed', 'A']);
  assert.equal(second.positions.length, copied.positions.length);
  const changed = await store.build([shape('A', 4), shape('B', 3)], context);
  assert.equal(changed.preparation.builtCount, 1); assert.equal(changed.preparation.reusedCount, 1);
});
test('cache budget and cancellation stay bounded between geometry jobs', async () => {
  const tiny = createCountryMeshPreparation({ engine, byteBudget: 1 });
  await tiny.build([shape('A')], context);
  assert.equal((await tiny.build([shape('A')], context)).preparation.builtCount, 1);
  let cancelled = false;
  const store = createCountryMeshPreparation({ engine,
    yieldTask: async () => { cancelled = true; } });
  await assert.rejects(store.build([shape('A')], { throwIfCancelled() { if (cancelled) throw Error('cancelled'); } }), /cancelled/);
});

test('empty country slots retain their ranges and full-world bounds', async () => {
  const store = createCountryMeshPreparation({ engine });
  const features = [{ id: 'empty', geometry: null }, shape('A')];
  const mesh = await store.build(features, context);
  const expected = engine.buildGpuMeshFeatures(features);
  for (const key of ['countryTriangleRanges', 'countryBoundaryRanges', 'countryBounds', 'countryBoundsFlags']) assert.deepEqual(mesh[key], expected[key]);
});

import { prepareMeshSpatialBlocks, visibleSpatialBlockRanges, coalesceSpatialBlockRanges } from '../../shared/frontend/js/modules/mesh-spatial-blocks.js';

test('spatial BVH packs large country meshes without boxed intermediate arrays or lost primitives', () => {
  const positions = Int32Array.from([0,0, 1000000,0, 0,1000000, 12000000,0, 13000000,0, 12000000,1000000]);
  const triangleCount = 2300;
  const triangleIndices = new Uint32Array(triangleCount * 3);
  for (let i = 0; i < triangleCount; i++) triangleIndices.set(i % 2 ? [3,4,5] : [0,1,2], i * 3);
  const make = () => ({ positions, triangleIndices:triangleIndices.slice(), lineIndices:Uint32Array.from([0,1,1,2,3,4,4,5]),
    countryTriangleRanges:Uint32Array.from([0,triangleIndices.length]), countryBoundaryRanges:Uint32Array.from([0,8]) });
  const first = prepareMeshSpatialBlocks(make()), second = prepareMeshSpatialBlocks(make());
  assert.deepEqual(first.triangleIndices,second.triangleIndices,'partition order remains deterministic');
  assert.deepEqual(first.spatialBlocks,second.spatialBlocks,'tree serialization remains deterministic');
  const tree = first.spatialBlocks.triangle;
  assert.ok(tree.ranges.length > 2,'large geometry must actually partition');
  assert.equal(tree.children.length,tree.ranges.length);
  assert.equal(tree.bounds.length,tree.ranges.length * 3);
  assert.equal(tree.geographicBounds.length,tree.ranges.length * 2);
  assert.equal(first.triangleIndices.length,triangleIndices.length);
  assert.deepEqual([...first.triangleIndices].sort((a,b)=>a-b),[...triangleIndices].sort((a,b)=>a-b));
  const visible = visibleSpatialBlockRanges(first,{mode:0,cssViewport:[1280,800],cssTranslate:[640,400],cssScale:500,
    rowX:[1,0,0],rowY:[0,1,0],rowZ:[0,0,1]},'triangle');
  assert.ok(Array.isArray(visible));
  assert.ok(visible.every(range=>range.count>0&&range.first+range.count<=triangleIndices.length));
});

// Quadratic reference is a test oracle only; production uses the heap.
test('spatial range coalescing retains the exact minimum-gap and earliest-tie semantics', () => {
  const baseline=(input,limit)=>{
    const ranges=input.map(range=>({...range}));
    while(ranges.length>limit){
      let best=0;
      for(let i=1;i<ranges.length-1;i++)if(
        ranges[i+1].first-ranges[i].first-ranges[i].count
        <ranges[best+1].first-ranges[best].first-ranges[best].count)best=i;
      ranges[best].count=ranges[best+1].first+ranges[best+1].count-ranges[best].first;
      ranges.splice(best+1,1);
    }
    return ranges;
  };
  const inputs=[
    Array.from({length:300},(_,i)=>({first:i*5,count:2})),
    Array.from({length:300},(_,i)=>({first:i*9+(i%4===0?2:0),count:3})),
    Array.from({length:300},(_,i)=>({first:i*19+(i%7),count:4})),
  ];
  for(const input of inputs)for(const limit of [1,2,17,96,120,300]){
    const actual=coalesceSpatialBlockRanges(input.map(row=>({...row})),limit);
    assert.deepEqual(actual,baseline(input,limit),`merge mismatch for limit ${limit}`);
  }
});
