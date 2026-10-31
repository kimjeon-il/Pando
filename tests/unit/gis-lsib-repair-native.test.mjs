import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {validateLSIBCountryRepair} from '../../tools/gis/lsib-screen-native.mjs';

const binary=process.env.PANDO_TERRITORIAL_RECIPE_BINARY;
const oracle=JSON.parse(await readFile(new URL('../fixtures/lsib-repair-oracle.json',import.meta.url),'utf8'));
test('native country repair rejects overlap, union, component, hole and ownership changes',{skip:!binary},async()=>{
  for(const row of oracle.cases){
    const request={before:row.before,after:row.after,expectedUnion:row.expectedUnion,correctedCountry:row.correctedCountry};
    const original=structuredClone(request);
    if(row.valid)assert.deepEqual(await validateLSIBCountryRepair(request,{binary}),{valid:true},row.name);
    else await assert.rejects(validateLSIBCountryRepair(request,{binary}),error=>error.code==='LSIB_REPAIR_REJECTED'&&
      error.message.includes(row.error.split(':')[0]),row.name);
    assert.deepEqual(request,original,row.name);
  }
});
test('selected AUT-LIE country remains valid against its original geometry',{
  skip:!binary||!process.env.PANDO_LSIB_RING_ORACLE
},async()=>{
  const input=JSON.parse(await readFile(process.env.PANDO_LSIB_RING_ORACLE,'utf8'));
  assert.deepEqual(await validateLSIBCountryRepair({before:{AUT:input.geometry},after:{AUT:input.geometry},
    expectedUnion:null,correctedCountry:null},{binary}),{valid:true});
});
