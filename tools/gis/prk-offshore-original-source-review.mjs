import {createHash} from 'node:crypto';
import {isDeepStrictEqual as eq} from 'node:util';
import {decodeTerritorialSource} from '../data/territorial-source-codec.mjs';
import {sharedExactEdges} from './retained-coast-source-review.mjs';
const base='assets/data/territorial-entities/source/',report='reports/borders/validation/modern-raw-source-20261110/prk-offshore-original-20261114/';
const id='state:PRK:sino-korean-protocol-1964',rawId='d33f1d10-939f-4d0a-97c0-731dc387b3c8';
const blob='3334a67ac742d27c3e6127f7c67ecdfdc57c88f6b50afb2f860d2a9b57b765d7',wkb='1b37caafa882f85069ae73eeb4bb26a872008d630c6ec01a1f76298f6972166c';
const result='c7c8493d65399361ea6e1092d133ebf212c5a217d27b8c092fee5b6d3879a50c';
const sha=x=>createHash('sha256').update(x).digest('hex'),digest=g=>sha(JSON.stringify([g.type,g.coordinates]));
const fail=m=>{throw Error('PRK offshore islands: '+m);};
export const prkOffshoreMethod='exact-prk-current-offshore-original-islands';
export const prkOffshoreProof={reference:report+'proof.json',sha256:'3b8e6d705090c327ffc8cff43e40e5c9510b3a2d52f46126d4e3f087a66e3dcf'};
export const prkOffshoreSource={reference:report+'selected-original.json',sha256:'4ebb2c53e31c4ca8b2b6502e0bfda18ee7a5dd69ae0fc68d06c393c7ebd21808'};
export const hasPrkOffshore=e=>e?.geometryVersions?.some(v=>v.modernBoundarySupplement?.adoptionMode===prkOffshoreMethod);
export const prkOffshoreSupplement=(old,g)=>({...old,adoptionMode:prkOffshoreMethod,status:'raw-source-only-not-display-approved',wholeCountryRaw:false,
 geometrySha256:digest(g),sourceAdoptionReview:prkOffshoreProof,topology:{status:'deferred-until-complete-modern-replacement',displayApproved:false}});
function ring(c){
 const b=Buffer.from(c.wkbBase64??'','base64');
 if(b.length<13||b[0]!==1||b.readUInt32LE(1)!==3||b.readUInt32LE(5)!==1||sha(b)!==c.wkbSha256||
    b.toString('base64')!==c.wkbBase64)fail('single polygon WKB required');
 const n=b.readUInt32LE(9);
 if(n<4||n>20000||b.length!==13+n*16)fail('invalid raw ring inventory');
 const r=Array.from({length:n},(_,i)=>[b.readDoubleLE(13+i*16),b.readDoubleLE(21+i*16)]);
 if(!eq(r[0],r.at(-1))||!r.every(([x,y])=>124.6<x&&x<127.7&&39.19<y&&y<39.9)||!eq([r],c.coordinates))fail('not the reviewed offshore raw ring');
 return [r];
}
export function assertPrkOffshore(next,previous,{prefixes,readEvidence}={}){
 if(eq(next,previous))return 0;
 const read=r=>{const b=readEvidence?.(r.reference);if(!Buffer.isBuffer(b)||sha(b)!==r.sha256)fail('fixed archived evidence required');return JSON.parse(b);};
 const p=read(prkOffshoreProof),s=read(prkOffshoreSource);
 const old=previous?.geometryVersions?.find(x=>x.versionId===id),v=next?.geometryVersions?.find(x=>x.versionId===id);
 if(previous?.entityId!=='state:PRK'||next?.entityId!==previous.entityId||!old||!v||old.validFrom!=='1964-03-20'||old.validTo!==null||v.validFrom!==old.validFrom||v.validTo!==null||
    old.geometry?.type!=='MultiPolygon'||old.geometry.coordinates.length!==107||p.oldCount!==107||p.newCount!==107||p.unchangedComponents!==91||p.valid!==true||
    p.replacements?.length!==16||s.components?.length!==16||s.componentCount!==16||p.selectedOriginalReceiptSha256!==prkOffshoreSource.sha256||
    !eq(p.peerRows?.map(x=>x.code),['CHN','KOR','JPN','RUS','TWN']))fail('current scope or candidate inventory mismatch');
 if(p.source?.uuid!==rawId||s.sourceFeatureId!==rawId||s.sourceFeatureGENC3!=='PRK'||p.source.blobSha256!==blob||
    s.rawBlobSha256!==blob||p.source.wkbSha256!==wkb||s.rawWkbSha256!==wkb)fail('fixed original identity mismatch');
 function entity(r){
   const path=base+'countries/state-'+r.code+'.json',b=readEvidence(path);
   if(r.descriptorPath!==path||!Buffer.isBuffer(b)||sha(b)!==r.descriptorSha256)fail('current descriptor changed: '+r.code);
   const d=JSON.parse(b),g=d.geometryVersions.find(x=>x.versionId===r.versionId);
   if(!g||r.validFrom!==g.validFrom||r.validTo!==g.validTo||r.resourceSha256!==g.geometryResource.sha256||
      r.resourcePath!==base+g.geometryResource.file||r.parentEntityId!==d.parentEntityId)fail('current period, resource or hierarchy changed: '+r.code);
   return decodeTerritorialSource(d,k=>readEvidence(base+k));
 }
 if(!eq(previous,entity(p.current)))fail('reviewed preimage mismatch');
 const g=structuredClone(old.geometry),used=new Set(),source=new Set();
 for(const [i,r] of p.replacements.entries()){
   const x=s.components[i];
   if(!eq([r.oldIndex,r.rawIndex,r.preparedIndex],[x.oldIndex,x.rawIndex,x.preparedIndex])||
     r.exactAnchorCount<3||r.overlapOfOld<.7||r.overlapOfRaw<.7||g.coordinates[r.oldIndex]?.length!==1||
     used.has(r.oldIndex)||source.has(r.rawIndex))fail('existing and original components need unique reviewed correspondence');
   const z=ring(x);
   if(z[0].length!==r.rawExteriorVertices||eq(z,g.coordinates[r.oldIndex]))fail('original component coordinate drift');
   used.add(r.oldIndex);source.add(r.rawIndex);g.coordinates[r.oldIndex]=z;
 }
 if(!eq(g,p.candidateGeometry)||!eq(g,v.geometry)||sha(JSON.stringify(g)+'\n')!==result)fail('unselected or raw component changed');
 for(const r of p.peerRows){
   const q=entity(r).geometryVersions.find(x=>x.versionId===r.versionId).geometry;
   const a=sharedExactEdges(old.geometry,q),b=sharedExactEdges(g,q);
   if(!eq(a,b)||a.length!==r.exactSharedEdges||r.deltaIntersects!==false)fail('existing neighbor relationship changed: '+r.code);
 }
 const expected=structuredClone(previous),e=expected.geometryVersions.find(x=>x.versionId===id);
 e.geometry=g;e.modernBoundarySupplement=prkOffshoreSupplement(old.modernBoundarySupplement,g);
 if(!eq(expected,next))fail('historical geometry, current dates, attribution or other metadata changed');
 if(!Array.isArray(prefixes)||!eq([...prefixes].sort(),[base+'countries/state-PRK.json',base+'geometries/sha256-'+result+'.json'].sort()))fail('exact two source paths required');
 return 1;
}
