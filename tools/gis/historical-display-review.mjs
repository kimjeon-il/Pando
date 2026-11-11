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
// This partial-source contract is deliberately separate from complete-feature/hole
// adoption. Archived evidence is supplied by the owner; no display gate is bypassed.
function assertOriginalSharedArcs(next,previous,review,{prefixes,archivedReview,fail}){
 const dated=review.method==='lossless-original-current-version-shared-arc',method=dated?review.method:'lossless-original-shared-arc';
 const v=dated?next.geometryVersions.find(v=>v.versionId===review.selectedVersion?.versionId):next.geometryVersions[0],old=dated?previous.geometryVersions.find(v=>v.versionId===review.selectedVersion?.versionId):previous.geometryVersions[0];
 if(!v||!old)fail('explicit selected current version required');
 const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
 const point=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite);
 const chain=c=>Array.isArray(c)&&c.length>=2&&c.every(point)&&!isDeepStrictEqual(c[0],c.at(-1))&&c.every((p,i)=>!i||!isDeepStrictEqual(p,c[i-1]));
 const ring=r=>Array.isArray(r)&&r.length>=4&&r.every(point)&&isDeepStrictEqual(r[0],r.at(-1));
 const index=n=>Number.isSafeInteger(n)&&n>=0;
 const interval=t=>t&&index(t.polygonIndex)&&t.ringIndex===0&&index(t.startIndex)&&index(t.endIndex)&&t.startIndex<t.endIndex;
 const polygons=g=>g.type==='Polygon'?[g.coordinates]:g.coordinates;
 const sameReceipt=(a,b)=>evidence(a)&&evidence(b)&&isDeepStrictEqual(a,b);
 if(!dated&&(next.geometryVersions.length!==1||old.validFrom!==null||old.validTo!==null||v.validFrom!==null||v.validTo!==null||review.validFrom!==null||review.validTo!==null))fail('shared arcs require one undated current version');
 if(dated){
  const selection={versionId:v.versionId,validFrom:v.validFrom,validTo:v.validTo};
  if(!isDeepStrictEqual(review.selectedVersion,selection)||review.versionId!==v.versionId||typeof v.validFrom!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v.validFrom)||old.validFrom!==v.validFrom||v.validTo!==null||old.validTo!==null||review.validFrom!==v.validFrom||review.validTo!==null||[next,previous].some(e=>e.geometryVersions.filter(v=>v.validTo===null).length!==1))fail('unique explicitly dated current version required');
  const preserved=previous.geometryVersions.filter(p=>p.versionId!==v.versionId).map(p=>({versionId:p.versionId,versionSha256:hash(p),geometryResourceSha256:createHash('sha256').update(JSON.stringify(p.geometry)+'\n').digest('hex')}));
  if(!isDeepStrictEqual(review.preservedVersions,preserved))fail('exact unselected version and resource digests required');
  if(preserved.some(p=>prefixes.includes('assets/data/territorial-entities/source/geometries/sha256-'+p.geometryResourceSha256+'.json')))fail('unselected historical resource is read-only');
 }
 if(review.wholeCountryRaw!==false||v.modernBoundarySupplement.wholeCountryRaw!==false||v.modernBoundarySupplement.adoptionMode!==method||review.rawCoordinateRoundtrip!==true||review.subgeometryChanges!==undefined)fail('explicit partial shared-arc attribution required');
 const attributionKeys=new Set(['sourceId','status','geometrySha256','adoptionMode','priorPreparedAttribution','sourceAdoptionReview','wholeCountryRaw']);
 for(const [key,value] of Object.entries(old.modernBoundarySupplement||{}))if(!attributionKeys.has(key)&&!isDeepStrictEqual(v.modernBoundarySupplement[key],value))fail('shared-arc prior source evidence changed: '+key);
 if(review.sourceInfoGeometryDigestFormat!=='sha256(JSON.stringify([geometry.type, geometry.coordinates]))'||next.sourceInfo?.geometrySha256!==review.geometrySha256||v.modernBoundarySupplement.geometrySha256!==review.geometrySha256)fail('shared-arc source digest attribution required');
 const topology=review.topology;
 if(topology?.status!=='passed'||!Array.isArray(topology.checks)||['validity','shared-boundary','gaps-overlaps','holes-islands','ownership'].some(k=>!topology.checks.includes(k))||!Array.isArray(topology.counterpartVersions)||!topology.counterpartVersions.length)fail('paired shared-arc topology required');
 const identity=r=>r&&/^state:[\w-]+$/.test(r.entityId)&&typeof r.versionId==='string'&&r.versionId.length>0&&requiredHash(r.geometrySha256)&&requiredHash(r.geometryResourceSha256);
 if(!topology.counterpartVersions.every(r=>identity(r)&&r.entityId!==next.entityId)||new Set(topology.counterpartVersions.map(r=>r.entityId)).size!==topology.counterpartVersions.length)fail('distinct source counterpart identities required');
 const scope=review.sourceScope;
 if(!Array.isArray(scope)||!scope.length||!scope.every(identity)||new Set(scope.map(r=>r.entityId)).size!==scope.length)fail('exact declared source scope required');
 if(dated&&(scope.length!==2||scope.some(r=>!Object.hasOwn(r,'validFrom')||!(r.validFrom===null||typeof r.validFrom==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(r.validFrom))||r.validTo!==null)))fail('two current source versions with exact periods required');
 const resourceHash=createHash('sha256').update(JSON.stringify(v.geometry)+'\n').digest('hex');
 const selected=scope.filter(r=>r.entityId===next.entityId);
 if(dated&&(selected.length!==1||selected[0].validFrom!==v.validFrom||selected[0].validTo!==v.validTo))fail('selected source period mismatch');
 if(selected.length!==1||selected[0].versionId!==v.versionId||selected[0].geometrySha256!==digest(v.geometry)||selected[0].geometryResourceSha256!==resourceHash)fail('selected exact source scope required');
 for(const row of scope)if(row.entityId!==next.entityId&&!topology.counterpartVersions.some(r=>isDeepStrictEqual(r,row)))fail('unreviewed source scope');
 const paths=scope.flatMap(r=>['assets/data/territorial-entities/source/countries/'+r.entityId.replace(':','-')+'.json','assets/data/territorial-entities/source/geometries/sha256-'+r.geometryResourceSha256+'.json']);
 if(new Set(paths).size!==paths.length||new Set(prefixes).size!==prefixes.length||!isDeepStrictEqual([...paths].sort(),[...prefixes].sort()))fail('exact descriptor/geometry source scope required');
 // Keep the prepared provenance immutable. Successive receipts form a digest
 // chain back to that exact archived prepared-current adoption, never to a new
 // claim that the old historical/display evidence approved this source delta.
 const current=old.historicalProvenance?.currentGeometrySource;
 if(current?.status!=='approved-prepared-current-source-adoption'||!requiredHash(current.geometrySha256)||!evidence(current.sourceReview)||!evidence(review.priorPreparedSourceReview)||current.sourceReview.sha256!==review.priorPreparedSourceReview.sha256||previous.metadata?.representativeGeometryVersionId!==v.versionId||previous.sourceInfo?.geometryVersionId!==v.versionId||next.sourceInfo?.geometryVersionId!==v.versionId)fail('explicit prepared-current source anchor required');
 let cursor=review,expected=digest(old.geometry),receipt=review.previousSharedArcReview;
 if(old.modernBoundarySupplement?.adoptionMode===method){if(!sameReceipt(receipt,old.modernBoundarySupplement.sourceAdoptionReview))fail('previous shared-arc receipt required');}
 else if(receipt!==undefined||old.modernBoundarySupplement?.sourceAdoptionReview)fail('unrecognized initial source lineage');
 const visited=new Set();
 while(receipt!==undefined){
  if(!evidence(receipt)||visited.has(receipt.sha256))fail('cyclic or invalid shared-arc lineage');visited.add(receipt.sha256);
  cursor=archivedReview(receipt);
  if(cursor.schemaVersion!==1||cursor.status!=='raw-source-only-not-display-approved'||cursor.method!==method||cursor.wholeCountryRaw!==false||cursor.rawCoordinateRoundtrip!==true||cursor.entityId!==next.entityId||cursor.versionId!==v.versionId||cursor.validFrom!==v.validFrom||cursor.validTo!==v.validTo||(dated&&(!isDeepStrictEqual(cursor.selectedVersion,review.selectedVersion)||!isDeepStrictEqual(cursor.preservedVersions,review.preservedVersions)))||cursor.geometrySha256!==expected||!requiredHash(cursor.previousGeometrySha256)||cursor.geometrySha256===cursor.previousGeometrySha256||!sameReceipt(cursor.priorPreparedSourceReview,review.priorPreparedSourceReview))fail('broken prior shared-arc digest chain');
  expected=cursor.previousGeometrySha256;receipt=cursor.previousSharedArcReview;
 }
 if(expected!==current.geometrySha256)fail('shared-arc chain does not reach prepared source');
 const prior=archivedReview(review.priorPreparedSourceReview),rows=prior.rows?.filter(r=>r.entityId===next.entityId&&r.versionId===v.versionId);
 if(prior.schemaVersion!==1||prior.status!=='source-topology-reviewed-conditional-on-coherent-pga-retirement'||!Array.isArray(rows)||rows.length!==1)fail('prepared source review row required');
 const row=rows[0];
 if(row.validFrom!==v.validFrom||row.validTo!==v.validTo||row.candidateGeometrySha256!==expected||row.donorGeometrySha256!==expected||row.exactDonorCoordinateCopy!==true||row.periodPreserved!==true||row.candidate?.valid!==true||row.candidate.empty!==false)fail('stale prepared source review');
 const source=archivedReview(review.source);
 if(source.schemaVersion!==1||source.method!=='exact-gpkg-wkb-chain-extraction'||typeof source.sourcePath!=='string'||!source.sourcePath||!Array.isArray(source.rows))fail('archived original feature-chain evidence required');
 const changes=review.sharedArcChanges;
 if(!Array.isArray(changes)||!changes.length||!['Polygon','MultiPolygon'].includes(old.geometry.type)||v.geometry.type!==old.geometry.type)fail('indexed original shared arcs required');
 const expectedGeometry=structuredClone(old.geometry),before=polygons(old.geometry),groups=new Map();
 for(const change of changes){
  const {target,original,counterpartVersion:counterpart}=change||{};
  if(!interval(target)||!interval(original))fail('nonwrapping exterior arc indices required');
  const oldRing=before[target.polygonIndex]?.[target.ringIndex];
  if(!ring(oldRing)||target.endIndex>=oldRing.length||target.endIndex-target.startIndex>=oldRing.length-1)fail('existing partial closed ring required');
  const previousChain=oldRing.slice(target.startIndex,target.endIndex+1),coordinates=original.coordinates;
  if(!chain(previousChain)||!chain(coordinates)||coordinates.length!==original.endIndex-original.startIndex+1||!isDeepStrictEqual(previousChain[0],coordinates[0])||!isDeepStrictEqual(previousChain.at(-1),coordinates.at(-1))||isDeepStrictEqual(previousChain,coordinates))fail('changed original chain with exact endpoints required');
  if(change.previousCoordinatesSha256!==hash(previousChain)||change.coordinatesSha256!==hash(coordinates)||original.coordinatesSha256!==hash(coordinates)||typeof original.featureId!=='string'||!original.featureId||!requiredHash(original.blobSha256))fail('shared-arc coordinate hashes required');
  const sourceRows=source.rows.filter(r=>r.code===next.entityId.slice(6)&&r.WP_ID===original.featureId&&r.rawBlobSha256===original.blobSha256&&r.rawPolygon===original.polygonIndex&&r.rawRing===original.ringIndex&&isDeepStrictEqual(r.rawRange,[original.startIndex,original.endIndex]));
  if(sourceRows.length!==1||sourceRows[0].candidateExactOriginal!==true||sourceRows[0].coordinatesSha256!==original.coordinatesSha256||!isDeepStrictEqual(sourceRows[0].coordinates,coordinates))fail('chain differs from archived original feature');
  if(!counterpart||counterpart.entityId===next.entityId||!requiredHash(counterpart.previousGeometrySha256)||!topology.counterpartVersions.some(r=>r.entityId===counterpart.entityId&&r.versionId===counterpart.versionId&&r.geometrySha256===counterpart.geometrySha256)||!chain(counterpart.previousCoordinates)||!chain(counterpart.coordinates)||counterpart.previousCoordinatesSha256!==hash(counterpart.previousCoordinates)||counterpart.coordinatesSha256!==hash(counterpart.coordinates)||!isDeepStrictEqual(previousChain,[...counterpart.previousCoordinates].reverse())||!isDeepStrictEqual(coordinates,[...counterpart.coordinates].reverse()))fail('paired counterpart old/new shared chains required');
  if(dated&&!topology.counterpartVersions.some(r=>r.entityId===counterpart.entityId&&r.versionId===counterpart.versionId&&r.validFrom===counterpart.validFrom&&r.validTo===counterpart.validTo))fail('paired counterpart exact current period required');
  const key=target.polygonIndex+':'+target.ringIndex,group=groups.get(key)||[];group.push(change);groups.set(key,group);
 }
 for(const changes of groups.values()){
  changes.sort((a,b)=>a.target.startIndex-b.target.startIndex);
  for(let i=1;i<changes.length;i++)if(changes[i].target.startIndex<changes[i-1].target.endIndex)fail('duplicate or overlapping shared arc ranges');
  // Adjacent arcs may share an unchanged endpoint, but never an input edge.
  const target=changes[0].target,oldRing=before[target.polygonIndex][target.ringIndex],output=[];let cursor=0;
  for(const change of changes){const {startIndex,endIndex}=change.target;output.push(...oldRing.slice(cursor,startIndex),...change.original.coordinates.slice(0,-1));cursor=endIndex;}
  output.push(...oldRing.slice(cursor));if(!ring(output))fail('shared arc closure changed');polygons(expectedGeometry)[target.polygonIndex][target.ringIndex]=output;
 }
 if(!isDeepStrictEqual(expectedGeometry,v.geometry))fail('coordinates or metadata outside selected shared arcs changed');
 return 1;
}

