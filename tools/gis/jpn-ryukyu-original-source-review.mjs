import {createHash} from 'node:crypto';
import {isDeepStrictEqual as eq} from 'node:util';
import {decodeTerritorialSource} from '../data/territorial-source-codec.mjs';
import {sharedExactEdges} from './retained-coast-source-review.mjs';

const base='assets/data/territorial-entities/source/';
const reports='reports/borders/validation/modern-raw-source-20261110/jpn-ryukyu-detached-original-20261114/';
const versionId='state:JPN:natural-earth-5.1.1';
const resource='6771c73a8325143c9294cfaddad86b013e98ac67218e5b21ce5f8251faea97ae';
const rawId='1d116ea2-5067-4f6b-b34d-057e3ac7da6f';
const blobSha='7a0d01cd76bf28376dc6bbf979276286c65b1fffdb75c5e98fe382ec88c7c34b',wkbSha='0ede5be1c255e510612804a600864f72cc607c6bdafe72dc54959b00fe597b14';
const sha=b=>createHash('sha256').update(b).digest('hex'),digest=g=>sha(JSON.stringify([g.type,g.coordinates]));
const fail=m=>{throw Error('JPN Ryukyu original: '+m);};
export const jpnRyukyuMethod='exact-jpn-current-ryukyu-original-islands-preserving-fixed-scope';
export const jpnRyukyuProof={reference:reports+'proof.json',sha256:'0d0ef96ff0fd8dc0ac44df56f14f5e65993bd6c81a1a50f7c5f8c2736b5cf9d8'};
export const jpnRyukyuSource={reference:reports+'selected-original.json',sha256:'cae147146fd35e29745e5b8b1e613c0105a4a34aef0e024c63536186fb8fd643'};
export const hasJpnRyukyuOriginal=e=>e?.geometryVersions?.some(v=>v.modernBoundarySupplement?.adoptionMode===jpnRyukyuMethod);
export const jpnRyukyuSupplement=(old,g)=>({...old,adoptionMode:jpnRyukyuMethod,status:'raw-source-only-not-display-approved',
  wholeCountryRaw:false,geometrySha256:digest(g),sourceAdoptionReview:jpnRyukyuProof,
  topology:{status:'deferred-until-complete-modern-replacement',displayApproved:false}});
