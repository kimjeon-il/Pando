import {createHash} from 'node:crypto';
import {isDeepStrictEqual as eq} from 'node:util';
import {decodeTerritorialSource} from '../data/territorial-source-codec.mjs';
import {decodeOriginalBlobGeometry} from '../data/chunked-original-source.mjs';
import {exactCyclicChain,replayRetainedCoast,sharedExactEdges} from './retained-coast-source-review.mjs';

const base='assets/data/territorial-entities/source/';
const reports='reports/borders/validation/modern-raw-source-20261110/sds-western-paired-original-20261114/';
const resource='3a513755c58d8e293dd6a7eb1b0852a3826fe896b13833a7af43e7a4ad2f7455';
const versionId='state:SDS:2011-07-09-independence-r1';
const sha=b=>createHash('sha256').update(b).digest('hex');
const digest=g=>sha(JSON.stringify([g.type,g.coordinates]));
const fail=m=>{throw Error('SDS paired arcs: '+m);};
export const sdsPairedMethod='exact-sds-current-western-paired-original-arcs';
export const sdsPairedProof={reference:reports+'proof.json',sha256:'aea1e4e672d25e1790994135153b7797492df5dae7667a27e399d7d195193c91'};
export const sdsPairedSource={reference:reports+'source.json',sha256:'efb18e746f1da39b18e88335e31300e06c5d43fcdb07de1d00d5b0d05fd37058'};
export const hasSdsPairedOriginal=e=>e?.geometryVersions?.some(v=>v.modernBoundarySupplement?.adoptionMode===sdsPairedMethod);
export const sdsPairedSupplement=(old,g)=>({...old,adoptionMode:sdsPairedMethod,status:'raw-source-only-not-display-approved',
  wholeCountryRaw:false,geometrySha256:digest(g),sourceAdoptionReview:sdsPairedProof,
  topology:{status:'deferred-until-complete-modern-replacement',displayApproved:false}});
export function replaySdsOriginal(old,proof,source){
  const blob=Buffer.from(source.rawBlobBase64??'','base64');
  if(source.featureId!=='65f20b50-a947-4f2c-86c6-f221b5539314'||source.genCode!=='SSD'||
    sha(blob)!=='9032e56336f98c8f48206b3b0b5e93526093e09cfd6b53faaa79cce95a99be01')fail('fixed archived original required');
  const raw=decodeOriginalBlobGeometry(blob,{expectedWkbSha256:'ebd17db3e43f32906d3de3de5e0f50815063777c687828578a7374646c9e5bac'});
  if(!eq(raw,source.geometry))fail('original JSON does not match WKB');
  const counts={CAF:0,UGA:0};let inserted=0;
  for(const o of proof.operations){
    if(!Object.hasOwn(counts,o.peer)||o.polygonIndex!==1||o.ringIndex!==0||o.raw.polygonIndex!==0||
       o.raw.ringIndex!==0||o.endIndex!==o.startIndex+1)fail('bounded preexisting western ring required');
    const chain=exactCyclicChain(raw.coordinates[0][0],o.raw.startIndex,o.raw.endIndex,o.raw.direction);
    if(!chain.every(([x,y])=>23.4<x&&x<33&&3<y&&y<8.3)||chain.length-2!==o.inserted)fail('protected regions or witness count changed');
    inserted+=chain.length-2;counts[o.peer]++;
  }
  if(!eq(counts,{CAF:209,UGA:116})||inserted!==8900||proof.inserted!==inserted||
    !eq(proof.ringStarts,[{polygonIndex:1,ringIndex:0,startIndex:0}]))fail('exact fixed operations required');
  return replayRetainedCoast(old,raw,proof.operations,proof.ringStarts);
}
export function assertSdsPairedOriginal(next,previous,{prefixes,readEvidence}={}){
  if(eq(next,previous))return 0;
  const evidence=ref=>{const b=readEvidence?.(ref.reference);if(!Buffer.isBuffer(b)||sha(b)!==ref.sha256)fail('fixed archived evidence required');return JSON.parse(b);};
  const proof=evidence(sdsPairedProof),source=evidence(sdsPairedSource);
  const old=previous?.geometryVersions?.find(x=>x.versionId===versionId),v=next?.geometryVersions?.find(x=>x.versionId===versionId);
  if(!old||!v||previous.entityId!=='state:SDS'||next.entityId!==previous.entityId||old.validFrom!=='2011-07-09'||
    old.validTo!==null||v.validFrom!==old.validFrom||v.validTo!==null||proof.current?.versionId!==versionId||
    proof.candidateValid!==true||proof.uncoveredLoss>1e-12||
    !eq(proof.peerRows?.map(x=>x.code),['CAF','COD','UGA','KEN','ETH','SDN']))fail('fixed current scope required');
  const entity=row=>{
    const f=base+'countries/state-'+row.code+'.json',b=readEvidence(f);
    if(row.descriptorPath!==f||!Buffer.isBuffer(b)||sha(b)!==row.descriptorSha256)fail('current descriptor drift: '+row.code);
    const d=JSON.parse(b),rv=d.geometryVersions.find(x=>x.versionId===row.versionId);
    if(!rv||rv.geometryResource?.sha256!==row.resourceSha256||row.validFrom!==rv.validFrom||row.validTo!==rv.validTo)fail('current version drift: '+row.code);
    return decodeTerritorialSource(d,p=>readEvidence(base+p));
  };
  if(!eq(entity(proof.current),previous))fail('current preimage drift');
  const exact=replaySdsOriginal(old.geometry,proof,source);
  if(!eq(exact,v.geometry)||sha(JSON.stringify(exact)+'\n')!==resource)fail('unselected or original coordinates changed');
  for(const row of proof.peerRows){
    const g=entity(row).geometryVersions.find(x=>x.versionId===row.versionId).geometry;
    const a=sharedExactEdges(old.geometry,g),b=sharedExactEdges(v.geometry,g),set=new Set(b);
    if(a.length!==row.sharedEdgesBefore||b.length!==row.sharedEdgesAfter||a.some(e=>!set.has(e))||
      row.removedSharedEdges!==0||row.newAreaCoveringPeer>1e-12||row.overlapAfter>row.overlapBefore+1e-12)fail('peer shared boundary not preserved');
    if(!['CAF','UGA'].includes(row.code)&&(!eq(a,b)||row.unaffectedIntersectionExact!==true))fail('unselected peer changed');
  }
  const expected=structuredClone(previous),e=expected.geometryVersions.find(x=>x.versionId===versionId);
  e.geometry=exact;e.modernBoundarySupplement=sdsPairedSupplement(old.modernBoundarySupplement,exact);
  expected.sourceInfo.geometrySha256=digest(exact);
  if(!eq(next,expected))fail('nonselected version, attribution or metadata changed');
  const expectedPaths=[base+'countries/state-SDS.json',base+'geometries/sha256-'+resource+'.json'];
  if(!Array.isArray(prefixes)||!eq([...prefixes].sort(),expectedPaths.sort()))fail('exact two source paths required');
  return 1;
}
