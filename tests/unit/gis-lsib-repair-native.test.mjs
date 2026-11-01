import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {applyLSIBCountryPatches,validateLSIBCountryRepair} from '../../tools/gis/lsib-screen-native.mjs';

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
test('shared-country patch validates the unchanged union before returning',{skip:!binary},async()=>{
  const rows=JSON.parse(await readFile(new URL('../fixtures/lsib-ring-oracle.json',import.meta.url),'utf8')).cases;
  const [left,right]=rows,geometries={left:left.geometry,right:right.geometry};
  const patch=row=>({old:row.old,replacement:row.replacement});
  assert.deepEqual(await applyLSIBCountryPatches({geometries,patches:{left:[patch(left)],right:[patch(right)]}},{binary}),
    {left:left.expected,right:right.expected});
  await assert.rejects(applyLSIBCountryPatches({geometries,patches:{left:[patch(left)]}},{binary}),
    error=>error.code==='LSIB_REPAIR_REJECTED');
});
test('selected AUT-LIE country remains valid against its original geometry',{
  skip:!binary||!process.env.PANDO_LSIB_RING_ORACLE
},async()=>{
  const input=JSON.parse(await readFile(process.env.PANDO_LSIB_RING_ORACLE,'utf8'));
  assert.deepEqual(await validateLSIBCountryRepair({before:{AUT:input.geometry},after:{AUT:input.geometry},
    expectedUnion:null,correctedCountry:null},{binary}),{valid:true});
  assert.deepEqual(await validateLSIBCountryRepair({before:{AUT:input.geometry},after:{AUT:input.ringExpected},
    expectedUnion:null,correctedCountry:null},{binary}),{valid:true});
});
