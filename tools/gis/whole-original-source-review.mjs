import {createHash} from 'node:crypto';
import {isDeepStrictEqual as eq} from 'node:util';
import {decodeTerritorialSource} from '../data/territorial-source-codec.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const digest=g=>hash(JSON.stringify([g.type,g.coordinates]));
const base='assets/data/territorial-entities/source/';
export const wholeOriginalBatchMethod='exact-original-current-batch';
export const hasWholeOriginalBatch=e=>e?.geometryVersions?.some(v=>v.modernBoundarySupplement?.adoptionMode===wholeOriginalBatchMethod);
/** Source-only transaction contract. Deliberately no inter-country topology claim.
 * An archived batch enumerates exact immutable resources, not a broad directory lease.
 * Every changed descriptor is independently checked by the store against its preimage.
 */
export function assertWholeOriginalBatch(next,previous,{prefixes,readEvidence}={}){
 const fail=m=>{throw Error('Whole original batch: '+m);};
 const sha=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
 const archived=r=>{if(!r||!/^reports\/(?:[\w.-]+\/)*[\w.-]+\.json$/.test(r.reference||'')||r.reference.split('/').includes('..')||!sha(r.sha256)||typeof readEvidence!=='function')fail('archived receipt required');const b=readEvidence(r.reference);if(!Buffer.isBuffer(b)||hash(b)!==r.sha256)fail('archive evidence hash mismatch');return JSON.parse(b);};
 if(eq(next,previous))return 0;
 if(!previous||!/^state:[A-Z]{3}$/.test(next.entityId)||next.parentEntityId!==''||next.instantiation?.mode!=='independent'||!Array.isArray(next.geometryVersions)||!eq(next.geometryVersions.map(v=>v.versionId),previous.geometryVersions?.map(v=>v.versionId)))fail('existing independent identity/version inventory required');
 const changed=next.geometryVersions.filter((v,i)=>!eq(v.geometry,previous.geometryVersions[i].geometry));
 if(changed.length!==1)fail('exactly one changed current geometry required');
 const v=changed[0],old=previous.geometryVersions.find(x=>x.versionId===v.versionId),s=v.modernBoundarySupplement;
 if(v.validTo!==null||v.validFrom!==old.validFrom||old.validTo!==null||s?.adoptionMode!==wholeOriginalBatchMethod||s.wholeCountryRaw!==true||s.status!=='raw-source-only-not-display-approved'||!eq(s.priorPreparedAttribution,old.modernBoundarySupplement))fail('source-only current version and exact prior attribution required');
 // The version selected by the existing authoring data must already be current;
 // this contract cannot select a historical reconstruction for modern replacement.
 if((next.geometryVersions.length>1||v.validFrom!==null)&&(previous.metadata?.representativeGeometryVersionId!==v.versionId||previous.sourceInfo?.geometryVersionId!==v.versionId||old.historicalProvenance?.currentGeometrySource?.status!=='approved-prepared-current-source-adoption'))fail('existing representative current-source anchor required');
 const preserved=e=>{const c=structuredClone(e);if(c.sourceInfo)for(const k of ['sourceId','title','geometrySha256','geometryVersionId'])delete c.sourceInfo[k];const t=c.geometryVersions.find(x=>x.versionId===v.versionId);for(const k of ['geometry','sourceId','modernBoundarySupplement'])delete t[k];return c;};
 if(!eq(preserved(next),preserved(previous)))fail('identity, dates, ownership, history or metadata changed');
 const r=archived(s.sourceAdoptionReview),source=archived(r.source),batch=archived(r.batch);
 if(r.schemaVersion!==1||r.method!==wholeOriginalBatchMethod||r.status!==s.status||r.entityId!==next.entityId||r.versionId!==v.versionId||r.validFrom!==v.validFrom||r.validTo!==null||r.geometrySha256!==digest(v.geometry)||r.previousGeometrySha256!==digest(old.geometry)||r.rawCoordinateRoundtrip!==true||r.wholeCountryRaw!==true)fail('stale review identity or geometry');
 const deferred={status:'deferred-until-complete-modern-replacement',displayApproved:false};
 if(!eq(r.topology,deferred)||!eq(s.topology,deferred))fail('explicit deferred topology required');
 const target=base+'countries/'+next.entityId.replace(':','-')+'.json',pre=readEvidence(target),descriptor=JSON.parse(pre);
 if(!Buffer.isBuffer(pre)||r.previousDescriptorSha256!==hash(pre)||!eq(decodeTerritorialSource(descriptor,p=>readEvidence(base+p)),previous))fail('actual archived descriptor preimage mismatch');
 const resource=base+'geometries/sha256-'+hash(JSON.stringify(v.geometry)+'\n')+'.json';
 if(batch.schemaVersion!==1||batch.method!==wholeOriginalBatchMethod||!eq(batch.topology,deferred)||!Array.isArray(batch.members)||!batch.members.length)fail('typed batch receipt required');
 const scope=[],ids=new Set();for(const member of batch.members){if(!/^state:[A-Z]{3}$/.test(member.entityId||'')||ids.has(member.entityId)||member.descriptor!==base+'countries/'+member.entityId.replace(':','-')+'.json'||!new RegExp('^'+base+'geometries/sha256-[a-f0-9]{64}\\.json$').test(member.resource||'')||!sha(member.previousDescriptorSha256))fail('invalid batch member');ids.add(member.entityId);scope.push(member.descriptor,member.resource);}
 if(!Array.isArray(prefixes)||new Set(prefixes).size!==prefixes.length||!eq([...prefixes].sort(),[...new Set(scope)].sort()))fail('exact batch source-only scope required');
 const member=batch.members.find(m=>m.entityId===next.entityId);if(!member||member.resource!==resource||member.previousDescriptorSha256!==hash(pre))fail('batch target preimage mismatch');
 const p=source.properties;
 if(source.schemaVersion!==1||source.method!=='exact-gpkg-original-feature'||typeof source.featureId!=='string'||p?.WP_ID!==source.featureId||p.WP_PAR_ID!==source.featureId||p.GENC_3!==next.entityId.slice(6)||p.US_Recog!=='Independent'||p.Map_Disp!==null||p.Show_Disp!==null||!eq(source.geometry,v.geometry))fail('original complete feature identity mismatch');
 if(typeof source.sourcePath!=='string'||!source.sourcePath||s.rawSourceFile!==source.sourcePath||s.rawFeatureId!==source.featureId||!eq(s.rawOriginalSource,r.source))fail('raw archive provenance mismatch');
 // The archived full feature blob is the provenance authority. A whole-file
 // receipt is optional, but cannot be invented or discarded when supplied.
 const fileHash=source.sourceFileReceipt?.gpkgSha256;
 if(fileHash!==undefined?(!sha(fileHash)||s.rawSourceFileSha256!==fileHash):s.rawSourceFileSha256!==undefined)fail('raw source file receipt mismatch');
 if(typeof source.rawBlobBase64!=='string'||source.rawBlobBase64.length>90000000)fail('bounded original blob required');
 const blob=Buffer.from(source.rawBlobBase64,'base64');if(blob.length<53||blob.length>64*1024*1024||blob.toString('base64')!==source.rawBlobBase64||hash(blob)!==source.rawBlobSha256||blob[0]!==71||blob[1]!==80||blob[2]!==0||blob[3]!==3||blob.readInt32LE(4)!==4326)fail('original GeoPackage header/hash mismatch');
 const g=v.geometry;if(g.type!=='MultiPolygon'||Object.keys(g).length!==2||!Array.isArray(g.coordinates)||!g.coordinates.length)fail('exact original MultiPolygon required');
 let size=9,minx=Infinity,maxx=-Infinity,miny=Infinity,maxy=-Infinity;
 for(const poly of g.coordinates){if(!Array.isArray(poly)||!poly.length)fail('empty polygon');size+=9;for(const ring of poly){if(!Array.isArray(ring)||ring.length<4||!eq(ring[0],ring.at(-1)))fail('closed original rings required');size+=4+ring.length*16;for(const p of ring){if(!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)||Math.abs(p[0])>180||Math.abs(p[1])>90)fail('bounded finite coordinates required');minx=Math.min(minx,p[0]);maxx=Math.max(maxx,p[0]);miny=Math.min(miny,p[1]);maxy=Math.max(maxy,p[1]);}}}
 if(size!==blob.length-40)fail('original WKB length mismatch');const bytes=Buffer.alloc(size);let i=0;const u=n=>{bytes.writeUInt32LE(n,i);i+=4;},header=t=>{bytes[i++]=1;u(t);};header(6);u(g.coordinates.length);for(const poly of g.coordinates){header(3);u(poly.length);for(const ring of poly){u(ring.length);for(const [x,y]of ring){bytes.writeDoubleLE(x,i);bytes.writeDoubleLE(y,i+8);i+=16;}}}
 if(!blob.subarray(40).equals(bytes)||hash(bytes)!==source.rawWkbSha256||[minx,maxx,miny,maxy].some((x,i)=>x!==blob.readDoubleLE(8+i*8)))fail('candidate is not byte-exact original WKB/envelope');
 if(s.geometrySha256!==digest(g)||next.sourceInfo?.geometrySha256!==digest(g)||next.sourceInfo?.geometryVersionId!==v.versionId)fail('source geometry attribution mismatch');
 return 1;
}
