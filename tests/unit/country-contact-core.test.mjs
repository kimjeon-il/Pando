import '../helpers/spherical-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreparedBoundaryStore, buildCountrySharedBoundaryContact } from '../../assets/js/modules/boundary-topology.js';
import { computeCountrySharedContacts } from '../../assets/js/modules/country-contact-core.js';
const feature=(id,w,s,e,n)=>({id,geometry:{type:'Polygon',coordinates:[[
  [w,s],[e,s],[e,n],[w,n],[w,s],
]]}});
test('batched source contacts preserve source references and pair order',()=>{
  const prepared=createPreparedBoundaryStore();
  prepared.replace([feature('A',0,0,1,2),feature('B',1,0,2,2),
    feature('C',4,0,5,1),feature('D',5,0,6,1)]);
  const a=prepared.get('A'),b=prepared.get('B'),c=prepared.get('C'),d=prepared.get('D');
  const calculated=computeCountrySharedContacts([[a,b],[c,d]]);
  assert.equal(calculated.length,2);
  assert.equal(calculated[0].length,1);
  assert.equal(calculated[1].length,1);
  assert.deepEqual(calculated[0][0].ownerIds,['A','B']);
  assert.deepEqual(calculated[1][0].ownerIds,['C','D']);
  assert.deepEqual(calculated[0],buildCountrySharedBoundaryContact(a,b));
  for(const ref of calculated[0][0].refs){
    const original=prepared.get(ref.featureId).segments.find(row=>
      row.polygonIndex===ref.polygonIndex && row.ringIndex===ref.ringIndex
      && row.segmentIndex===ref.segmentIndex);
    assert.strictEqual(ref.a,original.a);
    assert.strictEqual(ref.b,original.b);
  }
});
test('the C++ batch retains split contacts and empty batch semantics',()=>{
  const prepared=createPreparedBoundaryStore();
  prepared.replace([feature('ROOT',0,0,1,4),feature('CHILD',1,1,2,3)]);
  const contacts=computeCountrySharedContacts([[prepared.get('ROOT'),prepared.get('CHILD')]]);
  assert.equal(contacts.length,1);
  assert.equal(contacts[0].length,1);
  assert.deepEqual(contacts[0][0].ownerIds,['CHILD','ROOT']);
  assert.deepEqual(computeCountrySharedContacts([]),[]);
});
