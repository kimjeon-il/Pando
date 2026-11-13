import {createHash} from 'node:crypto';
import {isDeepStrictEqual as eq} from 'node:util';
import {decodeTerritorialSource} from '../data/territorial-source-codec.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const digest=g=>hash(JSON.stringify([g.type,g.coordinates]));
const base='assets/data/territorial-entities/source/';
export const wholeOriginalBatchMethod='exact-original-current-batch';
/** Explicit bounds for large complete originals (including CAN and USA).
 * Zero raw bytes allows checking the encoded length before allocating a Buffer.
 * This is only a resource guard; the full blob/hash/WKB checks remain mandatory.
 */
export function assertWholeOriginalBlobSize(rawBytes,base64Characters){
 if(!Number.isSafeInteger(rawBytes)||rawBytes<0||rawBytes>256*1024*1024||!Number.isSafeInteger(base64Characters)||base64Characters<0||base64Characters>360*1024*1024)throw Error('Whole original batch: bounded original blob required');
}
export const hasWholeOriginalBatch=e=>e?.geometryVersions?.some(v=>v.modernBoundarySupplement?.adoptionMode===wholeOriginalBatchMethod);


/** One already-mapped null-GENC original, not a generic MapTint identity rule. */

function originalCodeMatches(source,next,review,descriptor,archived){

 const p=source.properties,code=next.entityId.slice(6);

 if(p?.GENC_3===code)return review.identityFallback===undefined;

 // A conflicting non-null GENC code can never fall back to a colour code.

 if(p?.GENC_3!==null||code!=='ESP'||p.MapTint_3!=='ESP'||source.featureId!=='804cb3c1-195d-48d8-97e5-0439f624b231')return false;

 const fallback=review.identityFallback;

 if(fallback?.method!=='existing-esp-single-original-null-genc')return false;

 const mapping=archived(fallback.mapping),rows=mapping.rows?.filter(x=>x.code===code&&x.versionId===review.versionId);

 if(rows?.length!==1)return false;

 const row=rows[0],feature=row.originalFeatures?.[0],version=descriptor.geometryVersions.find(x=>x.versionId===review.versionId);

 return row.descriptorSha256===review.previousDescriptorSha256&&row.validFrom===review.validFrom&&row.validTo===review.validTo

  &&row.resourcePath===base+version.geometryResource.file&&row.resourceSha256===version.geometryResource.sha256

  &&row.originalFeatures.length===1&&feature.WP_ID===source.featureId&&feature.GENC_3===null&&feature.US_Recog==='Independent'&&feature.Map_Disp===null

  &&feature.blobSha256===source.rawBlobSha256&&feature.wkbSha256===source.rawWkbSha256;

}




// Exactly three existing dependent children. Operational instantiation is not sovereignty.
const dependentTuples=Object.freeze({
 GIB:['state:GBR','9c6cbaf6-8bb7-48e9-8036-7429ad4154e0','4f9b1dfc-e287-4b05-abc0-27793984fa5c'],
 HKG:['state:CHN','f9c2b465-9fe6-46eb-9a56-5df0f4fb1f69','422131df-82bc-4f1b-9a1f-ee89cc970e19'],
 MAC:['state:CHN','942a1f06-0142-4010-bfc8-4f140ba2f7a3','422131df-82bc-4f1b-9a1f-ee89cc970e19'],
});
function assertDependentOriginal(source,next,previous,review,supplement,{archived,readEvidence,prefixes,fail}){
 const code=next.entityId.slice(6),tuple=dependentTuples[code],scope=review.dependencyScope,p=source.properties;
 if(!tuple||!scope||scope.method!=='preserve-existing-dependent-parent'||!eq(scope,supplement.dependencyScope)||scope.parentEntityId!==tuple[0]||scope.parentOriginalWP_ID!==tuple[2])fail('explicit existing dependent tuple required');
 if(previous.parentEntityId!==tuple[0]||next.parentEntityId!==tuple[0]||previous.instantiation?.mode!=='independent'||next.instantiation?.mode!=='independent'||!eq(previous.instantiation?.countryUpdates,{}))fail('dependent project parent/instantiation changed');
 if(previous.geometryVersions.length!==1||next.geometryVersions.length!==1||previous.geometryVersions[0].validFrom!==null||previous.geometryVersions[0].validTo!==null)fail('one undated dependent current version required');
 if(source.featureId!==tuple[1]||p?.WP_ID!==tuple[1]||p.WP_PAR_ID!==tuple[2]||p.GENC_3!==code||p.US_Recog!=='Dependency or Area of Special Sovereignty'||review.identityFallback!==undefined)fail('dependent original identity/parent mismatch');
 const parentPath=base+'countries/'+tuple[0].replace(':','-')+'.json',bytes=readEvidence(parentPath);
 if(!Buffer.isBuffer(bytes)||hash(bytes)!==scope.parentDescriptorSha256)fail('stale dependent parent descriptor');
 const parent=JSON.parse(bytes);if(parent.entityId!==tuple[0]||parent.parentEntityId!==''||parent.metadata?.sourceFeatureId!==tuple[0].slice(6))fail('dependent parent catalog identity mismatch');
 const parentPaths=[parentPath,...parent.geometryVersions.map(v=>base+v.geometryResource.file)];if(parentPaths.some(p=>prefixes.includes(p)))fail('dependent parent is read-only');
 const mapping=archived(scope.existingOriginalMapping),rows=mapping.rows?.filter(x=>x.code===code&&x.versionId===review.versionId);
 if(rows?.length!==1)fail('single existing dependent mapping required');
 const row=rows[0],feature=row.originalFeatures?.[0];
 // This is an original-identity proof, not a current preimage proof. GIB's coast
 // resource legitimately changed since this report. Actual current preimage is
 // independently authenticated by previousDescriptorSha256 in the main gate.
 if(row.assembly!=='single original feature'||row.originalFeatures.length!==1||feature.WP_ID!==tuple[1]||feature.GENC_3!==code||feature.US_Recog!==p.US_Recog||feature.Map_Disp!==null||feature.blobSha256!==source.rawBlobSha256||feature.wkbSha256!==source.rawWkbSha256)fail('dependent original mapping differs');
}

