import {createHash} from 'node:crypto';
import {isDeepStrictEqual as eq} from 'node:util';
import {decodeTerritorialSource} from '../data/territorial-source-codec.mjs';
import {decodeOriginalBlobGeometry,readChunkedOriginalBlob} from '../data/chunked-original-source.mjs';
import {sharedExactEdges} from './retained-coast-source-review.mjs';

const base='assets/data/territorial-entities/source/';
const versionId='state:KOR:armistice-1953',resource='7b19986b6584cb08e92ce9e7777f75de1b10475898ebd661dcc3f21637446c94';
const rawId='c1feb3b8-ed1a-4882-95bb-e8f1def554f0',rawSha='30f64f932d49802f685e6c43d7addcb686f2cc94858c5da48fc89ef259ee448e',wkbSha='103a3d502a3d78f379e72e287e8fb3b53d2a3989e2d7081dca66e15d8e7834b8';
const sha=b=>createHash('sha256').update(b).digest('hex'),geometryHash=g=>sha(JSON.stringify([g.type,g.coordinates]));
const reject=m=>{throw Error('KOR southwest islands: '+m);};
export const korSouthwestMethod='exact-kor-current-southwest-original-islands';
export const korSouthwestProof={reference:'reports/borders/validation/modern-raw-source-20261110/kor-southwest-detached-original-20261114/proof.json',sha256:'101a48485f8596048b4defbc480b4768a70ee68d5643082d4068a3e0970536e3'};
const archivedSource={reference:'reports/borders/validation/modern-raw-source-20261110/retained-coast-kor-20261113/original/source.json',sha256:'9fd7bc45d1e28672223f03926183c58f8ddbf665a2f15626fe7bbe0a683322d9'};
const selected=[[6,12],[7,16],[8,159],[10,21],[11,169],[13,177],[14,179],[16,186],[17,191],[18,192],[25,209],[28,51],[29,215],[36,228],[43,231],[46,108]];

export const hasKorSouthwestOriginal=e=>e?.geometryVersions?.some(v=>v.modernBoundarySupplement?.adoptionMode===korSouthwestMethod);
export const korSouthwestSupplement=(old,g)=>({...old,adoptionMode:korSouthwestMethod,status:'raw-source-only-not-display-approved',
  wholeCountryRaw:false,geometrySha256:geometryHash(g),sourceAdoptionReview:korSouthwestProof,
  topology:{status:'deferred-until-complete-modern-replacement',displayApproved:false}});

export function assertKorSouthwestOriginal(next,previous,{prefixes,readEvidence}={}){
  if(eq(next,previous))return 0;
  const fixed=(ref,error)=>{const b=readEvidence?.(ref.reference);if(!Buffer.isBuffer(b)||sha(b)!==ref.sha256)reject(error);return JSON.parse(b);};
  const p=fixed(korSouthwestProof,'fixed archived proof required');
  const source=fixed(archivedSource,'existing coast original evidence required');
  const old=previous?.geometryVersions?.find(x=>x.versionId===versionId),v=next?.geometryVersions?.find(x=>x.versionId===versionId);
  if(!old||!v||previous.entityId!=='state:KOR'||next.entityId!==previous.entityId||old.validFrom!=='1953-07-27'||old.validTo!==null||
    v.validFrom!==old.validFrom||v.validTo!==null||old.geometry.type!=='MultiPolygon'||old.geometry.coordinates.length!==646||
    !old.modernBoundarySupplement?.retainedCoastReview||p.current?.versionId!==versionId||p.valid!==true||p.oldCount!==646||
    p.newCount!==646||p.unchangedComponents!==630||!eq(p.replacements?.map(r=>[r.oldIndex,r.rawIndex]),selected)||
    !eq(p.peerRows?.map(r=>r.code),['PRK','JPN','CHN','TWN','RUS']))reject('fixed period and island inventory required');
  if(p.source?.uuid!==rawId||p.source?.blobSha256!==rawSha||p.source?.wkbSha256!==wkbSha||
    source.featureId!==rawId||source.rawBlobSha256!==rawSha||source.rawWkbSha256!==wkbSha)reject('original source identity drift');
  const raw=decodeOriginalBlobGeometry(readChunkedOriginalBlob(source,readEvidence),{expectedWkbSha256:wkbSha});
  function entity(r){
    const k=base+'countries/state-'+r.code+'.json',b=readEvidence(k);
    if(k!==r.descriptorPath||!Buffer.isBuffer(b)||sha(b)!==r.descriptorSha256)reject('current descriptor drift: '+r.code);
    const d=JSON.parse(b),rv=d.geometryVersions.find(x=>x.versionId===r.versionId);
    if(!rv||rv.validFrom!==r.validFrom||rv.validTo!==r.validTo||rv.geometryResource.sha256!==r.resourceSha256||
      base+rv.geometryResource.file!==r.resourcePath||d.parentEntityId!==r.parentEntityId)reject('current resource or attribution drift: '+r.code);
    return decodeTerritorialSource(d,k=>readEvidence(base+k));
  }
  if(!eq(previous,entity(p.current)))reject('current source preimage drift');
  const g=structuredClone(old.geometry);
  for(const r of p.replacements){
    const from=g.coordinates[r.oldIndex],to=raw.coordinates[r.rawIndex];
    if(from?.length!==1||to?.length!==1||eq(from,to)||r.exactAnchorCount<4||r.overlapOfOld<.7||r.overlapOfRaw<.7||
      to[0].length!==r.rawExteriorVertices||!to[0].every(([x,y])=>125.7<x&&x<126.1&&34.1<y&&y<34.9))reject('outside reviewed southwest detached scope');
    g.coordinates[r.oldIndex]=to;
  }
  if(!eq(g,p.candidateGeometry)||!eq(g,v.geometry)||sha(JSON.stringify(g)+'\n')!==resource)reject('original or retained coordinates changed');
  for(const r of p.peerRows){
    const peer=entity(r).geometryVersions.find(x=>x.versionId===r.versionId).geometry;
    const a=sharedExactEdges(old.geometry,peer),b=sharedExactEdges(g,peer);
    if(r.deltaIntersects!==false||a.length!==r.exactSharedEdges||!eq(a,b))reject('peer geometry or edge set changed');
  }
  const expected=structuredClone(previous),e=expected.geometryVersions.find(v=>v.versionId===versionId);
  e.geometry=g;e.modernBoundarySupplement=korSouthwestSupplement(old.modernBoundarySupplement,g);
  expected.sourceInfo.geometrySha256=geometryHash(g);
  if(!eq(next,expected))reject('protected metadata or provenance changed');
  const paths=[base+'countries/state-KOR.json',base+'geometries/sha256-'+resource+'.json'];
  if(!Array.isArray(prefixes)||!eq([...prefixes].sort(),paths.sort()))reject('exact two source paths required');
  return 1;
}
