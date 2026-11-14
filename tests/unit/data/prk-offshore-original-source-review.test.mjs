import test from 'node:test';
import assert from 'node:assert/strict';
import {assertHistoricalSourceStorageChanges} from '../../../tools/gis/historical-display-review.mjs';
test('current PRK offshore island replacement requires its immutable source evidence',()=>{
 const old={entityId:'state:PRK',geometryVersions:[{versionId:'state:PRK:sino-korean-protocol-1964',validFrom:'1964-03-20',validTo:null,geometry:{type:'MultiPolygon',coordinates:[[[[125,39],[125.1,39],[125.1,39.1],[125,39]]]]}}]};
 const next=structuredClone(old);next.geometryVersions[0].geometry.coordinates[0][0].splice(1,0,[125.04,39.01]);next.geometryVersions[0].modernBoundarySupplement={adoptionMode:'exact-prk-current-offshore-original-islands'};
 assert.throws(()=>assertHistoricalSourceStorageChanges(next,old,{prefixes:[],readEvidence:()=>null}),/PRK offshore islands: fixed archived evidence required/);
});
