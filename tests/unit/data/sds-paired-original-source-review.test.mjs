import test from 'node:test';
import assert from 'node:assert/strict';
import {assertHistoricalSourceStorageChanges} from '../../../tools/gis/historical-display-review.mjs';
const marker='exact-sds-current-western-paired-original-arcs';
const id='state:SDS:2011-07-09-independence-r1';
const ring=[[25,4],[26,4],[26,5],[25,4]];
const old={entityId:'state:SDS',geometryVersions:[{versionId:id,validFrom:'2011-07-09',validTo:null,geometry:{type:'MultiPolygon',coordinates:[[ring]]},modernBoundarySupplement:{scope:'preserve'}}]};
test('only immutable local evidence can admit the South Sudan paired-border update',()=>{
  const next=structuredClone(old);
  next.geometryVersions[0].modernBoundarySupplement.adoptionMode=marker;
  next.geometryVersions[0].geometry.coordinates[0][0].splice(1,0,[25.5,4.1]);
  assert.throws(()=>assertHistoricalSourceStorageChanges(next,old,{prefixes:[],readEvidence:()=>null}),/SDS paired arcs: fixed archived evidence required/);
});