// Complete existing hole-free components are not shared arcs, whole features or holes.
// Keep the small deterministic Polygon WKB encoder local: importing the authoring
// owner here would create an owner -> review -> owner cycle.
function assertOriginalExistingComponents(next,previous,review,{prefixes,archivedReview,fail}){
 const method='lossless-original-existing-component',v=next.geometryVersions[0],old=previous.geometryVersions[0],hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex'),bytesHash=b=>createHash('sha256').update(b).digest('hex'),resource=g=>bytesHash(JSON.stringify(g)+'\n');
 const sameReceipt=(a,b)=>evidence(a)&&evidence(b)&&isDeepStrictEqual(a,b),index=n=>Number.isSafeInteger(n)&&n>=0;
 const component=c=>Array.isArray(c)&&c.length===1&&Array.isArray(c[0])&&c[0].length>=4&&c[0].every((p,i)=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=180&&Math.abs(p[1])<=90&&(!i||!isDeepStrictEqual(p,c[0][i-1])))&&isDeepStrictEqual(c[0][0],c[0].at(-1))&&Number.isFinite(c[0].reduce((a,p,i,r)=>a+p[0]*r[(i+1)%r.length][1]-r[(i+1)%r.length][0]*p[1],0))&&c[0].reduce((a,p,i,r)=>a+p[0]*r[(i+1)%r.length][1]-r[(i+1)%r.length][0]*p[1],0)!==0;
 const wkbHash=c=>{const ring=c[0],b=Buffer.alloc(13+ring.length*16);b[0]=1;b.writeUInt32LE(3,1);b.writeUInt32LE(1,5);b.writeUInt32LE(ring.length,9);ring.forEach((p,i)=>{b.writeDoubleLE(p[0],13+i*16);b.writeDoubleLE(p[1],21+i*16);});return bytesHash(b);};
 if(next.geometryVersions.length!==1||old.validFrom!==null||old.validTo!==null||v.validFrom!==null||v.validTo!==null||review.validFrom!==null||review.validTo!==null||old.geometry.type!=='MultiPolygon'||v.geometry.type!=='MultiPolygon'||old.geometry.coordinates.length!==v.geometry.coordinates.length)fail('components require one undated unchanged MultiPolygon inventory');
 if(review.wholeCountryRaw!==false||v.modernBoundarySupplement.wholeCountryRaw!==false||v.modernBoundarySupplement.adoptionMode!==method||review.rawCoordinateRoundtrip!==true||review.sharedArcChanges!==undefined||review.subgeometryChanges!==undefined||review.previousSharedArcReview!==undefined)fail('explicit partial existing-component attribution required');
 const attributionKeys=new Set(['sourceId','status','geometrySha256','adoptionMode','priorPreparedAttribution','sourceAdoptionReview','wholeCountryRaw']);for(const [k,val]of Object.entries(old.modernBoundarySupplement||{}))if(!attributionKeys.has(k)&&!isDeepStrictEqual(v.modernBoundarySupplement[k],val))fail('component prior source evidence changed: '+k);
 if(review.sourceInfoGeometryDigestFormat!=='sha256(JSON.stringify([geometry.type, geometry.coordinates]))'||next.sourceInfo?.geometrySha256!==digest(v.geometry)||v.modernBoundarySupplement.geometrySha256!==digest(v.geometry))fail('component source digest attribution required');
 const scope=[{entityId:next.entityId,versionId:v.versionId,geometrySha256:digest(v.geometry),geometryResourceSha256:resource(v.geometry)}],paths=['assets/data/territorial-entities/source/countries/'+next.entityId.replace(':','-')+'.json','assets/data/territorial-entities/source/geometries/sha256-'+resource(v.geometry)+'.json'];
 if(!isDeepStrictEqual(review.sourceScope,scope)||prefixes.length!==2||!isDeepStrictEqual([...prefixes].sort(),paths.sort()))fail('exact two component source paths required');
 const current=old.historicalProvenance?.currentGeometrySource;
 if(current?.status!=='approved-prepared-current-source-adoption'||!requiredHash(current.geometrySha256)||!evidence(current.sourceReview)||!evidence(review.priorPreparedSourceReview)||current.sourceReview.sha256!==review.priorPreparedSourceReview.sha256||previous.metadata?.representativeGeometryVersionId!==v.versionId||previous.sourceInfo?.geometryVersionId!==v.versionId||next.sourceInfo?.geometryVersionId!==v.versionId)fail('explicit component prepared-current root required');
 let expected=digest(old.geometry),receipt=review.previousComponentReview;const visited=new Set();if(old.modernBoundarySupplement?.adoptionMode===method){if(!sameReceipt(receipt,old.modernBoundarySupplement.sourceAdoptionReview))fail('previous component receipt required');}else if(receipt!==undefined||old.modernBoundarySupplement?.sourceAdoptionReview)fail('unrecognized initial component lineage');
 while(receipt!==undefined){if(!evidence(receipt)||visited.has(receipt.sha256))fail('cyclic component lineage');visited.add(receipt.sha256);const r=archivedReview(receipt);if(r.schemaVersion!==1||r.status!=='raw-source-only-not-display-approved'||r.method!==method||r.entityId!==next.entityId||r.versionId!==v.versionId||r.validFrom!==null||r.validTo!==null||r.wholeCountryRaw!==false||r.rawCoordinateRoundtrip!==true||r.geometrySha256!==expected||!requiredHash(r.previousGeometrySha256)||r.previousGeometrySha256===r.geometrySha256||!sameReceipt(r.priorPreparedSourceReview,review.priorPreparedSourceReview))fail('broken component digest lineage');expected=r.previousGeometrySha256;receipt=r.previousComponentReview;}
 if(expected!==current.geometrySha256)fail('component lineage does not reach prepared root');const prior=archivedReview(review.priorPreparedSourceReview),rows=prior.rows?.filter(r=>r.entityId===next.entityId&&r.versionId===v.versionId),r=rows?.[0];
 if(prior.schemaVersion!==1||prior.status!=='source-topology-reviewed-conditional-on-coherent-pga-retirement'||rows?.length!==1||r.validFrom!==null||r.validTo!==null||r.candidateGeometrySha256!==expected||r.donorGeometrySha256!==expected||r.exactDonorCoordinateCopy!==true||r.periodPreserved!==true||r.candidate?.valid!==true||r.candidate.empty!==false)fail('stale component prepared root');
 const source=archivedReview(review.source),correspondence=archivedReview(review.correspondence),topology=archivedReview(review.topologyEvidence),parent=source.parentIdentity;
 if(source.schemaVersion!==1||source.method!=='exact-gpkg-component-extraction'||typeof source.sourcePath!=='string'||!source.sourcePath||!Array.isArray(source.rows)||!Array.isArray(source.rawIdentities)||!parent?.WP_ID||parent.GENC_3!==next.entityId.slice(6)||parent.Show_Disp||parent.Map_Disp)fail('original component parent and feature evidence required');
 if(correspondence.schemaVersion!==1||correspondence.method!=='unique-existing-component-correspondence'||correspondence.previousGeometrySha256!==digest(old.geometry)||correspondence.inputSha256!==resource(old.geometry)||correspondence.currentComponents!==old.geometry.coordinates.length||!index(correspondence.rawComponents)||!Array.isArray(correspondence.checks))fail('bound component correspondence required');
 const changes=review.componentChanges;if(!Array.isArray(changes)||!changes.length)fail('explicit changed existing components required');const selected=changes.map(c=>c?.targetIndex).sort((a,b)=>a-b),seen=new Set(),rawSeen=new Set(),reconstructed=structuredClone(old.geometry);
 const peerIdentity=p=>p&&typeof p.entityId==='string'&&p.entityId!==next.entityId&&typeof p.versionId==='string'&&Object.hasOwn(p,'validFrom')&&Object.hasOwn(p,'validTo')&&(p.validFrom===null||typeof p.validFrom==='string')&&(p.validTo===null||typeof p.validTo==='string')&&requiredHash(p.geometrySha256)&&requiredHash(p.geometryResourceSha256);
 if(review.topology?.status!=='passed'||!Array.isArray(review.topology.checks)||['validity','shared-boundary','gaps-overlaps','holes-islands','ownership'].some(k=>!review.topology.checks.includes(k))||!Array.isArray(review.topology.counterpartVersions)||!review.topology.counterpartVersions.length||!review.topology.counterpartVersions.every(peerIdentity)||new Set(review.topology.counterpartVersions.map(p=>p.entityId+'\0'+p.versionId)).size!==review.topology.counterpartVersions.length)fail('explicit component peer identity and periods required');
 if(topology.schemaVersion!==1||topology.method!=='existing-component-topology'||topology.previousGeometrySha256!==digest(old.geometry)||topology.geometrySha256!==digest(v.geometry)||!isDeepStrictEqual(topology.selectedComponents,selected)||topology.componentCount!==old.geometry.coordinates.length||topology.wholeMultiPolygonValid!==true||topology.allComponentContactsChecked!==true||topology.noNewOverlap!==true||!isDeepStrictEqual(topology.peers,review.topology.counterpartVersions)||!Array.isArray(topology.components)||topology.components.length!==changes.length)fail('bound full component topology required');
 const sameContact=c=>requiredHash(c?.previousIntersectionWkbSha256)&&c.previousIntersectionWkbSha256===c.intersectionWkbSha256;
 for(const change of changes){const i=change?.targetIndex,o=change?.original,oldComponent=old.geometry.coordinates[i];if(!index(i)||seen.has(i)||!component(oldComponent)||!o||!index(o.componentIndex)||o.componentIndex>=correspondence.rawComponents||typeof o.featureId!=='string'||!o.featureId||!requiredHash(o.blobSha256)||!component(o.coordinates)||isDeepStrictEqual(oldComponent,o.coordinates))fail('distinct changed hole-free existing component required');seen.add(i);const rawKey=o.featureId+'\0'+o.componentIndex;if(rawSeen.has(rawKey))fail('duplicate original component index');rawSeen.add(rawKey);
  if(change.previousCoordinatesSha256!==hash(oldComponent)||change.previousWkbSha256!==wkbHash(oldComponent)||o.coordinatesSha256!==hash(o.coordinates)||o.wkbSha256!==wkbHash(o.coordinates))fail('actual component coordinate and WKB digests required');
  const identities=source.rawIdentities.filter(r=>r.properties?.WP_ID===o.featureId&&r.rawBlobSha256===o.blobSha256);if(identities.length!==1||identities[0].properties.WP_PAR_ID!==parent.WP_ID||identities[0].properties.GENC_3!==parent.GENC_3||identities[0].properties.Show_Disp||identities[0].properties.Map_Disp||!Array.isArray(current.upstream?.sourceWP_IDs)||!current.upstream.sourceWP_IDs.includes(o.featureId))fail('component political source identity changed');
  const originals=source.rows.filter(r=>r.WP_ID===o.featureId&&r.rawBlobSha256===o.blobSha256&&r.rawComponent===o.componentIndex&&r.currentComponent===i);if(originals.length!==1||originals[0].oldWkbSha256!==change.previousWkbSha256||originals[0].rawWkbSha256!==o.wkbSha256||!isDeepStrictEqual(originals[0].coordinates,o.coordinates))fail('component differs from archived original coordinates');
  const matches=correspondence.checks.filter(r=>r.WP_ID===o.featureId&&r.rawBlobSha256===o.blobSha256&&r.rawComponent===o.componentIndex);if(matches.length!==1||!isDeepStrictEqual(matches[0].positiveAreaCurrentMatches,[i])||!isDeepStrictEqual(matches[0].positiveAreaRawMatches,[o.componentIndex])||matches[0].hold)fail('bidirectional unique component correspondence required');
  const audits=topology.components.filter(r=>r.targetIndex===i),audit=audits[0];if(audits.length!==1||!Array.isArray(audit.contacts)||audit.contacts.some(c=>!index(c.otherComponent)||c.otherComponent>=old.geometry.coordinates.length||c.otherComponent===i||!sameContact(c))||new Set(audit.contacts.map(c=>c.otherComponent)).size!==audit.contacts.length||!Array.isArray(audit.peerContacts)||audit.peerContacts.length!==topology.peers.length||topology.peers.some(p=>{const rows=audit.peerContacts.filter(c=>c.entityId===p.entityId&&c.versionId===p.versionId);return rows.length!==1||!sameContact(rows[0]);}))fail('unchanged exact component and peer WKB contacts required');
  reconstructed.coordinates[i]=o.coordinates;
 }
 if(!isDeepStrictEqual(reconstructed,v.geometry))fail('coordinates or metadata outside selected components changed');return 1;
}

