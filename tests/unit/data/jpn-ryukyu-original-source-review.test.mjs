import test from 'node:test';
import assert from 'node:assert/strict';
import {assertHistoricalSourceStorageChanges} from '../../../tools/gis/historical-display-review.mjs';
test('the fixed Ryukyu scope cannot be stored without its archived original witness',()=>{
 const before={entityId:'state:JPN',geometryVersions:[{versionId:'state:JPN:natural-earth-5.1.1',validFrom:null,validTo:null,geometry:{type:'MultiPolygon',coordinates:[[[[125,25],[125.1,25],[125.1,25.1],[125,25]]]]},modernBoundarySupplement:{adoptionMode:'fixed-existing-approved-JPN-scope-restoration'}}]};
 const after=structuredClone(before);after.geometryVersions[0].geometry.coordinates[0][0].splice(1,0,[125.04,25.01]);
 after.geometryVersions[0].modernBoundarySupplement.adoptionMode='exact-jpn-current-ryukyu-original-islands-preserving-fixed-scope';
 assert.throws(()=>assertHistoricalSourceStorageChanges(after,before,{prefixes:[],readEvidence:()=>null}),/JPN Ryukyu original: fixed archived proof required/);
});
