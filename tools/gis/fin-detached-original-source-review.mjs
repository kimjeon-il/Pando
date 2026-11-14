import {createHash} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';

const base='assets/data/territorial-entities/source/';
const versionId='state:FIN:natural-earth-5.1.1';
const resourceSha256='cd0a7cd7ce06a571d6a2952dcc2e286ce7577b205b45d7c38d941a13c5a0269b';
const priorResourceSha256='7245719b9e1fa5c412e624cce32a91a57a89a1567d6ad0dd75b1846cc4e7fba2';
const priorDescriptorSha256='9ac1403929cd1b079597b24da0fea1c80d5660907c3c32863c0ca8101ef401a0';
const originalBlob='bfd23e40a1e37f32e247b8ed387356d802c7596d258f46b14766232428931ae3';
const originalId='c8102863-0429-4035-87d0-f55faace2498';
const peers=['ALD','SWE','EST','RUS','NOR','LVA','LTU','DNK','POL'];
const sha=b=>createHash('sha256').update(b).digest('hex');
const resource=g=>sha(JSON.stringify(g)+'\n');
const digest=g=>sha(JSON.stringify([g.type,g.coordinates]));
const reject=m=>{throw Error('FIN detached islands: '+m);};
export const finDetachedMethod='exact-fin-current-detached-islands-preserving-ald-and-paired-nordic-arcs';
export const finDetachedProof=Object.freeze({
  reference:'reports/borders/validation/modern-raw-source-20261110/fin-detached-original-20261114/admission-proof.json',
  sha256:'c8657163056bf536eb0d2fcc38ca54c26f67ffaeffa1352d7e00f0a5a52638b4'
});
export const hasFinDetachedOriginal=e=>e?.geometryVersions?.some(v=>v.modernBoundarySupplement?.adoptionMode===finDetachedMethod);

export function validateFinDetachedIslands(next,previous,pairs,count=3229){
  const v=next?.geometryVersions?.[0],old=previous?.geometryVersions?.[0];
  if(next?.entityId!=='state:FIN'||previous?.entityId!==next.entityId||
    next.geometryVersions?.length!==1||previous.geometryVersions?.length!==1||
    ![v,old].every(x=>x.versionId===versionId&&x.validFrom===null&&x.validTo===null&&
      x.geometry?.type==='MultiPolygon'&&x.geometry.coordinates.length===count)||
    !Array.isArray(pairs)||!pairs.length)reject('fixed identity, period and component inventory required');
  const stable=e=>{
    const c={...e,sourceInfo:{...e.sourceInfo},geometryVersions:[{...e.geometryVersions[0]}]};
    const x=c.geometryVersions[0];x.modernBoundarySupplement={...x.modernBoundarySupplement};
    delete x.geometry;
    for(const key of ['adoptionMode','status','geometrySha256','sourceAdoptionReview','topology','wholeCountryRaw'])
      delete x.modernBoundarySupplement[key];
    delete c.sourceInfo.geometrySha256;
    return c;
  };
  if(!old.modernBoundarySupplement?.pairedSourceReview||!equal(stable(next),stable(previous)))reject('ownership or existing Nordic metadata changed');
  const expected=old.geometry.coordinates.slice(),used=new Set(),raw=new Set();
  for(const {targetIndex,rawIndex,coordinates} of pairs){
    if(!Number.isSafeInteger(targetIndex)||targetIndex<0||targetIndex>=count||used.has(targetIndex)||
      !Number.isSafeInteger(rawIndex)||rawIndex<0||rawIndex>=19723||raw.has(rawIndex)||
      !Array.isArray(coordinates)||coordinates.length!==1||coordinates[0].length<4||
      expected[targetIndex].length!==1||equal(expected[targetIndex],coordinates))reject('invalid or repeated reviewed component');
    used.add(targetIndex);raw.add(rawIndex);expected[targetIndex]=coordinates;
  }
  if(!equal(expected,v.geometry.coordinates))reject('unselected or original coordinates changed');
  return true;
}

export function finDetachedSupplement(old,g){
  return {...old,adoptionMode:finDetachedMethod,status:'raw-source-only-not-display-approved',
    wholeCountryRaw:false,geometrySha256:digest(g),sourceAdoptionReview:finDetachedProof,
    topology:{status:'deferred-until-complete-modern-replacement',displayApproved:false}};
}

export function assertFinDetachedOriginal(next,previous,{prefixes,readEvidence}={}){
  if(equal(next,previous))return 0;
  if(typeof readEvidence!=='function')reject('fixed archived proof required');
  const bytes=readEvidence(finDetachedProof.reference);
  if(!Buffer.isBuffer(bytes)||sha(bytes)!==finDetachedProof.sha256)reject('fixed archived proof required');
  const p=JSON.parse(bytes),old=previous?.geometryVersions?.[0],v=next?.geometryVersions?.[0];
  if(p.method!==finDetachedMethod||p.current?.descriptorSha256!==priorDescriptorSha256||
     p.current?.resourceSha256!==priorResourceSha256||p.current?.versionId!==versionId||
     p.rawSource?.WP_ID!==originalId||p.rawSource?.WP_PAR_ID!==originalId||
     p.rawSource?.blobSha256!==originalBlob||p.rawSource?.GENC_3!=='FIN'||
     p.oldWholeValid!==true||p.newWholeValid!==true||p.currentComponentCount!==3229||
     p.existingALDReservedComponents!==43||p.pairs?.length!==32||
     !equal(p.peers?.map(x=>x.code),peers))reject('incomplete frozen regional evidence');
  for(const row of [p.current,...p.peers]){
    const b=readEvidence(base+'countries/state-'+row.code+'.json');
    if(!Buffer.isBuffer(b)||sha(b)!==row.descriptorSha256)reject('reviewed current descriptor changed: '+row.code);
    const g=JSON.parse(b).geometryVersions.find(x=>x.versionId===row.versionId);
    if(!g||g.validFrom!==row.validFrom||g.validTo!==row.validTo||g.geometryResource?.sha256!==row.resourceSha256)
      reject('reviewed current resource changed: '+row.code);
  }
  if(!old?.geometry||resource(old.geometry)!==priorResourceSha256||
     old.modernBoundarySupplement?.pairedSourceReview?.rawFeatureId!==originalId||
     p.pairs.some(x=>x.oldContacts!==0||x.newContacts!==0||x.sharedExactVertices<5||
      x.minMutualAreaFraction<.90||!equal(x.positiveAreaCurrentMatches,[x.targetIndex])||
      !equal(x.positiveAreaRawMatches,[x.rawIndex])))reject('exact reviewed old geometry and detached scope required');
  validateFinDetachedIslands(next,previous,p.pairs);
  if(resource(v.geometry)!==resourceSha256||!equal(v.modernBoundarySupplement,finDetachedSupplement(old.modernBoundarySupplement,v.geometry))||
     next.sourceInfo?.geometrySha256!==digest(v.geometry))reject('fixed coordinate payload or source-only attribution differs');
  const paths=[base+'countries/state-FIN.json',base+'geometries/sha256-'+resourceSha256+'.json'];
  if(!Array.isArray(prefixes)||!equal([...prefixes].sort(),paths.sort()))reject('exact two source paths required');
  return 1;
}
