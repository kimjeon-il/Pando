import assert from 'node:assert/strict';
import test from 'node:test';
import {screenSpectralDN,measureSpectralConnectivity}
  from '../../tools/gis/baikonur-landsat-pixel-preflight.mjs';
test('clear Landsat 5 green and NIR reflectance classifies true water',()=>{
  const green=new Uint16Array([16000,9000,16000,16000]);
  const nir=new Uint16Array([9000,16000,9000,9000]);
  const qa=new Uint16Array([0,0,8,1]);
  const r=screenSpectralDN(green,nir,qa);
  assert.equal(r.clean,2);
  assert.equal(r.waterN,1);
  assert.deepEqual([...r.water],[1,0,0,0]);
});
test('cloud, fill, snow, shadow and negative reflectance are not usable water',()=>{
  const g=new Uint16Array([15000,15000,15000,15000,7000]);
  const n=new Uint16Array([8000,8000,8000,8000,7000]);
  const qa=new Uint16Array([1,2,8,32,0]);
  const r=screenSpectralDN(g,n,qa);
  assert.equal(r.clean,0);
  assert.equal(r.waterN,0);
});
test('spectral grids cannot mix pixels of unequal lengths',()=>{
  assert.throws(()=>screenSpectralDN(new Uint16Array(2),
    new Uint16Array(3),new Uint16Array(2)),/Unaligned/);
});

test('8-neighbour spectral connectivity accepts an actual shared water component',()=>{
  const w=new Uint8Array([
    1,0,0,0,0,
    0,1,0,0,0,
    0,0,1,0,0,
    0,0,0,1,0,
  ]);
  const audit=measureSpectralConnectivity(w,5,4,[0,18]);
  assert.equal(audit.componentCount,1);
  assert.equal(audit.maxComponentSize,4);
  assert.equal(audit.bothAnchorsOnSameWaterComponent,true);
});
test('disconnected river candidates must not be treated as one legal shoreline',()=>{
  const w=new Uint8Array([
    1,1,0,0,1,
    1,0,0,0,1,
    0,0,0,0,1,
  ]);
  const audit=measureSpectralConnectivity(w,5,3,[0,14]);
  assert.equal(audit.componentCount,2);
  assert.equal(audit.bothAnchorsOnSameWaterComponent,false);
});
test('zero-water and off-grid points cannot generate a false connected-bank claim',()=>{
  const zeros=measureSpectralConnectivity(new Uint8Array(12),4,3,[-1,11]);
  assert.equal(zeros.componentCount,0);
  assert.equal(zeros.bothAnchorsOnSameWaterComponent,false);
  assert.throws(()=>measureSpectralConnectivity(new Uint8Array(12),3,3),/dimensions/);
});
