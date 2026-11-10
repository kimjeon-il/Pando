import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
// Same payload as the canonical prepared-polygon digest; GeoJSON key order is metadata.
const digest=geometry=>createHash('sha256').update(JSON.stringify([geometry.type,geometry.coordinates])).digest('hex');
const requiredHash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const historical=version=>version.validFrom!=null||version.validTo!=null||!!version.historicalProvenance;
const evidence=value=>value&&typeof value.reference==='string'&&value.reference.length>0&&requiredHash(value.sha256);
/** Evidence is an input-bound review receipt, never inferred from point density. */
export function assertHistoricalDisplayReview(entityId,version){
 const review=version.historicalProvenance?.displayDetailReview;
 const fail=message=>{throw Error(`Historical display review required: ${entityId}/${version.versionId}: ${message}`);};
 if(!review||review.status!=='passed')fail('missing or unresolved review');
 if(review.schemaVersion!==1||review.entityId!==entityId||review.versionId!==version.versionId||review.validFrom!==(version.validFrom??null)||review.validTo!==(version.validTo??null)||review.geometrySha256!==digest(version.geometry))fail('stale geometry, identity or period');
 if(!evidence(review.master)||!evidence(review.source))fail('preserved master/source receipt missing');
 const comparison=review.comparison;
 if(!comparison||!evidence(comparison.reference)||!requiredHash(comparison.arcSha256)||!Array.isArray(comparison.extent)||comparison.extent.length!==4||!comparison.extent.every(Number.isFinite)||comparison.scaleDenominator!==10000000)fail('explicit NE-scale comparison and arc receipt missing');
 if(!comparison.projection||typeof comparison.projection.definition!=='string'||comparison.projection.units!=='metre'||/EPSG:4326|\+proj=(?:longlat|latlong)/i.test(comparison.projection.definition)||!evidence(comparison.projection.evidence))fail('projection execution evidence missing');
 if(!['measured-detail-match','reviewed-display-generalization','preserved-modern-source','straight-partition'].includes(review.method)||!review.reason||!review.parameters||typeof review.parameters!=='object')fail('method, actual parameters and reason missing');
 if(!evidence(review.visual)||!review.topology||review.topology.status!=='passed'||!evidence(review.topology.evidence))fail('visual/topology evidence missing');
 const checks=review.topology.checks;
 if(!Array.isArray(checks)||['validity','shared-boundary','union','gaps-overlaps','connectivity','holes-islands','dates'].some(k=>!checks.includes(k)))fail('required preservation checks missing');
 if(!Array.isArray(review.counterpartVersions)||!review.counterpartVersions.every(v=>v.entityId&&v.versionId&&requiredHash(v.geometrySha256))||!Array.isArray(review.fixedAnchors)||!review.fixedAnchors.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)))fail('counterpart coverage or fixed anchors missing');
 if(!review.counterpartVersions.length&&!review.noSharedBoundaryReason)fail('shared boundary applicability missing');
 return review;
}
export function assertHistoricalDisplayChanges(next,previous){
 if(previous&&next.entityId!==previous.entityId)throw Error('Historical review identity changed');
 let checked=0;const before=new Map((previous?.geometryVersions||[]).map(v=>[v.versionId,v]));
 for(const version of next.geometryVersions){const old=before.get(version.versionId);if(old&&digest(old.geometry)===digest(version.geometry))continue;if(historical(version)){assertHistoricalDisplayReview(next.entityId,version);checked++;}}
 return checked;
}
/** Admit an original modern authoring source, never a display or compiled resource.
 * Evidence must already be archived by the storage owner, not supplied by a flag.
 * A dated current-source proxy needs its existing archived adoption evidence;
 * this does not approve historical reconstruction or derived display geometry.
 */
