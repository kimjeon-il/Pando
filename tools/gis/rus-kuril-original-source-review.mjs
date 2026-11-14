import {createHash} from 'node:crypto';
import {isDeepStrictEqual as eq} from 'node:util';
const hash=x=>createHash('sha256').update(x).digest('hex');
const fail=m=>{throw Error('RUS Kuril: '+m);};
const base='assets/data/territorial-entities/source/';
const version='state:RUS:natural-earth-5.1.1';
export const rusKurilMethod='exact-rus-current-kuril-26-components';
export const rusKurilProof={reference:'reports/borders/validation/modern-raw-source-20261110/rus-kuril-confirmed26-20261113/admission-proof.json',sha256:'acfc66d37fdcc85a583b5aca2a21c5c6da5b1599a41d875f8077758160cd8ad2'};
export const hasRusKurilOriginal=e=>e?.geometryVersions?.some(v=>v.modernBoundarySupplement?.adoptionMode===rusKurilMethod);
// Structural check shared by the fixed admission and small synthetic mutation tests.
// This helper alone is not a storage admission: the entry point also pins all evidence.
export function validateRusKurilComponents(next,previous,selected){
 if(previous?.entityId!=='state:RUS'||next?.entityId!=='state:RUS'||previous.geometryVersions?.length!==2||next.geometryVersions?.length!==2||selected?.length!==26)fail('fixed identity/version/component inventory required');
 const old=previous.geometryVersions.find(v=>v.versionId===version),v=next.geometryVersions.find(v=>v.versionId===version);
 if(!old||!v||old.validFrom!=='2014-03-18'||v.validFrom!==old.validFrom||v.validTo!==null||old.validTo!==null||old.geometry?.type!=='MultiPolygon'||v.geometry?.type!=='MultiPolygon'||old.geometry.coordinates.length!==6829||v.geometry.coordinates.length!==6843)fail('exact dated current inventory required');
 const stable=e=>{const c=structuredClone(e),s=c.geometryVersions.find(v=>v.versionId===version);delete s.geometry;delete s.modernBoundarySupplement;if(c.sourceInfo)delete c.sourceInfo.geometrySha256;return c;};
 if(!eq(stable(next),stable(previous)))fail('history, dates or metadata changed');
 if(!eq(old.geometry.coordinates.slice(0,6817),v.geometry.coordinates.slice(0,6817))||!eq(selected,v.geometry.coordinates.slice(6817)))fail('unselected or original coordinates changed');
 return true;
}
export function assertRusKurilOriginal(next,previous,{prefixes,readEvidence}={}){
 if(eq(next,previous))return 0;
 if(typeof readEvidence!=='function')fail('archived evidence reader required');
 const bytes=readEvidence(rusKurilProof.reference);if(!Buffer.isBuffer(bytes)||hash(bytes)!==rusKurilProof.sha256)fail('fixed archived proof required');
 const proof=JSON.parse(bytes);if(hash(JSON.stringify(previous))!=='42aedf2e2cbb37729ddf047c24d67c495fcfe5d88ba9e094e2c51b55ea4b75f3'||proof.previousEntitySha256!==hash(JSON.stringify(previous)))fail('exact reviewed preimage required');
 validateRusKurilComponents(next,previous,proof.selectedOriginalCoordinates);
 const old=previous.geometryVersions.find(v=>v.versionId===version),v=next.geometryVersions.find(v=>v.versionId===version),resource=hash(JSON.stringify(v.geometry)+'\n'),digest=hash(JSON.stringify([v.geometry.type,v.geometry.coordinates]));
 if(resource!=='697b8e0eead5324e5787f5139a00efb1f487a0f6984c4330659594b1da431a98'||proof.candidateResourceSha256!==resource)fail('fixed original coordinate payload required');
 const expected={...old.modernBoundarySupplement,priorPreparedAttribution:old.modernBoundarySupplement,adoptionMode:rusKurilMethod,status:'raw-source-only-not-display-approved',geometrySha256:digest,sourceAdoptionReview:rusKurilProof,topology:{status:'deferred-until-complete-modern-replacement',displayApproved:false}};
 if(!eq(v.modernBoundarySupplement,expected)||v.modernBoundarySupplement.wholeCountryRaw!==false||(next.sourceInfo&&next.sourceInfo.geometrySha256!==digest))fail('source-only attribution or prior caveat mismatch');
 const japan=readEvidence(base+'countries/state-JPN.json');if(!Buffer.isBuffer(japan)||hash(japan)!==proof.japanDescriptorSha256||proof.japanAll26Disjoint!==true||proof.japanPositiveAreaOverlapCount!==0)fail('reviewed unchanged Japan required');
 const paths=[base+'countries/state-RUS.json',base+'geometries/sha256-'+resource+'.json'];if(!Array.isArray(prefixes)||!eq([...prefixes].sort(),paths.sort()))fail('exact two source paths required');
 return 1;
}
