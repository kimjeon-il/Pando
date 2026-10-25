import '../helpers/spherical-core.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareBoundaryFeature,buildBoundaryTopologyFromSegments} from "../../shared/frontend/js/modules/boundary-topology.js";
import {computeCountrySharedContacts} from "../../shared/frontend/js/modules/country-contact-core.js";
import {buildRenderableBoundarySegments} from "../../shared/frontend/js/modules/geographic-boundary.js";
import {padBoundaryBounds,segmentBounds} from "../../shared/frontend/js/modules/boundary-spatial-index.js";
import {sharedCalculationCore} from "../../shared/frontend/js/modules/temporal.js";

const rectangle=(id,w,s,e,n)=>({id,geometry:{type:'Polygon',coordinates:[[
  [w,s],[e,s],[e,n],[w,n],[w,s],
]]}});
const encode=feature=>feature.segments.map(({a,b,polygonIndex,ringIndex,segmentIndex})=>
  [a,b,polygonIndex,ringIndex,segmentIndex]);

// Frozen pre-migration Web broad phase and topology assembly. Only the test
// retains these calculations; production uses the shared C++ contact engine.
function reference(left,right) {
  const overlap=[Math.max(left.bounds[0],right.bounds[0]),Math.max(left.bounds[1],right.bounds[1]),
    Math.min(left.bounds[2],right.bounds[2]),Math.min(left.bounds[3],right.bounds[3])];
  if(overlap[0]>overlap[2]+1e-7||overlap[1]>overlap[3]+1e-7)return {candidates:[],segments:[]};
  const candidates=new Set();
  const rows=left.spatialIndex.query(padBoundaryBounds(overlap)).sort((a,b)=>
    a.polygonIndex-b.polygonIndex||a.ringIndex-b.ringIndex||a.segmentIndex-b.segmentIndex);
  for(const row of rows) {
    const nearby=right.spatialIndex.query(padBoundaryBounds(segmentBounds(row)));
    if(!nearby.length)continue;
    candidates.add(row);
    for(const other of nearby)candidates.add(other);
  }
  const topology=buildBoundaryTopologyFromSegments([...candidates]);
  const ownerIds=[left.id,right.id].sort();
  const segments=[...topology.segments.values()].filter(s=>s.kind==='shared').flatMap(s=>
    buildRenderableBoundarySegments({type:'LineString',coordinates:[s.a,s.b]})
      .map(([start,end])=>({start,end,ownerIds,refs:s.refs})));
  const identities=new Map();
  left.segments.forEach((r,i)=>identities.set(r,[0,i]));
  right.segments.forEach((r,i)=>identities.set(r,[1,i]));
  return {candidates:[...candidates].map(row=>{
    const value=identities.get(row);
    if(!value)throw Error('Reference candidate is not an input source row');
    return value;
  }),segments};
}
const cases=[
  [rectangle('A',0,0,1,1),rectangle('B',1,0,2,1)],
  [rectangle('A',0,0,1,2),rectangle('B',1,.5,2,1.5)],
  [rectangle('A',0,0,2,2),rectangle('B',0,0,2,2)],
  [rectangle('A',0,0,1,1),rectangle('B',10,0,11,1)],
  [rectangle('A',0,80,5,85),rectangle('B',5,81,6,84)],
  [rectangle('A',-40,-80,-35,-75),rectangle('B',-35,-80,-32,-75)],
];
// Preserve former inputs while checking the intentional longitude correction
// independently of the retired raw-longitude broad phase.
const geographicCorrections=[
  {features:[rectangle('A',179,0,181,1),rectangle('B',181,0,182,1)],segments:1},
  {features:[rectangle('A',-179,10,179,11),rectangle('B',-179,10,179,11)],segments:6},
];
for(let i=0;i<48;i++) {
  const x=-70+i*.49,y=-40+i*.83;
  cases.push([rectangle('L'+i,x,y,x+1.2,y+1.3),
    rectangle('R'+i,x+1.2,y+.15+(i%3)*.2,x+2,y+.75+(i%3)*.2)]);
}
const unevenA=rectangle('LONG',0,0,2,1),unevenB=rectangle('SHORT',2,0,3,1);
unevenB.geometry.coordinates[0].splice(4,0,[2,.5]);
cases.push([unevenA,unevenB]);

test('C++ source-contact candidate order and refs match the original Web kernel',()=>{
  for(const [a,b] of cases) {
    const left=prepareBoundaryFeature(a),right=prepareBoundaryFeature(b);
    const expected=reference(left,right);
    const raw=sharedCalculationCore.countryContactPairsBatch([encode(left),encode(right)],[[0,1]])[0];
    assert.deepEqual(raw[0],expected.candidates,'candidate '+a.id+'/'+b.id);
    assert.deepEqual(computeCountrySharedContacts([[left,right]])[0],expected.segments,'segments '+a.id+'/'+b.id);
  }
});
test('one C++ batch preserves original pair results and source data identities',()=>{
  const pairs=cases.slice(0,16).map(([a,b])=>[prepareBoundaryFeature(a),prepareBoundaryFeature(b)]);
  const snapshot=pairs.map(pair=>pair.map(row=>structuredClone(row.feature)));
  const result=computeCountrySharedContacts(pairs);
  assert.equal(result.length,pairs.length);
  result.forEach((segments,i)=>{
    assert.deepEqual(segments,reference(...pairs[i]).segments,'batch '+i);
    assert.deepEqual(pairs[i].map(row=>row.feature),snapshot[i]);
  });
});
test('the former planar dateline cases use geographic source contacts',()=>{
  for(const {features,segments:count} of geographicCorrections){
    const pair=features.map(prepareBoundaryFeature);
    const segments=computeCountrySharedContacts([pair])[0];
    assert.equal(segments.length,count);
    for(const segment of segments){
      assert.ok(Math.abs(segment.start[0])>=179&&Math.abs(segment.end[0])>=179);
      assert.equal(segment.refs.length,2);
    }
  }
});