export function assertHistoricalSourceStorageChanges(next,previous,{prefixes,readEvidence}={}){
 const versions=next.geometryVersions||[];
 if(previous&&next.entityId===previous.entityId&&versions.length===previous.geometryVersions?.length&&versions.every(v=>{const old=previous.geometryVersions.find(p=>p.versionId===v.versionId);return old&&digest(old.geometry)===digest(v.geometry);}))return assertHistoricalDisplayChanges(next,previous);
 if(!versions.some(v=>v.modernBoundarySupplement?.sourceAdoptionReview))return assertHistoricalDisplayChanges(next,previous);
 const fail=message=>{throw Error('Raw source adoption: '+message);};
 const base='assets/data/territorial-entities/source/';
 if(!Array.isArray(prefixes)||!prefixes.length||prefixes.some(p=>!/^assets\/data\/territorial-entities\/source\/(?:countries\/[\w-]+\.json|geometries\/sha256-[a-f0-9]{64}\.json)$/.test(p)))fail('exact source-only scope required');
 if(!previous||!versions.length||versions.length!==previous.geometryVersions?.length
   ||new Set(versions.map(v=>v.versionId)).size!==versions.length
   ||versions.some((v,i)=>v.versionId!==previous.geometryVersions[i].versionId))fail('existing ordered versions required');
 const changed=versions.filter((v,i)=>digest(v.geometry)!==digest(previous.geometryVersions[i].geometry));
 if(changed.length!==1)fail('exactly one selected source geometry required');
 const v=changed[0],old=previous.geometryVersions.find(p=>p.versionId===v.versionId);
 if(v.validTo!==null||old.validTo!==null||v.validFrom!==old.validFrom)fail('dated reconstruction is not modern source adoption');
 const preserved=entity=>{
  const copy=structuredClone(entity);
  // Only source attribution and coordinate payload may change. All prior historical
  // provenance, ownership, names, lifetimes and version identifiers remain exact.
  if(copy.sourceInfo)for(const k of ['sourceId','title','geometrySha256','geometryVersionId'])delete copy.sourceInfo[k];
  const selected=copy.geometryVersions.find(p=>p.versionId===v.versionId);
  for(const k of ['geometry','sourceId','modernBoundarySupplement'])delete selected[k];
  return copy;
 };
 if(!isDeepStrictEqual(preserved(next),preserved(previous)))fail('identity, period, ownership or provenance changed');
 if(next.sourceInfo?.geometryVersionId!==undefined&&next.sourceInfo.geometryVersionId!==v.versionId)fail('source attribution targets another version');
 if(!v.modernBoundarySupplement?.sourceAdoptionReview)fail('selected source adoption receipt required');
 if(!isDeepStrictEqual(v.modernBoundarySupplement.priorPreparedAttribution,old.modernBoundarySupplement))fail('prior source attribution must be preserved');
 const replacedAttribution=new Set(['sourceId','status','sourceFile','rawLayer','sourceWP_IDs','rawBlobSha256','geometrySha256','adoptionMode','sourceProperties','priorPreparedAttribution','sourceAdoptionReview']);
 for(const [key,value] of Object.entries(old.modernBoundarySupplement||{}))if(!replacedAttribution.has(key)&&!isDeepStrictEqual(v.modernBoundarySupplement[key],value))fail('source caveat changed: '+key);
 const resourceHash=createHash('sha256').update(JSON.stringify(v.geometry)+'\n').digest('hex');
 if(!prefixes.includes(base+'countries/'+next.entityId.replace(':','-')+'.json')||!prefixes.includes(base+'geometries/sha256-'+resourceHash+'.json'))fail('paired descriptor and exact geometry resource required');
 const archivedReview=receipt=>{
  if(!evidence(receipt)||!/^reports\/(?:[\w.-]+\/)*[\w.-]+\.json$/.test(receipt.reference)||receipt.reference.split('/').includes('..')||typeof readEvidence!=='function')fail('archived adoption evidence required');
  const bytes=readEvidence(receipt.reference);
  if(!Buffer.isBuffer(bytes)||createHash('sha256').update(bytes).digest('hex')!==receipt.sha256)fail('missing or corrupt adoption evidence');
  return JSON.parse(bytes);
 };
 const review=archivedReview(v.modernBoundarySupplement.sourceAdoptionReview);
 if(review.schemaVersion!==1||review.status!=='raw-source-only-not-display-approved'||review.entityId!==next.entityId||review.versionId!==v.versionId||review.previousGeometrySha256!==digest(old.geometry)||review.geometrySha256!==digest(v.geometry))fail('stale geometry or identity evidence');
 if(versions.length>1||v.validFrom!==null){
  if(next.sourceInfo?.geometrySha256!==undefined&&(review.sourceInfoGeometryDigestFormat!=='sha256(JSON.stringify([geometry.type, geometry.coordinates]))'
    ||next.sourceInfo.geometrySha256!==review.geometrySha256))fail('source attribution geometry hash or explicit format is stale');
  const current=old.historicalProvenance?.currentGeometrySource,receipt=review.priorPreparedSourceReview;
  if(previous.metadata?.representativeGeometryVersionId!==v.versionId||previous.sourceInfo?.geometryVersionId!==v.versionId||next.sourceInfo?.geometryVersionId!==v.versionId
    ||current?.status!=='approved-prepared-current-source-adoption'||current.geometrySha256!==digest(old.geometry)
    ||!evidence(current.sourceReview)||!evidence(receipt)||receipt.sha256!==current.sourceReview.sha256
    ||review.validFrom!==v.validFrom||review.validTo!==v.validTo)fail('explicit prior current-source adoption and exact period required');
  // The original archived report is conditional evidence of prepared-source adoption,
  // not approval for this new raw source, historical accuracy, or display output.
  const prior=archivedReview(receipt),rows=prior.rows?.filter(r=>r.entityId===next.entityId&&r.versionId===v.versionId);
  if(prior.schemaVersion!==1||prior.status!=='source-topology-reviewed-conditional-on-coherent-pga-retirement'
    ||!Array.isArray(rows)||rows.length!==1)fail('prior current-source adoption row required');
  const row=rows[0];
  if(row.validFrom!==old.validFrom||row.validTo!==old.validTo||row.candidateGeometrySha256!==digest(old.geometry)
    ||row.donorGeometrySha256!==digest(old.geometry)||row.exactDonorCoordinateCopy!==true||row.periodPreserved!==true
    ||row.candidate?.valid!==true||row.candidate.empty!==false)fail('stale prior current-source adoption evidence');
 }
 if(!['lossless-original-feature','lossless-original-subgeometry'].includes(review.method)||review.rawCoordinateRoundtrip!==true||!evidence(review.source))fail('lossless original source evidence required');
 const topology=review.topology;
 if(topology?.status!=='passed'||!Array.isArray(topology.checks)||['validity','shared-boundary','gaps-overlaps','holes-islands','ownership'].some(k=>!topology.checks.includes(k))||!Array.isArray(topology.counterpartVersions)||!topology.counterpartVersions.every(c=>c.entityId&&c.versionId&&requiredHash(c.geometrySha256))||(!topology.counterpartVersions.length&&!topology.noSharedBoundaryReason))fail('ownership and topology review required');
 if(review.method==='lossless-original-subgeometry'){
  if(v.modernBoundarySupplement.adoptionMode!==review.method)fail('explicit partial source attribution required');
  if(next.sourceInfo?.geometrySha256!==undefined&&(review.sourceInfoGeometryDigestFormat!=='sha256(JSON.stringify([geometry.type, geometry.coordinates]))'||next.sourceInfo.geometrySha256!==review.geometrySha256))fail('source attribution geometry hash or explicit format is stale');
  const changes=review.subgeometryChanges;
  if(!Array.isArray(changes)||!changes.length||!['Polygon','MultiPolygon'].includes(old.geometry.type)||v.geometry.type!==old.geometry.type)fail('complete original hole replacements required');
  const polygons=geometry=>geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;
  const expected=structuredClone(old.geometry),beforePolygons=polygons(old.geometry),afterPolygons=polygons(v.geometry),expectedPolygons=polygons(expected),seen=new Set();
  const ringHash=ring=>createHash('sha256').update(JSON.stringify(ring)).digest('hex');
  const closedRing=ring=>Array.isArray(ring)&&ring.length>=4&&ring.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite))&&isDeepStrictEqual(ring[0],ring.at(-1));
  const holeIndex=index=>index&&Number.isSafeInteger(index.polygonIndex)&&index.polygonIndex>=0&&Number.isSafeInteger(index.ringIndex)&&index.ringIndex>0;
  for(const change of changes){
   const {target,original,counterpartVersion}=change||{};
   if(change?.kind!=='complete-hole-ring'||!holeIndex(target)||!holeIndex(original))fail('only indexed complete original holes are supported');
   const key=target.polygonIndex+':'+target.ringIndex,prior=beforePolygons[target.polygonIndex]?.[target.ringIndex],candidate=afterPolygons[target.polygonIndex]?.[target.ringIndex];
   if(seen.has(key)||!closedRing(prior)||!closedRing(candidate)||!closedRing(original.coordinates)||isDeepStrictEqual(prior,candidate))fail('distinct changed existing complete holes required');
   seen.add(key);
   // Original coordinate payload is inside the hash-checked archived review and
   // bound to its source feature receipt. No generated, reordered or moved vertices.
   if(change.previousCoordinatesSha256!==ringHash(prior)||change.coordinatesSha256!==ringHash(candidate)||original.coordinatesSha256!==ringHash(original.coordinates)||!isDeepStrictEqual(candidate,original.coordinates))fail('stale or nonoriginal hole coordinates');
   if(!counterpartVersion||counterpartVersion.entityId===next.entityId||!topology.counterpartVersions.some(c=>c.entityId===counterpartVersion.entityId&&c.versionId===counterpartVersion.versionId&&c.geometrySha256===counterpartVersion.geometrySha256))fail('paired hole counterpart topology review required');
   expectedPolygons[target.polygonIndex][target.ringIndex]=candidate;
  }
  if(!isDeepStrictEqual(expected,v.geometry))fail('coordinates outside selected holes changed');
 }else if(review.subgeometryChanges!==undefined||v.modernBoundarySupplement.adoptionMode==='lossless-original-subgeometry')fail('partial source cannot claim original whole feature');
 return 1;
}
/** Compiled-only writes must cover each changed dated binding, including derivatives. */
export function assertHistoricalCompiledChanges(next,previous){
 if(previous&&next.entityId!==previous.entityId)throw Error('Historical compiled identity changed');
 const oldGeometries=new Map((previous?.geometries||[]).map(g=>[g.id+':'+g.version,g])),digests=new WeakMap(),content=g=>{if(!digests.has(g))digests.set(g,digest(g.geojson));return digests.get(g);};let checked=0;
 for(const binding of next.sourceBindings){const geometry=next.geometries.find(g=>g.id===binding.geometryRef.id&&g.version===binding.geometryRef.version);if(!geometry)throw Error('Missing reviewed compiled geometry');const geometryDigest=content(geometry);
  const unchanged=(previous?.sourceBindings||[]).some(b=>{if(b.sourceVersionId!==binding.sourceVersionId)return false;const old=oldGeometries.get(b.geometryRef.id+':'+b.geometryRef.version);if(!old)throw Error('Missing previous compiled geometry');return content(old)===geometryDigest;});if(unchanged)continue;
  const timeline=next.identity.properties.metadata.historicalTimeline,version=timeline.geometryVersions.find(v=>v.versionId===binding.sourceVersionId);if(!version)throw Error('Missing compiled source version metadata');if(!historical(version)&&binding.validTo==null)continue;
  const sourceReview=version.historicalProvenance?.displayDetailReview,reviews=sourceReview?[sourceReview,...(sourceReview.compiledDerivatives||[])]:[],review=reviews.find(r=>r.entityId===next.entityId&&r.versionId===binding.sourceVersionId&&r.validFrom===binding.validFrom&&r.validTo===binding.validTo&&r.geometrySha256===geometryDigest);
  assertHistoricalDisplayReview(next.entityId,{...version,validFrom:binding.validFrom,validTo:binding.validTo,geometry:geometry.geojson,historicalProvenance:{...version.historicalProvenance,displayDetailReview:review}});checked++;
 }
 return checked;
}

// Scoped authoring preflight; writers and storage use the same pure validator.
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.argv.length!==6||process.argv[2]!=='--before'||process.argv[4]!=='--candidate')throw Error('Usage: node tools/gis/historical-display-review.mjs --before BEFORE.json --candidate CANDIDATE.json');
 const previous=JSON.parse(fs.readFileSync(process.argv[3])),candidate=JSON.parse(fs.readFileSync(process.argv[5]));if(previous.entityId!==candidate.entityId)throw Error('Review identity mismatch');
 console.log(JSON.stringify({entityId:candidate.entityId,changedHistoricalVersionsReviewed:assertHistoricalDisplayChanges(candidate,previous),result:'passed-for-this-change-only'}));
}