function decodeIsland(r){
  const b=Buffer.from(r.wkbBase64??'','base64');
  if(b.length<13||b.toString('base64')!==r.wkbBase64||sha(b)!==r.wkbSha256||b[0]!==1||
    b.readUInt32LE(1)!==3||b.readUInt32LE(5)!==1)fail('fixed single-ring WKB required');
  const n=b.readUInt32LE(9);
  if(n<4||n>20000||b.length!==13+n*16)fail('closed polygon vertex inventory required');
  const ring=Array.from({length:n},(_,i)=>[b.readDoubleLE(13+i*16),b.readDoubleLE(21+i*16)]);
  if(!eq(ring[0],ring.at(-1))||!ring.every(([x,y])=>124.6<x&&x<127.5&&24.6<y&&y<26.4)||
    !eq([ring],r.coordinates))fail('original WKB outside admitted Ryukyu coordinates');
  return [ring];
}
export function assertJpnRyukyuOriginal(next,previous,{prefixes,readEvidence}={}){
  if(eq(next,previous))return 0;
  const read=ref=>{const b=readEvidence?.(ref.reference);if(!Buffer.isBuffer(b)||sha(b)!==ref.sha256)fail('fixed archived proof required');return JSON.parse(b);};
  const p=read(jpnRyukyuProof),s=read(jpnRyukyuSource);
  const old=previous?.geometryVersions?.[0],v=next?.geometryVersions?.[0];
  if(previous?.entityId!=='state:JPN'||next?.entityId!==previous.entityId||previous.geometryVersions.length!==1||next.geometryVersions?.length!==1||
    ![old,v].every(x=>x.versionId===versionId&&x.validFrom===null&&x.validTo===null&&x.geometry?.type==='MultiPolygon'&&x.geometry.coordinates.length===754)||
    old.modernBoundarySupplement?.adoptionMode!=='fixed-existing-approved-JPN-scope-restoration'||p.current?.versionId!==versionId||
    p.excludedPreparedCount!==26||p.oldCount!==754||p.newCount!==754||p.unchangedComponents!==738||p.valid!==true||
    !eq(p.peerRows?.map(r=>r.code),['PRK','KOR','CHN','TWN','RUS']))fail('current inventory, reviewed exclusions or peers changed');
  if(p.source?.uuid!==rawId||s.sourceFeatureId!==rawId||s.sourceFeatureGENC3!=='JPN'||p.source?.blobSha256!==blobSha||
    s.rawBlobSha256!==blobSha||s.rawWkbSha256!==wkbSha||p.source.wkbSha256!==wkbSha||
    s.selectionSha256!==p.approvedPreparedSelectionSha256||s.priorCorrespondenceSha256!==p.priorCorrespondenceSha256||
    s.componentCount!==16||p.replacements?.length!==16||s.components?.length!==16)fail('fixed original feature and admission selection required');
  function entity(row){
    const path=base+'countries/state-'+row.code+'.json',b=readEvidence(path);
    if(row.descriptorPath!==path||!Buffer.isBuffer(b)||sha(b)!==row.descriptorSha256)fail('descriptor changed: '+row.code);
    const d=JSON.parse(b),g=d.geometryVersions.find(x=>x.versionId===row.versionId);
    if(!g||g.validFrom!==row.validFrom||g.validTo!==row.validTo||g.geometryResource.sha256!==row.resourceSha256||
      base+g.geometryResource.file!==row.resourcePath||d.parentEntityId!==row.parentEntityId)fail('resource or attribution changed: '+row.code);
    return decodeTerritorialSource(d,k=>readEvidence(base+k));
  }
  if(!eq(entity(p.current),previous))fail('reviewed preimage changed');
  const exact=structuredClone(old.geometry),targets=new Set(),sources=new Set();
  for(const [i,row] of p.replacements.entries()){
    const src=s.components[i],k=row.oldIndex;
    if(!Number.isSafeInteger(k)||k<0||k>=754||targets.has(k)||sources.has(row.rawIndex)||
      !eq([k,row.rawIndex,row.preparedIndex],[src.oldIndex,src.rawIndex,src.preparedIndex])||
      row.exactAnchorCount<4||row.overlapOfOld<.7||row.overlapOfRaw<.7||exact.coordinates[k]?.length!==1)fail('selected original island correspondence changed');
    const ring=decodeIsland(src);if(ring[0].length!==row.rawExteriorVertices||eq(exact.coordinates[k],ring))fail('expected changed original ring required');
    targets.add(k);sources.add(row.rawIndex);exact.coordinates[k]=ring;
  }
  if(!eq(exact,p.candidateGeometry)||!eq(exact,v.geometry)||sha(JSON.stringify(exact)+'\n')!==resource)fail('unselected or original coordinates changed');
  for(const row of p.peerRows){
    const peer=entity(row).geometryVersions.find(x=>x.versionId===row.versionId).geometry;
    const a=sharedExactEdges(old.geometry,peer),b=sharedExactEdges(exact,peer);
    if(row.deltaIntersects!==false||a.length!==row.exactSharedEdges||!eq(a,b))fail('unselected peer geometry relationship changed');
  }
  const c=structuredClone(previous);c.geometryVersions[0].geometry=exact;
  c.geometryVersions[0].modernBoundarySupplement=jpnRyukyuSupplement(old.modernBoundarySupplement,exact);
  c.sourceInfo.geometrySha256=digest(exact);
  if(!eq(c,next))fail('unselected metadata or existing scope changed');
  const paths=[base+'countries/state-JPN.json',base+'geometries/sha256-'+resource+'.json'];
  if(!Array.isArray(prefixes)||!eq([...prefixes].sort(),paths.sort()))fail('exact two source paths required');
  return 1;
}
