import {isDeepStrictEqual as eq} from 'node:util';
const fail=m=>{throw Error('ESP retained: '+m);};
export const espRetainedMethod='exact-esp-original-family-plus-existing-ceuta-component';
export const hasEspRetainedOriginal=e=>e?.geometryVersions?.some(v=>v.modernBoundarySupplement?.adoptionMode===espRetainedMethod);
// The helper verifies structure, not admission. Storage requires a separately pinned proof.
export function validateEspRetainedComponents(next,previous,sources){
 if(previous?.entityId!=='state:ESP'||next?.entityId!=='state:ESP'||previous.geometryVersions?.length!==1||next.geometryVersions?.length!==1||!Array.isArray(sources)||!eq(sources.map(s=>s?.length),[465,32,10]))fail('fixed identity and three source inventories required');
 const old=previous.geometryVersions[0],v=next.geometryVersions[0];
 if(old.versionId!=='state:ESP:natural-earth-5.1.1'||v.versionId!==old.versionId||old.validFrom!==null||old.validTo!==null||v.validFrom!==null||v.validTo!==null||old.geometry?.type!=='MultiPolygon'||v.geometry?.type!=='MultiPolygon'||old.geometry.coordinates.length!==97||v.geometry.coordinates.length!==508)fail('fixed undated current inventory required');
 const stable=e=>{const c=structuredClone(e);delete c.geometryVersions[0].geometry;delete c.geometryVersions[0].modernBoundarySupplement;if(c.sourceInfo)delete c.sourceInfo.geometrySha256;return c;};
 if(!eq(stable(next),stable(previous)))fail('identity, lifetime or other metadata changed');
 if(!eq(v.geometry.coordinates,[...sources.flat(),old.geometry.coordinates[56]]))fail('original coordinates or retained exception changed');
 return true;
}

import {createHash} from 'node:crypto';
const hash=x=>createHash('sha256').update(x).digest('hex');
export const espRetainedProof={reference:'reports/borders/validation/modern-raw-source-20261110/esp-retained-original-20261114/admission-proof.json',sha256:'c7d0f822af8bf565ff5406f4328994312aa24dc1cae311d0727557e8860bb566'};
export function assertEspRetainedOriginal(next,previous,{prefixes,readEvidence}={}){
 if(eq(next,previous))return 0;
 if(typeof readEvidence!=='function')fail('archived evidence reader required');
 const bytes=readEvidence(espRetainedProof.reference);if(!Buffer.isBuffer(bytes)||hash(bytes)!==espRetainedProof.sha256)fail('fixed archived proof required');
 const proof=JSON.parse(bytes);if(hash(JSON.stringify(previous))!=='369fb02716a21fa542f79823997229bc85c3477d100a6908178ac14fd664bbe1'||proof.previousEntitySha256!==hash(JSON.stringify(previous)))fail('exact reviewed preimage required');
 const v=next.geometryVersions?.[0],old=previous.geometryVersions[0],coords=v?.geometry?.coordinates;if(!Array.isArray(coords))fail('geometry required');const sources=[coords.slice(0,465),coords.slice(465,497),coords.slice(497,507)];
 validateEspRetainedComponents(next,previous,sources);
 if(!eq(sources.map(x=>hash(JSON.stringify(x))),proof.rawCoordinateHashes)||proof.validGeometry!==true||proof.exactRawCoordinateConcatenation!==true||proof.exactRetainedCoordinateArray!==true||proof.features?.length!==3||proof.features.some(f=>f.retainedDisjoint!==true))fail('reviewed raw family or retained component proof differs');
 const resource=hash(JSON.stringify(v.geometry)+'\n'),digest=hash(JSON.stringify([v.geometry.type,v.geometry.coordinates]));if(resource!=='d5dd4a44a16afdc8965b73283d76d14e0ca4ac47c85c4f6f7872e2bfc08914d2'||proof.candidateResourceSha256!==resource)fail('fixed original coordinate payload required');
 const expected={...old.modernBoundarySupplement,priorPreparedAttribution:old.modernBoundarySupplement,adoptionMode:espRetainedMethod,status:'raw-source-only-not-display-approved',wholeCountryRaw:false,equalsSingleOriginal:false,result:'exact-three-original-features-plus-retained-ceuta-component',geometrySha256:digest,sourceAdoptionReview:espRetainedProof,topology:{status:'deferred-until-complete-modern-replacement',displayApproved:false}};
 if(!eq(v.modernBoundarySupplement,expected)||(next.sourceInfo&&next.sourceInfo.geometrySha256!==digest))fail('source-only attribution or prior caveat mismatch');
 const base='assets/data/territorial-entities/source/',paths=[base+'countries/state-ESP.json',base+'geometries/sha256-'+resource+'.json'];if(!Array.isArray(prefixes)||!eq([...prefixes].sort(),paths.sort()))fail('exact two source paths required');
 return 1;
}
