import '../helpers/spherical-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreparedBoundaryStore, buildCountrySharedBoundaryContact, buildCountrySharedBoundarySegments,
  attachBoundarySegmentReferences } from "../../shared/frontend/js/modules/boundary-topology.js";
import { computeCountrySharedContacts } from "../../shared/frontend/js/modules/country-contact-core.js";
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
test('prepared geographic lookup excludes Greenwich false contacts and finds shifted dateline contacts',()=>{
  const dateline=feature('DATE',179,0,-179,1),greenwich=feature('ZERO',0,1,1,2);
  const prepared=createPreparedBoundaryStore();prepared.replace([dateline,greenwich]);
  assert.deepEqual(buildCountrySharedBoundarySegments([dateline,greenwich],{preparedStore:prepared}),[]);
  const shifted=feature('SHIFT',539,1,541,2);
  prepared.replace([dateline,shifted]);
  const before=prepared.stats().preparationCount;
  const contacts=buildCountrySharedBoundarySegments([dateline,shifted],{preparedStore:prepared});
  assert.equal(contacts.length,2);
  for(const contact of contacts){
    assert.ok(Math.abs(contact.start[0])>=179&&Math.abs(contact.end[0])>=179);
    const restored=attachBoundarySegmentReferences({...contact,refs:undefined},prepared);
    assert.equal(restored.refs.length,2);
    assert.deepEqual(restored.refs.map(ref=>ref.featureId),['DATE','SHIFT']);
  }
  assert.equal(prepared.stats().preparationCount,before);
});
