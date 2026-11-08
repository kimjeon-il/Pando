import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

// Runs against the *freshly compiled* P2 WASM output, never a stale browser copy.
const path=resolve(process.env.PANDOEDITOR_WASM_MODULE
  ?? 'build-native/wasm/wasm/pandoeditor-core.js');
const { default:createCore }=await import(pathToFileURL(path));
const wasm=await readFile(path.replace(/\.js$/,'.wasm'));
const core=await createCore({wasmBinary:wasm});

// Immutable test-only reference: the pre-P5 browser D3 integral. This is NOT
// used in product runtime. Retain it for parity after JS algorithm removal.
function legacyBrowserSignedArea(ring) {
  const rad=Math.PI/180,quarterPi=Math.PI/4;
  let area=0,prevLon=ring[0][0]*rad,phi=ring[0][1]*rad/2+quarterPi;
  let prevCos=Math.cos(phi),prevSin=Math.sin(phi);
  for(let i=1;i<ring.length;++i) {
    const lon=ring[i][0]*rad;
    phi=ring[i][1]*rad/2+quarterPi;
    const sin=Math.sin(phi),cos=Math.cos(phi),delta=lon-prevLon,k=prevSin*sin;
    area+=Math.atan2(k*Math.sin(delta),prevCos*cos+k*Math.cos(delta));
    prevLon=lon;prevSin=sin;prevCos=cos;
  }
  return area*2;
}
const fixtures=[
  ['equator',[[0,0],[4,0],[4,3],[0,3],[0,0]]],
  ['hole (reverse)',[[0,0],[0,3],[4,3],[4,0],[0,0]]],
  ['antimeridian',[[179,-2],[179,2],[-179,2],[-179,-2],[179,-2]]],
  ['antimeridian reverse',[[179,-2],[-179,-2],[-179,2],[179,2],[179,-2]]],
  ['north pole',[[170,80],[-170,80],[-90,85],[0,89],[90,85],[170,80]]],
  ['south pole',[[170,-80],[90,-85],[0,-89],[-90,-85],[-170,-80],[170,-80]]],
  ['sub-degree coastal edge',[[10,5],[10.00001,5],[10.00001,5.00001],[10,5.00001],[10,5]]],
];

test('the existing native C++ integral is exposed by the new WASM ABI',()=>{
  assert.equal(typeof core.sphericalRingSignedArea,'function');
  assert.equal(typeof core.sphericalRingSignedAreas,'function');
  assert.equal(core.coreAbiVersion,1,'additive functions keep the stored document ABI stable');
});

test('scalar and batch spherical areas match the original browser integral',()=>{
  const rings=fixtures.map(([,ring])=>ring);
  const before=structuredClone(rings);
  const bulk=core.sphericalRingSignedAreas(rings);
  assert.equal(bulk.length,fixtures.length);
  for(let i=0;i<fixtures.length;++i) {
    const [name,ring]=fixtures[i],expected=legacyBrowserSignedArea(ring);
    const actual=core.sphericalRingSignedArea(ring);
    const tolerance=Math.max(1e-14,Math.abs(expected)*1e-12);
    assert.ok(Number.isFinite(actual),name+' produced a non-finite C++ result');
    assert.ok(Math.abs(actual-expected)<=tolerance,
      name+': C++ '+actual+' differs from legacy JS '+expected);
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
  // Inform the P5 comparison; a noisy GitHub runner is not a release budget.
  console.log('P5-1 WASM 256-ring batch ms:',elapsed.toFixed(3));
});
