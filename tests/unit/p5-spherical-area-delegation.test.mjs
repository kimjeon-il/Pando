import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source=readFileSync(new URL("../../shared/frontend/js/modules/polygon-geometry.js",import.meta.url),'utf8');
const ring=[[179,-2],[179,2],[-179,2],[-179,-2],[179,-2]];

function loadedCore() {
  const calls={scalar:0,batch:0};
  const nativeCpp={
    sphericalRingSignedArea(value) {
      calls.scalar++;
      assert.deepEqual(Array.from(value),ring);
      return 12.5;
    },
    sphericalRingSignedAreas(values) {
      calls.batch++;
      assert.equal(values.length,2);
      return [12.5,-12.5];
    },
  };
  const context=vm.createContext({PandoLabSphericalCore:{
    ...nativeCpp, normalizePolygonGeometry(){},normalizePolygonRing(){},hasCanonicalPolygonWinding(){}
  }});
  vm.runInContext(source,context);
  return {context,calls,nativeCpp,api:context.PandoLabPolygonGeometry};
}
test('live Web delegates scalar and multi-ring spherical areas to compiled Core',()=>{
  const {calls,api}=loadedCore();
  const original=structuredClone(ring);
  assert.equal(api.sphericalSignedArea(ring),12.5);
  assert.equal(JSON.stringify(api.sphericalSignedAreas([ring,ring])),JSON.stringify([12.5,-12.5]));
  assert.deepEqual(ring,original);
  assert.deepEqual(calls,{scalar:1,batch:1});
  assert.doesNotMatch(source,/Math\.atan2\s*\(/,
    'the legacy spherical geodesic integral must not survive in runtime JS');
});
test('Qt uses the explicit native C++ bridge rather than an unrelated JS fallback',()=>{
  const {context,api,calls}=loadedCore();
  const qtCalls=[];
  context.PandoLabSphericalAreaCore={
    sphericalRingSignedArea:()=>{qtCalls.push('scalar');return 5.5;},
    sphericalRingSignedAreas:()=>{qtCalls.push('batch');return [5.5];}
  };
  assert.equal(api.sphericalSignedArea(ring),5.5);
  assert.equal(api.sphericalSignedAreas([ring])[0],5.5);
  assert.deepEqual(qtCalls,['scalar','batch']);
  assert.equal(calls.scalar,0);
  assert.equal(calls.batch,0);
});
test('missing C++ capability is a visible error; never a silent JS approximation',()=>{
  const {context,api}=loadedCore();
  delete context.PandoLabSphericalCore;
  assert.throws(()=>api.sphericalSignedArea(ring),
    error=>error.code==='PL-GEOMETRY-WASM-001');
  assert.throws(()=>api.sphericalSignedAreas([ring]),
    error=>error.code==='PL-GEOMETRY-WASM-001');
});
