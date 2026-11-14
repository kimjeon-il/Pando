import test from 'node:test';
import assert from 'node:assert/strict';
import {assertHistoricalSourceStorageChanges} from '../../../tools/gis/historical-display-review.mjs';

const method='exact-fin-current-detached-islands-preserving-ald-and-paired-nordic-arcs';
const ring=(x)=>[[[x,60],[x+0.1,60],[x,60.1],[x,60]]];
function fixture(){
  const before={entityId:'state:FIN',parentEntityId:null,geometryVersions:[{versionId:'state:FIN:natural-earth-5.1.1',validFrom:null,validTo:null,geometry:{type:'MultiPolygon',coordinates:[ring(21.5),ring(22),ring(23)]},modernBoundarySupplement:{pairedSourceReview:{method:'exact-original-shared-arc-splice'}}}],sourceInfo:{geometrySha256:'original'}};
  const pairs=[{targetIndex:1,rawIndex:200,coordinates:ring(22.01)}];
  const next=structuredClone(before);
  next.geometryVersions[0].geometry.coordinates[1]=pairs[0].coordinates;
  next.geometryVersions[0].modernBoundarySupplement.adoptionMode=method;
  return {before,next,pairs};
}
test('the storage entry point refuses a FIN replacement without the immutable FIN proof',()=>{
  const {before,next}=fixture();
  assert.throws(()=>assertHistoricalSourceStorageChanges(next,before,{prefixes:[],readEvidence:()=>null}),/FIN detached islands: fixed archived proof required/);
});
test('the FIN component guard changes only listed coordinates and preserves Nordic arcs and identity',async()=>{
  const {validateFinDetachedIslands}=await import('../../../tools/gis/fin-detached-original-source-review.mjs');
  const {before,next,pairs}=fixture();
  assert.equal(validateFinDetachedIslands(next,before,pairs,3),true);
  const other=structuredClone(next);
  other.geometryVersions[0].geometry.coordinates[0]=ring(21.6);
  assert.throws(()=>validateFinDetachedIslands(other,before,pairs,3),/unselected or original coordinates changed/);
  const altered=structuredClone(next);
  altered.geometryVersions[0].modernBoundarySupplement.pairedSourceReview.method='different';
  assert.throws(()=>validateFinDetachedIslands(altered,before,pairs,3),/metadata/);
  const owner=structuredClone(next);
  owner.parentEntityId='state:SWE';
  assert.throws(()=>validateFinDetachedIslands(owner,before,pairs,3),/metadata/);
});
