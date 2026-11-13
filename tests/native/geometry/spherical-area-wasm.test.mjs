import { loadNodeCore } from '../../../tools/build/load-node-core.mjs';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import test from 'node:test';

// The canonical loader checks compiled source, ABI, compiler and asset hashes.
const core = await loadNodeCore();

// Independent fixed integral values; never derived from the Core under test.
const expectedAreas=[-0.003655219658504655,0.003655219658504655,0.002436691622205077,-0.002436691622205077,12.544610919776167,-0.021759694583007173,-3.0345825661738613e-14];
const fixtures=[
  ['equator',[[0,0],[4,0],[4,3],[0,3],[0,0]]],
  ['hole (reverse)',[[0,0],[0,3],[4,3],[4,0],[0,0]]],
  ['antimeridian',[[179,-2],[179,2],[-179,2],[-179,-2],[179,-2]]],
  ['antimeridian reverse',[[179,-2],[-179,-2],[-179,2],[179,2],[179,-2]]],
  ['north pole',[[170,80],[-170,80],[-90,85],[0,89],[90,85],[170,80]]],
  ['south pole',[[170,-80],[90,-85],[0,-89],[-90,-85],[-170,-80],[170,-80]]],
  ['sub-degree coastal edge',[[10,5],[10.00001,5],[10.00001,5.00001],[10,5.00001],[10,5]]],
];

test('the existing native C++ integral is exposed by the WASM ABI',()=>{
  assert.equal(typeof core.sphericalRingSignedArea,'function');
  assert.equal(typeof core.sphericalRingSignedAreas,'function');
  assert.equal(core.coreAbiVersion,1,'additive functions keep the stored document ABI stable');
});

test('scalar and batch spherical areas match the independent fixed integral',()=>{
  const rings=fixtures.map(([,ring])=>ring);
  const before=structuredClone(rings);
  const bulk=core.sphericalRingSignedAreas(rings);
  assert.equal(bulk.length,fixtures.length);
  for(let i=0;i<fixtures.length;++i) {
    const [name,ring]=fixtures[i],expected=expectedAreas[i];
    const actual=core.sphericalRingSignedArea(ring);
    const tolerance=Math.max(1e-14,Math.abs(expected)*1e-12);
    assert.ok(Number.isFinite(actual),name+' produced a non-finite C++ result');
    assert.ok(Math.abs(actual-expected)<=tolerance,
      name+': C++ '+actual+' differs from fixed integral '+expected);
    assert.ok(Math.abs(bulk[i]-actual)<=tolerance,
      name+': batched and scalar C++ outputs differ');
  }
  assert.deepEqual(rings,before,'read-only native engine must not mutate caller coordinates');
});

test('the WASM bridge rejects invalid coordinates and nonclosed rings',()=>{
  const invalid=[
    [],[[0,0],[1,1],[0,0]],[[0,0],[1,0],[0,1],[2,2]],
    [[0,0],[1,0],[1,91],[0,0]],
    [[0,0],[1,0],[1,NaN],[0,0]],
    [[0,0],[1,0],['1',1],[0,0]]
  ];
  for(const ring of invalid)assert.throws(()=>core.sphericalRingSignedArea(ring));
  assert.throws(()=>core.sphericalRingSignedAreas([fixtures[0][1],invalid[0]]));
});

test('batched ring crossing exposes a bounded diagnostic, not a synthetic FPS pass',()=>{
  const rings=Array.from({length:256},(_,i)=>fixtures[i%fixtures.length][1]);
  const begin=performance.now();
  const batch=core.sphericalRingSignedAreas(rings);
  const elapsed=performance.now()-begin;
  assert.equal(batch.length,rings.length);
  assert.ok(batch.every(Number.isFinite));
  // Inform the current diagnostic; a noisy GitHub runner is not a release budget.
  console.log('Core WASM 256-ring batch ms:',elapsed.toFixed(3));
});
