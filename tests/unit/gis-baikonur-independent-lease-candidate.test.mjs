import assert from 'node:assert/strict';
import test from 'node:test';
import {ANCHORS,decimalDegrees} from '../../tools/gis/baikonur-official-reference.mjs';
import {makeBaikonurIndependentCandidate,polygonSelfCrossings,approximatePlanarAreaKm2}
  from '../../tools/gis/baikonur-independent-lease-candidate.mjs';

const anchor=n=>[decimalDegrees(ANCHORS[n-1][1]),decimalDegrees(ANCHORS[n-1][0])];
function syntheticBank(from,to){
 const a=anchor(from),b=anchor(to);
 const coords=Array.from({length:95},(_,i)=>{
   const t=i/94;return[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t+.0002*Math.sin(Math.PI*t)];
 });
 return {type:'Feature',treatyPointPair:[from,to],sourceClass:'independently-derived-USGS-Landsat-C2-L2',
   openStreetMapDataUsed:false,satelliteSceneIds:['SYNTHETIC-2019','SYNTHETIC-2025'],
   waterMaskSha256:['a'.repeat(64),'b'.repeat(64)],
   rightBankDirectionVerified:true,temporalBankConsistencyValidated:true,
   geometry:{type:'LineString',coordinates:coords}};
}
const fixtures=()=>[syntheticBank(17,18),syntheticBank(31,1)];
test('assembles all 31 government anchors and both independently shaped banks, not straight shortcuts',()=>{
 const r=makeBaikonurIndependentCandidate({bankFeatures:fixtures(),sourceRevision:'f'.repeat(40)});
 assert.equal(r.properties.status,'RESEARCH_ONLY_NOT_FOR_RUNTIME');
 assert.equal(r.properties.featureCount,5);
 assert.equal(r.features.length,5);
 const lease=r.features[0];
 assert.equal(lease.geometry.type,'Polygon');
 assert.equal(lease.properties.legalExclusionsApplied,false);
 assert.equal(lease.properties.kazakhstanSharedGeometryUpdated,false);
 assert.equal(lease.properties.openStreetMapDataUsed,false);
 assert.equal(lease.properties.bankReaches.length,2);
 assert(lease.geometry.coordinates[0].length>200);
 assert.deepEqual(lease.geometry.coordinates[0].at(0),anchor(1));
 assert.deepEqual(lease.geometry.coordinates[0].at(-1),anchor(1));
 assert(lease.properties.areaSquareKm>500);
 assert.equal(polygonSelfCrossings(lease.geometry.coordinates[0]),0);
 assert.equal(approximatePlanarAreaKm2(lease.geometry.coordinates[0]).toFixed(3),
   lease.properties.areaSquareKm.toFixed(3));
});
test('rejects single river, false time parity, OSM reuse, nonofficial vertices and detached bank',()=>{
 const draft=()=>fixtures();
 for(const mutate of [
   arr=>arr.pop(),
   arr=>arr[0].openStreetMapDataUsed=true,
   arr=>arr[0].rightBankDirectionVerified=false,
   arr=>arr[0].satelliteSceneIds=['2019-only'],
   arr=>arr[1].temporalBankConsistencyValidated=false,
   arr=>arr[1].waterMaskSha256=['a'.repeat(64),'invalid'],
   arr=>arr[1].geometry.coordinates[0]=[60.1,42.2],
   arr=>arr[0].geometry.coordinates[30]=[65.3,44.2],
 ]){
   const vals=draft();mutate(vals);
   assert.throws(()=>makeBaikonurIndependentCandidate({bankFeatures:vals,
     sourceRevision:'f'.repeat(40)}));
 }
});
test('segment-crossing diagnosis distinguishes crossing from shared endpoints',()=>{
 const v=[[0,0],[4,4],[0,4],[4,0],[0,0]];
 assert.equal(polygonSelfCrossings(v),1);
 const square=[[0,0],[0,4],[4,4],[4,0],[0,0]];
 assert.equal(polygonSelfCrossings(square),0);
});
