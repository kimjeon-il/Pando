import assert from 'node:assert/strict';
import test from 'node:test';
import {screenSpectralDN}
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
