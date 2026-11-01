import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {prepareLSIBEnclave} from '../../tools/gis/lsib-screen-native.mjs';

const binary=process.env.PANDO_TERRITORIAL_RECIPE_BINARY;
const oracle=JSON.parse(await readFile(new URL('../fixtures/lsib-enclave-oracle.json',import.meta.url),'utf8'));
function equivalent(actual,expected){
  assert.deepEqual(actual.geometries,expected.geometries);assert.equal(actual.sections.length,expected.sections.length);
  for(let i=0;i<actual.sections.length;i++){
    const a=actual.sections[i],b=expected.sections[i];
    for(const key of ['countries','closedRing','enclave','master_vertices','derived_vertices'])assert.deepEqual(a[key],b[key],key);
    for(const key of ['old_length_degrees','source_length_degrees','simplification_bound_px'])assert.ok(Math.abs(a[key]-b[key])<1e-10,key);
  }
}
test('native enclave repair preserves both owners and rejects unreviewed boundaries',{skip:!binary},async()=>{
  for(const row of oracle.cases){
    const {name,expected,error,...request}=row,before=structuredClone(request);
    if(error)await assert.rejects(prepareLSIBEnclave(request,{binary}),value=>value.code==='LSIB_ENCLAVE_REJECTED',name);
    else equivalent(await prepareLSIBEnclave(request,{binary}),expected);
    assert.deepEqual(request,before,name);
  }
});
test('selected IGM enclave repair matches its frozen Python output',{
  skip:!binary||!process.env.PANDO_LSIB_ENCLAVE_ORACLE
},async()=>{
  const {expected,...request}=JSON.parse(await readFile(process.env.PANDO_LSIB_ENCLAVE_ORACLE,'utf8'));
  equivalent(await prepareLSIBEnclave(request,{binary}),expected);
});
test('enclave exposes an unavailable native binary',async()=>{
  const {name,expected,error,...request}=oracle.cases[0];
  await assert.rejects(prepareLSIBEnclave(request,{binary:'missing-lsib-native'}),/native.*failed/i);
});
