import test from 'node:test';
import assert from 'node:assert/strict';
import {assertHistoricalSourceStorageChanges} from '../../../tools/gis/historical-display-review.mjs';
const id='state:KOR:armistice-1953';
const ring=[[125.8,34.3],[125.9,34.3],[125.9,34.4],[125.8,34.3]];
test('the registered southwest Korea scope requires the exact archived island proof',()=>{
 const prev={entityId:'state:KOR',geometryVersions:[{versionId:id,validFrom:'1953-07-27',validTo:null,geometry:{type:'MultiPolygon',coordinates:[[ring]]},modernBoundarySupplement:{adoptionMode:'exact-original-retained-coast-arcs-current-batch'}}]};
 const next=structuredClone(prev);
 next.geometryVersions[0].modernBoundarySupplement.adoptionMode='exact-kor-current-southwest-original-islands';
 next.geometryVersions[0].geometry.coordinates[0][0].splice(1,0,[125.85,34.31]);
 assert.throws(()=>assertHistoricalSourceStorageChanges(next,prev,{prefixes:[],readEvidence:()=>null}),/KOR southwest islands: fixed archived proof required/);
});