/** Admit an original modern authoring source, never a display or compiled resource.
 * Evidence must already be archived by the storage owner, not supplied by a flag.
 * A dated current-source proxy needs its existing archived adoption evidence;
 * this does not approve historical reconstruction or derived display geometry.
 */
export function assertHistoricalSourceStorageChanges(next,previous,{prefixes,readEvidence}={}){
 const versions=next.geometryVersions||[];
 for(const v of versions){const old=previous?.geometryVersions?.find(p=>p.versionId===v.versionId);if(old&&['lossless-original-shared-arc','lossless-original-current-version-shared-arc','lossless-original-existing-component'].includes(v.modernBoundarySupplement?.adoptionMode)&&digest(old.geometry)===digest(v.geometry)&&!isDeepStrictEqual(v.modernBoundarySupplement.sourceAdoptionReview,old.modernBoundarySupplement?.sourceAdoptionReview))throw Error('Raw source adoption: unchanged shared arc cannot acquire a new receipt');}
 if(previous&&next.entityId===previous.entityId&&versions.length===previous.geometryVersions?.length&&versions.every(v=>{const old=previous.geometryVersions.find(p=>p.versionId===v.versionId);return old&&digest(old.geometry)===digest(v.geometry);})){
  // The explicit dated-current contract is not a metadata-only escape hatch.
  if([...versions,...previous.geometryVersions].some(v=>['lossless-original-current-version-shared-arc','lossless-original-existing-component'].includes(v.modernBoundarySupplement?.adoptionMode))&&!isDeepStrictEqual(next,previous))throw Error('Raw source adoption: dated-current unchanged geometry requires exact metadata');
  return assertHistoricalDisplayChanges(next,previous);
 }
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
 if(review.method==='lossless-original-existing-component')return assertOriginalExistingComponents(next,previous,review,{prefixes,archivedReview,fail});
 if(review.componentChanges!==undefined||review.previousComponentReview!==undefined||v.modernBoundarySupplement.adoptionMode==='lossless-original-existing-component')fail('components cannot claim another source method');
 if(['lossless-original-shared-arc','lossless-original-current-version-shared-arc'].includes(review.method))return assertOriginalSharedArcs(next,previous,review,{prefixes,archivedReview,fail});
 if(review.sharedArcChanges!==undefined||review.previousSharedArcReview!==undefined||['lossless-original-shared-arc','lossless-original-current-version-shared-arc'].includes(v.modernBoundarySupplement.adoptionMode))fail('shared arcs cannot claim complete original feature or hole');
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