/** Source-only transaction contract. Deliberately no inter-country topology claim.
 * An archived batch enumerates exact immutable resources, not a broad directory lease.
 * Every changed descriptor is independently checked by the store against its preimage.
 */
export function assertWholeOriginalBatch(next,previous,{prefixes,readEvidence}={}){
 const fail=m=>{throw Error('Whole original batch: '+m);};
 const sha=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
 const archived=r=>{if(!r||!/^reports\/(?:[\w.-]+\/)*[\w.-]+\.json$/.test(r.reference||'')||r.reference.split('/').includes('..')||!sha(r.sha256)||typeof readEvidence!=='function')fail('archived receipt required');const b=readEvidence(r.reference);if(!Buffer.isBuffer(b)||hash(b)!==r.sha256)fail('archive evidence hash mismatch');return JSON.parse(b);};
 if(eq(next,previous))return 0;
 if(!previous||!/^state:[A-Z]{3}$/.test(next.entityId)||(next.parentEntityId!==''&&!dependentTuples[next.entityId.slice(6)])||next.instantiation?.mode!=='independent'||!Array.isArray(next.geometryVersions)||!eq(next.geometryVersions.map(v=>v.versionId),previous.geometryVersions?.map(v=>v.versionId)))fail('existing independent identity/version inventory required');
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
 const dependent=next.parentEntityId!=='';
 if(dependent)assertDependentOriginal(source,next,previous,r,s,{archived,readEvidence,prefixes,fail});
 else if(r.dependencyScope!==undefined||s.dependencyScope!==undefined)fail('dependent scope cannot alter independent path');
 if(source.schemaVersion!==1||source.method!=='exact-gpkg-original-feature'||typeof source.featureId!=='string'||p?.WP_ID!==source.featureId||(!dependent&&(p.WP_PAR_ID!==source.featureId||p.US_Recog!=='Independent'))||!originalCodeMatches(source,next,r,descriptor,archived)||p.Map_Disp!==null||p.Show_Disp!==null||!eq(source.geometry,v.geometry))fail('original complete feature identity mismatch');

 if(typeof source.sourcePath!=='string'||!source.sourcePath||s.rawSourceFile!==source.sourcePath||s.rawFeatureId!==source.featureId||!eq(s.rawOriginalSource,r.source))fail('raw archive provenance mismatch');
 // The archived full feature blob is the provenance authority. A whole-file
 // receipt is optional, but cannot be invented or discarded when supplied.
 const fileHash=source.sourceFileReceipt?.gpkgSha256;
 if(fileHash!==undefined?(!sha(fileHash)||s.rawSourceFileSha256!==fileHash):s.rawSourceFileSha256!==undefined)fail('raw source file receipt mismatch');
 if(typeof source.rawBlobBase64!=='string')fail('bounded original blob required');
 assertWholeOriginalBlobSize(0,source.rawBlobBase64.length);
 const blob=Buffer.from(source.rawBlobBase64,'base64');assertWholeOriginalBlobSize(blob.length,source.rawBlobBase64.length);if(blob.length<53||blob.toString('base64')!==source.rawBlobBase64||hash(blob)!==source.rawBlobSha256||blob[0]!==71||blob[1]!==80||blob[2]!==0||blob[3]!==3||blob.readInt32LE(4)!==4326)fail('original GeoPackage header/hash mismatch');
 const g=v.geometry;if(g.type!=='MultiPolygon'||Object.keys(g).length!==2||!Array.isArray(g.coordinates)||!g.coordinates.length)fail('exact original MultiPolygon required');
 let size=9,minx=Infinity,maxx=-Infinity,miny=Infinity,maxy=-Infinity;
 for(const poly of g.coordinates){if(!Array.isArray(poly)||!poly.length)fail('empty polygon');size+=9;for(const ring of poly){if(!Array.isArray(ring)||ring.length<4||!eq(ring[0],ring.at(-1)))fail('closed original rings required');size+=4+ring.length*16;for(const p of ring){if(!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)||Math.abs(p[0])>180||Math.abs(p[1])>90)fail('bounded finite coordinates required');minx=Math.min(minx,p[0]);maxx=Math.max(maxx,p[0]);miny=Math.min(miny,p[1]);maxy=Math.max(maxy,p[1]);}}}
 if(size!==blob.length-40)fail('original WKB length mismatch');const bytes=Buffer.alloc(size);let i=0;const u=n=>{bytes.writeUInt32LE(n,i);i+=4;},header=t=>{bytes[i++]=1;u(t);};header(6);u(g.coordinates.length);for(const poly of g.coordinates){header(3);u(poly.length);for(const ring of poly){u(ring.length);for(const [x,y]of ring){bytes.writeDoubleLE(x,i);bytes.writeDoubleLE(y,i+8);i+=16;}}}
 if(!blob.subarray(40).equals(bytes)||hash(bytes)!==source.rawWkbSha256||[minx,maxx,miny,maxy].some((x,i)=>x!==blob.readDoubleLE(8+i*8)))fail('candidate is not byte-exact original WKB/envelope');
 if(s.geometrySha256!==digest(g)||next.sourceInfo?.geometrySha256!==digest(g)||next.sourceInfo?.geometryVersionId!==v.versionId)fail('source geometry attribution mismatch');
 return 1;
}
