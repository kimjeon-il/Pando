import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
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
