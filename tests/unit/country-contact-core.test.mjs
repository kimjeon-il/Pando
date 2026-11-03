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

test('P6 sparse C++ source preserves full pair results and current source refs',()=>{
  const local=[[0,0],[1,0],[1,2],[0,2],[0,0]];
  const far=Array.from({length:1001},(_,index)=>{
    const theta=index/1000*Math.PI*2;
    return [110+Math.cos(theta),45+Math.sin(theta)];
  });
  const a={id:'A',geometry:{type:'MultiPolygon',coordinates:[[local],[far]]}};
  const b=feature('B',1,0,2,2);
  const prepared=createPreparedBoundaryStore();
  prepared.replace([a,b]);
  const left=prepared.get('A'),right=prepared.get('B'),profile=[];
  const sparse=computeCountrySharedContacts([[left,right]],(stage,ms,details)=>
    profile.push({stage,ms,...details}),{verifyParity:true});
  const full=computeCountrySharedContacts([[left,right]],null,{unpruned:true});
  assert.deepEqual(sparse,full);
  const pruned=profile.find(row=>row.stage==='contact-select-source');
  assert.ok(pruned.selectedEdges<pruned.sourceEdges/2,
    'irrelevant distant coastline must not enter the contact native index');
  assert.equal(profile.find(row=>row.stage==='contact-parity-full').matched,true);
  for(const ref of sparse[0][0].refs){
    const source=prepared.get(ref.featureId).segments.find(row=>
      row.polygonIndex===ref.polygonIndex&&row.ringIndex===ref.ringIndex
      &&row.segmentIndex===ref.segmentIndex);
    assert.strictEqual(ref.a,source.a);
    assert.strictEqual(ref.b,source.b);
  }
});
test('P6 sparse indexing matches full C++ native contacts at the shifted dateline',()=>{
  const prepared=createPreparedBoundaryStore();
  const a=feature('A',179,0,-179,1),b=feature('B',539,1,541,2);
  prepared.replace([a,b]);
  const pair=[[prepared.get('A'),prepared.get('B')]];
  const baseline=computeCountrySharedContacts(pair,null,{unpruned:true});
  const sparse=computeCountrySharedContacts(pair,null,{verifyParity:true});
  assert.deepEqual(sparse,baseline);
});
