import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {decodeTerritorialSource} from '../data/territorial-source-codec.mjs';
// Same payload as the canonical prepared-polygon digest; GeoJSON key order is metadata.
const digest=geometry=>createHash('sha256').update(JSON.stringify([geometry.type,geometry.coordinates])).digest('hex');
const requiredHash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const historical=version=>version.validFrom!=null||version.validTo!=null||!!version.historicalProvenance;
const evidence=value=>value&&typeof value.reference==='string'&&value.reference.length>0&&requiredHash(value.sha256);
/** Explicit completion of one already-partial current feature. This is not a
 * general relaxation of source caveats or a first-adoption contract. No imports
 * from the original-authoring owner: that owner depends on this module. */
function assertWholeFeatureCompletion(next,previous,review,{prefixes,archivedReview,fail}){
 const reject=m=>fail('whole-feature completion: '+m),v=next.geometryVersions[0],old=previous.geometryVersions[0],s=v.modernBoundarySupplement,prior=old.modernBoundarySupplement;
 const marker={schemaVersion:1,method:'partial-to-whole-original-single-component'};
 if(prefixes.length!==2||new Set(prefixes).size!==2)reject('exact descriptor and original resource scope required');
 if(next.geometryVersions.length!==1||previous.geometryVersions.length!==1||v.validFrom!==null||v.validTo!==null||old.validFrom!==null||old.validTo!==null||review.validFrom!==null||review.validTo!==null)reject('one undated current version required');
 if(!isDeepStrictEqual(s.wholeFeatureCompletion,marker)||!isDeepStrictEqual(review.wholeFeatureCompletion,marker)||!prior||typeof prior!=='object'||!Object.hasOwn(prior,'wholeCountryRaw')||prior.wholeCountryRaw!==false||s.wholeCountryRaw!==true||review.wholeCountryRaw!==true)reject('explicit false-to-true completion markers required');
 if(review.method!=='lossless-original-feature'||s.adoptionMode!==review.method||review.rawCoordinateRoundtrip!==true||s.status!=='raw-source-only-not-display-approved')reject('whole original source-only method required');
 if(next.parentEntityId!==''||previous.parentEntityId!==''||next.instantiation?.mode!=='independent'||previous.instantiation?.mode!=='independent'||!/^state:[A-Z]{3}$/.test(next.entityId))reject('existing independent country identity required');
 const allowed=new Set(['sourceId','status','geometrySha256','adoptionMode','priorPreparedAttribution','sourceAdoptionReview','wholeCountryRaw']);
 for(const [key,value]of Object.entries(prior))if(!allowed.has(key)&&(!Object.hasOwn(s,key)||!isDeepStrictEqual(s[key],value)))reject('prior attribution/caveat changed: '+key);
 const ringOf=(g,original)=>{
  if(!g||!['Polygon','MultiPolygon'].includes(g.type)||original&&g.type!=='MultiPolygon'||Object.keys(g).length!==2||!Object.hasOwn(g,'coordinates'))reject('exact polygon geometry fields required');
  const polys=g.type==='Polygon'?[g.coordinates]:g.coordinates;
  if(!Array.isArray(polys)||polys.length!==1||!Array.isArray(polys[0])||polys[0].length!==1||!Array.isArray(polys[0][0])||polys[0][0].length<4)reject('one component with zero holes required');
  const ring=polys[0][0];if(ring.length>4000000||ring.some(p=>!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)||Math.abs(p[0])>180||Math.abs(p[1])>90)||!isDeepStrictEqual(ring[0],ring.at(-1)))reject('closed finite bounded original ring required');
  return ring;
 };
 ringOf(old.geometry,false);const ring=ringOf(v.geometry,true),source=archivedReview(review.source),properties=source?.properties;
 if(source?.schemaVersion!==1||source.method!=='exact-gpkg-original-feature'||typeof source.featureId!=='string'||!source.featureId||!requiredHash(source.rawBlobSha256)||!requiredHash(source.rawWkbSha256)||!isDeepStrictEqual(source.geometry,v.geometry))reject('strict complete original geometry evidence required');
 if(properties?.WP_ID!==source.featureId||properties.WP_PAR_ID!==source.featureId||properties.GENC_3!==next.entityId.slice(6)||properties.US_Recog!=='Independent'||properties.Map_Disp!==null||properties.Show_Disp!==null)reject('original identity/independence/ownership mismatch');
 if(typeof source.sourcePath!=='string'||!source.sourcePath||!requiredHash(source.sourceFileReceipt?.gpkgSha256)||s.rawSourceFile!==source.sourcePath||s.rawSourceFileSha256!==source.sourceFileReceipt.gpkgSha256||s.rawFeatureId!==source.featureId||!isDeepStrictEqual(s.rawOriginalSource,review.source)||typeof s.sourceFileRole!=='string'||!s.sourceFileRole.trim())reject('separate exact new raw attribution required');
 if(typeof source.rawBlobBase64!=='string'||source.rawBlobBase64.length>90000000||!/^[A-Za-z0-9+/]+={0,2}$/.test(source.rawBlobBase64))reject('canonical original blob required');
 const blob=Buffer.from(source.rawBlobBase64,'base64');
 if(blob.length<53||blob.length>64*1024*1024||blob.toString('base64')!==source.rawBlobBase64||createHash('sha256').update(blob).digest('hex')!==source.rawBlobSha256||blob[0]!==71||blob[1]!==80||blob[2]!==0||blob[3]!==3||blob.readInt32LE(4)!==4326)reject('supported original GeoPackage header/hash required');
 let minx=Infinity,maxx=-Infinity,miny=Infinity,maxy=-Infinity;for(const [x,y]of ring){minx=Math.min(minx,x);maxx=Math.max(maxx,x);miny=Math.min(miny,y);maxy=Math.max(maxy,y);}
 const bounds=[minx,maxx,miny,maxy];for(let i=0;i<4;i++)if(!Number.isFinite(blob.readDoubleLE(8+i*8))||blob.readDoubleLE(8+i*8)!==bounds[i])reject('original envelope differs from candidate bounds');
 // Exact 2D singleton MultiPolygon WKB. No rounding, repair, ring rotation,
 // JSON numeric serialization or WKB coordinate parser can change binary64.
 const wkb=Buffer.alloc(22+ring.length*16);wkb[0]=1;wkb.writeUInt32LE(6,1);wkb.writeUInt32LE(1,5);wkb[9]=1;wkb.writeUInt32LE(3,10);wkb.writeUInt32LE(1,14);wkb.writeUInt32LE(ring.length,18);for(let i=0;i<ring.length;i++){wkb.writeDoubleLE(ring[i][0],22+i*16);wkb.writeDoubleLE(ring[i][1],30+i*16);}
 if(!blob.subarray(40).equals(wkb)||createHash('sha256').update(wkb).digest('hex')!==source.rawWkbSha256)reject('candidate is not byte-exact original WKB');
 if(s.geometrySha256!==digest(v.geometry)||next.sourceInfo?.geometryVersionId!==v.versionId||next.sourceInfo?.geometrySha256!==digest(v.geometry)||review.sourceInfoGeometryDigestFormat!=='sha256(JSON.stringify([geometry.type, geometry.coordinates]))')reject('current source geometry attribution mismatch');
}
/** Restoration is a separate registered contract, not a wider singleton gate. */
function assertOmittedOriginalRestoration(next,previous,review,{prefixes,archivedReview,readEvidence,getSourceSnapshot,fail}){
 const reject=m=>fail('omitted-component restoration: '+m),hash=b=>createHash('sha256').update(b).digest('hex'),eq=isDeepStrictEqual,base='assets/data/territorial-entities/source/',marker={schemaVersion:1,method:'restore-omitted-original-components'};
 const old=previous.geometryVersions[0],v=next.geometryVersions[0],prior=old.modernBoundarySupplement,s=v.modernBoundarySupplement;
 if(prefixes.length!==2||new Set(prefixes).size!==2||previous.geometryVersions.length!==1||next.geometryVersions.length!==1||old.validFrom!==null||old.validTo!==null||v.validFrom!==null||v.validTo!==null||review.validFrom!==null||review.validTo!==null||old.historicalProvenance!=null)reject('one ordinary undated source and exact two paths required');
 if(!eq(s.wholeFeatureCompletion,marker)||!eq(review.wholeFeatureCompletion,marker)||!prior||!Object.hasOwn(prior,'wholeCountryRaw')||prior.wholeCountryRaw!==false||s.wholeCountryRaw!==true||review.wholeCountryRaw!==true||s.adoptionMode!=='lossless-original-feature'||review.method!==s.adoptionMode||review.rawCoordinateRoundtrip!==true||s.status!=='raw-source-only-not-display-approved')reject('explicit partial-to-complete original restoration required');
 if(previous.parentEntityId!==''||next.parentEntityId!==''||previous.instantiation?.mode!=='independent'||next.instantiation?.mode!=='independent'||!/^state:[A-Z]{3}$/.test(next.entityId))reject('unchanged independent country required');
 const allowed=new Set(['sourceId','status','geometrySha256','adoptionMode','wholeCountryRaw','priorPreparedAttribution','sourceAdoptionReview']);for(const [k,x]of Object.entries(prior))if(!allowed.has(k)&&(!Object.hasOwn(s,k)||!eq(x,s[k])))reject('old attribution and preimage-index review must remain exact: '+k);
 const coordinate=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite),sameBounds=(a,b)=>Array.isArray(a)&&a.length===4&&a.every((x,i)=>Number.isFinite(x)&&x===b[i]);
 function polygons(g,bounded=false,noHoles=false){if(!g||!['Polygon','MultiPolygon'].includes(g.type)||!Array.isArray(g.coordinates))reject('polygon coordinate payload required');const ps=g.type==='Polygon'?[g.coordinates]:g.coordinates;if(!ps.length)reject('empty geometry');for(const p of ps){if(!Array.isArray(p)||!p.length||noHoles&&p.length!==1)reject('nonempty zero-hole components required');for(const r of p){if(!Array.isArray(r)||r.length<4||r.some(x=>!coordinate(x)||bounded&&(Math.abs(x[0])>180||Math.abs(x[1])>90))||!eq(r[0],r.at(-1)))reject('closed finite original rings required');}}return ps;}
 function bounds(ps){const b=[Infinity,Infinity,-Infinity,-Infinity];for(const p of ps)for(const r of p)for(const [x,y]of r){b[0]=Math.min(b[0],x);b[1]=Math.min(b[1],y);b[2]=Math.max(b[2],x);b[3]=Math.max(b[3],y);}return b;}
 function wkb(ps){let size=9;for(const p of ps){size+=9;for(const r of p)size+=4+r.length*16;}if(size>64*1024*1024)reject('original feature exceeds bounded payload');const b=Buffer.alloc(size);let i=0;const u=n=>{b.writeUInt32LE(n,i);i+=4;},head=t=>{b[i++]=1;u(t);};head(6);u(ps.length);for(const p of ps){head(3);u(p.length);for(const r of p){u(r.length);for(const [x,y]of r){b.writeDoubleLE(x,i);b.writeDoubleLE(y,i+8);i+=16;}}}return b;}
 function checkBlob(record,g,prepared=false){const ps=polygons(g,true,true);if(g.type!=='MultiPolygon'||Object.keys(g).length!==2)reject('exact MultiPolygon fields required');const str=record.rawBlobBase64,bh=prepared?record.blobSha256:record.rawBlobSha256,wh=prepared?record.wkbSha256:record.rawWkbSha256;if(typeof str!=='string'||str.length>90000000||!/^[A-Za-z0-9+/]+={0,2}$/.test(str)||!requiredHash(bh)||!requiredHash(wh))reject('original blob evidence required');const b=Buffer.from(str,'base64');if(b.length<53||b.length>64*1024*1024||b.toString('base64')!==str||hash(b)!==bh||b[0]!==71||b[1]!==80||b[2]!==0||b[3]!==3||b.readInt32LE(4)!==4326)reject('actual GeoPackage header/SRID/hash mismatch');const box=bounds(ps),envelope=[box[0],box[2],box[1],box[3]];for(let i=0;i<4;i++)if(b.readDoubleLE(8+i*8)!==envelope[i])reject('actual original envelope mismatch');const bytes=wkb(ps);if(!b.subarray(40).equals(bytes)||hash(bytes)!==wh)reject('actual original WKB differs');return ps;}
 function word(p){const b=Buffer.alloc(16);b.writeDoubleLE(p[0],0);b.writeDoubleLE(p[1],8);return b.toString('hex');}
 function cyclic(r){const words=r.slice(0,-1).map(word);let best;for(const seq of [words,[...words].reverse()]){let least=seq[0];for(const x of seq)if(x<least)least=x;for(let i=0;i<seq.length;i++)if(seq[i]===least){const candidate=seq.slice(i).concat(seq.slice(0,i)).join('');if(best===undefined||candidate<best)best=candidate;}}return best;}
 const canonical=ps=>ps.map(p=>JSON.stringify([cyclic(p[0]),p.slice(1).map(cyclic).sort()])).sort();
 const source=archivedReview(review.source),scope=archivedReview(review.restorationScope);
 if(source.schemaVersion!==1||source.method!=='exact-gpkg-original-feature'||!eq(source.geometry,v.geometry)||scope.schemaVersion!==1||scope.proposedMethod!=='restore-omitted-original-components'||!eq(scope.originalSource,review.source)||scope.approvalClaimed!==false||typeof scope.uncertainty!=='string'||!scope.uncertainty.trim())reject('typed original restoration scope required');
 const raw=checkBlob(source,v.geometry),before=polygons(old.geometry,true,true),props=source.properties;if(old.geometry.type!=='MultiPolygon'||raw.length<=before.length||before.length<1)reject('strict nonempty existing subset required');
 if(props?.WP_ID!==source.featureId||props.WP_PAR_ID!==source.featureId||props.GENC_3!==next.entityId.slice(6)||props.US_Recog!=='Independent'||props.Map_Disp!==null||props.Show_Disp!==null)reject('original ownership/identity mismatch');
 if(s.rawSourceFile!==source.sourcePath||!source.sourcePath||s.rawSourceFileSha256!==source.sourceFileReceipt?.gpkgSha256||!requiredHash(s.rawSourceFileSha256)||s.rawFeatureId!==source.featureId||!eq(s.rawOriginalSource,review.source)||typeof s.sourceFileRole!=='string'||!s.sourceFileRole.trim())reject('new raw attribution must be separately bound');
 const targetPath=base+'countries/'+next.entityId.replace(':','-')+'.json',targetBytes=readEvidence(targetPath),targetDescriptor=JSON.parse(targetBytes),targetResource=base+targetDescriptor.geometryVersions[0].geometryResource.file,targetResourceBytes=readEvidence(targetResource),target=scope.target;
 if(!eq(decodeTerritorialSource(targetDescriptor,p=>readEvidence(base+p)),previous)||target.entityId!==next.entityId||target.versionId!==v.versionId||target.validFrom!==null||target.validTo!==null||target.previousDescriptorSha256!==hash(targetBytes)||target.previousResourceSha256!==hash(targetResourceBytes)||target.previousGeometrySha256!==digest(old.geometry)||target.previousSupplementSha256!==hash(JSON.stringify(prior)))reject('actual source preimage or old review binding mismatch');
 const map=archivedReview(scope.componentMap),retained=new Set(),mapping=[];
 if(map.previousResourceSha256!==hash(targetResourceBytes)||map.candidateSha256!==hash(JSON.stringify(v.geometry)+'\n')||map.rawBlobSha256!==source.rawBlobSha256||map.rawWkbSha256!==source.rawWkbSha256||map.oldComponentCount!==before.length||map.newComponentCount!==raw.length||map.deletedComponents!==0||map.existingCoordinateMoves!==0||!Array.isArray(map.pairs)||map.pairs.length!==before.length)reject('exact preimage component map required');
 for(let i=0;i<before.length;i++){const hits=[];for(let j=0;j<raw.length;j++)if(eq(before[i],raw[j])&&wkb([before[i]]).equals(wkb([raw[j]])))hits.push(j);if(hits.length!==1||retained.has(hits[0]))reject('old component must have one unique strict original match');const j=hits[0],row=map.pairs[i],componentHash=hash(wkb([raw[j]]).subarray(9));if(row.oldIndex!==i||row.newOriginalIndex!==j||row.oldComponentWkbSha256!==componentHash||row.originalComponentWkbSha256!==componentHash||row.coordinatesStrictEqual!==true||row.componentWkbByteEqual!==true)reject('old-index mapping mismatch');retained.add(j);mapping.push(j);}
 const anchor=prior.existingComponentSourceReview;
 if(!anchor||!eq(anchor.rawFeatureIds,[source.featureId])||!eq(anchor.rawBlobSha256,[source.rawBlobSha256])||anchor.geometrySha256!==digest(old.geometry)||!Array.isArray(anchor.components)||anchor.components.length!==before.length)reject('immutable prior whole-original blob/feature anchor mismatch');
 const anchoredIndexes=new Set();for(const row of anchor.components){if(!Number.isInteger(row.currentComponent)||row.currentComponent<0||row.currentComponent>=before.length||anchoredIndexes.has(row.currentComponent)||row.rawComponent!==mapping[row.currentComponent]||row.WP_ID!==source.featureId||row.rawBlobSha256!==source.rawBlobSha256)reject('immutable prior component original identity mismatch');anchoredIndexes.add(row.currentComponent);}
 if(prior.pairedSourceReview&&(prior.pairedSourceReview.rawFeatureId!==source.featureId||prior.pairedSourceReview.rawBlobSha256!==source.rawBlobSha256))reject('immutable paired original anchor mismatch');
 const added=raw.map((p,i)=>i).filter(i=>!retained.has(i));if(!eq(scope.addedOriginalIndexes,added)||!eq(map.addedComplement?.map(x=>x.originalIndex),added)||scope.oldComponentCount!==before.length||scope.newComponentCount!==raw.length||scope.oldHoles!==0||scope.newHoles!==0||scope.existingCoordinateMoves!==0||scope.deletedComponents!==0||typeof scope.oldIndexMeaning!=='string'||!scope.oldIndexMeaning.trim())reject('full exact original complement and preimage index meaning required');
 const addedBounds=added.map(i=>bounds([raw[i]]));for(let k=0;k<added.length;k++){const row=map.addedComplement[k],p=raw[added[k]];if(row.componentWkbSha256!==hash(wkb([p]).subarray(9))||!sameBounds(row.bounds,addedBounds[k])||row.holes!==0||row.points!==p[0].length||row.absentFromPreparedAndApproved!==true)reject('added original component evidence mismatch');}
 const prepared=archivedReview(scope.preparedFeature),donor=archivedReview(scope.approvedDonorFeature),bridge=archivedReview(scope.scopeBridge),lineage=archivedReview(scope.ordinaryLineage),rootReport=archivedReview(scope.preparedAdoptionRoot),preparedPolys=checkBlob(prepared,prepared.geometry,true),donorPolys=polygons(donor.geometry,true,true);
 const withoutFid=p=>Object.fromEntries(Object.entries(p||{}).filter(([k])=>k!=='fid'));
 if(prepared.schemaVersion!==1||prepared.method!=='actual-recovered-prepared-feature'||prepared.featureId!==source.featureId||!eq(withoutFid(prepared.properties),withoutFid(props))||preparedPolys.length!==before.length||donorPolys.length!==before.length||donor.id!==next.entityId.slice(6)||!eq(canonical(preparedPolys),canonical(donorPolys)))reject('actual prepared/donor binary64 cyclic equivalence or identity mismatch');
 const chain=[];let root=prior;while(root){chain.push(root);if(chain.length>32)reject('invalid ordinary attribution lineage');root=root.priorPreparedAttribution;}const approved=chain.find(x=>x.sourceId==='approved-current-world-display-20261107'&&x.status==='approved-prepared-current-source-adoption');
 if(!approved||approved.geometrySha256!==digest(donor.geometry)||approved.sourceFileSha256!==bridge.approvedDonor?.fileSha256||approved.upstream?.recordedSourceFileSha256!==prepared.fileSha256||!eq(lineage.preparedSourceRoot?.attribution,approved)||lineage.preparedSourceRoot.actualReviewSha256!==scope.preparedAdoptionRoot.sha256||approved.sourceReview?.sha256!==scope.preparedAdoptionRoot.sha256||lineage.preparedSourceRoot.candidateGeometrySha256!==digest(donor.geometry)||lineage.preparedSourceRoot.approvedDonorGeometrySha256!==digest(donor.geometry)||lineage.historicalProvenancePresent!==false||lineage.synthesizedHistoricalRoot!==false)reject('actual ordinary prepared attribution root required');
 const rootRows=rootReport.rows?.filter(r=>r.entityId===next.entityId&&r.versionId===v.versionId);if(rootReport.schemaVersion!==1||rootReport.status!=='source-topology-reviewed-conditional-on-coherent-pga-retirement'||rootRows?.length!==1||rootRows[0].candidateGeometrySha256!==digest(donor.geometry)||rootRows[0].donorGeometrySha256!==digest(donor.geometry)||rootRows[0].exactDonorCoordinateCopy!==true||rootRows[0].periodPreserved!==true||rootRows[0].validFrom!==null||rootRows[0].validTo!==null)reject('prepared-to-approved archived root row mismatch');
 for(const key of ['previousDescriptorSha256','previousResourceSha256','previousGeometrySha256','previousSupplementSha256'])if(lineage[key]!==target[key])reject('current source lineage preimage mismatch');
 if(bridge.schemaVersion!==1||bridge.entityId!==next.entityId||bridge.versionId!==v.versionId||bridge.descriptorSha256!==target.previousDescriptorSha256||bridge.previousResourceSha256!==target.previousResourceSha256||bridge.original?.featureId!==source.featureId||bridge.original.blobSha256!==source.rawBlobSha256||bridge.original.wkbSha256!==source.rawWkbSha256||bridge.prepared?.featureId!==source.featureId||bridge.prepared.fileSha256!==prepared.fileSha256||bridge.prepared.blobSha256!==prepared.blobSha256||bridge.approvedDonor?.equalsPrepared!==true||bridge.approvedDonor.preparedMinusDonorEmpty!==true||bridge.approvedDonor.donorMinusPreparedEmpty!==true||bridge.politicalAttributesExactExceptFid!==true||bridge.original.evidenceSha256!==scope.originalSource.sha256||bridge.prepared.evidenceSha256!==scope.preparedFeature.sha256||bridge.approvedDonor.evidenceSha256!==scope.approvedDonorFeature.sha256||bridge.componentMapSha256!==scope.componentMap.sha256||lineage.scopeBridgeSha256!==scope.scopeBridge.sha256||lineage.componentMapSha256!==scope.componentMap.sha256)reject('typed prepared/original/current scope bridge mismatch');
 // Recompute current resource bounds, and exact binary64 segment/containment
 // disjointness as an additional check on the separately reviewed contact proof.
 const overlaps=(a,b)=>a[0]<=b[2]&&a[2]>=b[0]&&a[1]<=b[3]&&a[3]>=b[1],cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
 const on=(a,b,p)=>cross(a,b,p)===0&&p[0]>=Math.min(a[0],b[0])&&p[0]<=Math.max(a[0],b[0])&&p[1]>=Math.min(a[1],b[1])&&p[1]<=Math.max(a[1],b[1]);
 const segment=(a,b,c,d)=>{if(!overlaps([Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[0],b[0]),Math.max(a[1],b[1])],[Math.min(c[0],d[0]),Math.min(c[1],d[1]),Math.max(c[0],d[0]),Math.max(c[1],d[1])]))return false;const x=cross(a,b,c),y=cross(a,b,d),z=cross(c,d,a),w=cross(c,d,b);return (x>0&&y<0||x<0&&y>0)&&(z>0&&w<0||z<0&&w>0)||x===0&&on(a,b,c)||y===0&&on(a,b,d)||z===0&&on(c,d,a)||w===0&&on(c,d,b);};
 const inRing=(p,r)=>{let inside=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i],b=r[j];if(on(a,b,p))return true;if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;};
 const inPolygon=(p,poly)=>inRing(p,poly[0])&&!poly.slice(1).some(r=>inRing(p,r));
 function touches(a,b){for(const ar of a)for(const br of b)for(let i=1;i<ar.length;i++)for(let j=1;j<br.length;j++)if(segment(ar[i-1],ar[i],br[j-1],br[j]))return true;return inPolygon(a[0][0],b)||inPolygon(b[0][0],a);}
 for(const i of added)for(const p of preparedPolys)if(overlaps(bounds([raw[i]]),bounds([p]))&&touches(raw[i],p))reject('restored component was not omitted from prepared source');
 if(typeof getSourceSnapshot!=='function')reject('authoritative store snapshot provider required');const snapshot=getSourceSnapshot(),universe=archivedReview(scope.currentPeerUniverse),contacts=archivedReview(scope.currentPeerContacts);
 if(!snapshot||!/^[a-f0-9]{40}$/.test(snapshot.archiveRevision||'')||!/^[a-f0-9]{40}$/.test(snapshot.sourcePin||'')||snapshot.sourcePin!==scope.revision||snapshot.sourcePin!==universe.revision||contacts.revision!==snapshot.sourcePin||!Array.isArray(snapshot.countryDescriptorPaths)||new Set(snapshot.countryDescriptorPaths).size!==snapshot.countryDescriptorPaths.length||!Array.isArray(universe.countries)||!Array.isArray(universe.versions)||!Array.isArray(contacts.checks)||contacts.nonemptyContacts?.length!==0||contacts.universeSha256!==scope.currentPeerUniverse.sha256||contacts.componentMapSha256!==scope.componentMap.sha256)reject('authoritative current revision/census/contact evidence required');
 const paths=[...snapshot.countryDescriptorPaths].sort();if(paths.some(p=>!new RegExp('^'+base+'countries/[\\w-]+\\.json$').test(p))||!eq(paths,universe.countries.map(c=>c.path).sort())||new Set(universe.countries.map(c=>c.path)).size!==paths.length)reject('authoritative country set differs from reviewed census');
 const versionKey=v=>JSON.stringify([v.entityId,v.versionId]),reviewedVersions=new Map(),reviewedCountries=new Map(universe.countries.map(c=>[c.path,c])),reviewedContacts=new Map();for(const r of universe.versions){const k=versionKey(r);if(reviewedVersions.has(k))reject('duplicate reviewed current version');reviewedVersions.set(k,r);}for(const r of contacts.checks){const k=versionKey(r);if(reviewedContacts.has(k))reject('duplicate contact version');reviewedContacts.set(k,r);}
 const seen=new Set(),seenContacts=new Set(),resourceCache=new Map(),zero=[],multiple=[];
 // Only small hashes/bounds/hit sets survive each iteration. Resource bytes,
 // parsed geometry and polygon arrays are released; shared resources are deduped.
 for(const path of paths){const bytes=readEvidence(path),d=JSON.parse(bytes),c=reviewedCountries.get(path);if(!Buffer.isBuffer(bytes)||hash(bytes)!==c.descriptorSha256||d.entityId!==c.entityId||path!==base+'countries/'+d.entityId.replace(':','-')+'.json'||!Array.isArray(d.geometryVersions)||new Set(d.geometryVersions.map(v=>v.versionId)).size!==d.geometryVersions.length||!eq(d.geometryVersions.map(v=>({versionId:v.versionId,validFrom:v.validFrom,validTo:v.validTo})),c.allVersions))reject('actual country descriptor/census mismatch');const open=d.geometryVersions.filter(v=>v.validTo===null);if(c.openEndedCount!==open.length)reject('current-version count mismatch');if(!open.length)zero.push(d.entityId);if(open.length>1)multiple.push({entityId:d.entityId,count:open.length});
  for(const version of open){const k=versionKey({entityId:d.entityId,versionId:version.versionId}),r=reviewedVersions.get(k),resource=version.geometryResource;if(seen.has(k)||!r||r.descriptorPath!==path||r.descriptorSha256!==hash(bytes)||r.validFrom!==version.validFrom||r.validTo!==version.validTo||!resource||!requiredHash(resource.sha256)||resource.file!=='geometries/sha256-'+resource.sha256+'.json'||r.resourcePath!==base+resource.file||r.resourceSha256!==resource.sha256)reject('actual current version/resource census mismatch');seen.add(k);let measured=resourceCache.get(resource.sha256);
   if(!measured){const payload=readEvidence(base+resource.file);if(!Buffer.isBuffer(payload)||hash(payload)!==resource.sha256||payload.length!==resource.bytes)reject('actual current resource bytes/hash mismatch');const g=JSON.parse(payload),ps=polygons(g),box=bounds(ps),hits=added.filter((i,n)=>overlaps(addedBounds[n],box));for(const p of ps){const pb=bounds([p]);for(const i of hits)if(overlaps(addedBounds[added.indexOf(i)],pb)&&touches(raw[i],p))reject('actual current country contacts restored original component');}measured={bounds:box,hits,bytes:payload.length};resourceCache.set(resource.sha256,measured);}
   if(measured.bytes!==resource.bytes||!sameBounds(r.bounds,measured.bounds)||!eq(r.addedEnvelopeHits,measured.hits))reject('actual coordinate bounds/hits disagree with reviewed census');
   if(measured.hits.length){const c=reviewedContacts.get(k);if(!c||c.descriptorSha256!==hash(bytes)||c.resourceSha256!==resource.sha256||c.validFrom!==version.validFrom||c.validTo!==version.validTo||!eq(c.checks?.map(x=>x.originalComponent),measured.hits)||c.checks.some(x=>x.intersectionEmpty!==true||x.intersectionArea!==0))reject('complete actual bbox contact coverage required');seenContacts.add(k);}
  }
 }
 if(seen.size!==reviewedVersions.size||seenContacts.size!==reviewedContacts.size||!eq([...zero].sort(),[...universe.zeroCurrent].sort())||!eq(multiple,universe.multipleCurrent)||contacts.countryDescriptorCount!==paths.length||contacts.currentVersionCount!==seen.size||contacts.zeroCurrentCount!==zero.length||contacts.bboxCandidateVersions!==seenContacts.size||!eq(contacts.multipleCurrent,multiple))reject('current universe/contact coverage differs');
 if(s.geometrySha256!==digest(v.geometry)||next.sourceInfo?.geometryVersionId!==v.versionId||next.sourceInfo?.geometrySha256!==digest(v.geometry)||review.sourceInfoGeometryDigestFormat!=='sha256(JSON.stringify([geometry.type, geometry.coordinates]))')reject('current complete-original attribution mismatch');
}
/** First raw append may establish an anchor only from an immutable prepared
 * adoption and already-pinned original/prepared scope evidence. New reports
 * cannot authenticate one another by merely refreshing their own hashes. */
function assertInitialPreparedAppend(next,previous,review,scope,source,{archivedReview,getSourceSnapshot,fail}){
 const reject=m=>fail('initial prepared append: '+m),eq=isDeepStrictEqual,hash=b=>createHash('sha256').update(b).digest('hex');
 const old=previous.geometryVersions[0],v=next.geometryVersions[0],prior=old.modernBoundarySupplement,s=v.modernBoundarySupplement;
 const marker={schemaVersion:1,method:'initial-ordinary-prepared-source-append',rawFeatureId:source.featureId,rawBlobSha256:source.rawBlobSha256};
 if(!eq(review.initialPreparedAppend,marker)||!eq(s.initialPreparedAppend,marker)||Object.hasOwn(prior,'wholeCountryRaw')||Object.hasOwn(prior,'initialPreparedAppend')||prior.pairedSourceReview!==undefined||prior.existingComponentSourceReview!==undefined||prior.priorPreparedAttribution!==undefined)reject('explicit first prepared-source transition required');
 if(prior.sourceId!=='approved-current-world-display-20261107'||prior.status!=='approved-prepared-current-source-adoption'||prior.featureId!==next.entityId.slice(6)||prior.geometrySha256!==digest(old.geometry)||!requiredHash(prior.sourceFileSha256)||!requiredHash(prior.upstream?.recordedSourceFileSha256)||!requiredHash(prior.sourceReview?.sha256))reject('immutable approved prepared attribution required');
 const added=new Set(['sourceId','status','geometrySha256','adoptionMode','priorPreparedAttribution','sourceAdoptionReview','detachedComponentAppend','wholeCountryRaw','initialPreparedAppend']);
 for(const k of Object.keys(s))if(!Object.hasOwn(prior,k)&&!added.has(k))reject('unreviewed new attribution: '+k);
 const proof=archivedReview(scope.initialPreparedSource);
 if(proof.schemaVersion!==1||proof.method!==marker.method||!eq(proof.originalSource,review.source))reject('typed initial prepared proof required');
 if(typeof getSourceSnapshot!=='function')reject('authoritative pinned evidence provider required');
 const snapshot=getSourceSnapshot();
 if(snapshot?.sourcePin!==scope.revision||typeof snapshot.readPinnedEvidence!=='function')reject('authoritative pinned evidence provider required');
 const pinned=receipt=>{
  if(!evidence(receipt)||!/^reports\/(?:[\w.-]+\/)*[\w.-]+\.json$/.test(receipt.reference)||receipt.reference.split('/').some(p=>p==='.'||p==='..'))reject('canonical pinned report path required');
  const bytes=snapshot.readPinnedEvidence(receipt.reference);
  if(!Buffer.isBuffer(bytes)||hash(bytes)!==receipt.sha256)reject('scope evidence absent or different at source pin');
  const current=archivedReview(receipt);if(!eq(current,JSON.parse(bytes)))reject('scope evidence changed after source pin');return current;
 };
 const originalScope=pinned(proof.originalScopeAnchor),preparedScope=pinned(proof.preparedScopeAnchor);
 const rowOf=report=>{const rows=report.rows?.filter(r=>r.code===next.entityId.slice(6));if(rows?.length!==1)reject('one pinned country scope row required');const r=rows[0];if(r.versionId!==v.versionId||r.validFrom!==null||r.validTo!==null||r.descriptorSha256!==scope.target.descriptorSha256||r.resourceSha256!==scope.target.resourceSha256)reject('pinned country scope preimage mismatch');return r;};
 const originalRow=rowOf(originalScope),preparedRow=rowOf(preparedScope),raw=originalRow.originalFeatures;
 if(raw?.length!==1||raw[0].WP_ID!==source.featureId||raw[0].GENC_3!==next.entityId.slice(6)||raw[0].US_Recog!=='Independent'||raw[0].Map_Disp!==null||raw[0].blobSha256!==source.rawBlobSha256||raw[0].wkbSha256!==source.rawWkbSha256)reject('immutable original feature/blob anchor mismatch');
 const prepared=archivedReview(proof.preparedFeature),donor=archivedReview(proof.approvedDonorFeature),root=archivedReview(proof.preparedAdoptionRoot),props=p=>Object.fromEntries(Object.entries(p||{}).filter(([k])=>k!=='fid'));
 if(prepared.schemaVersion!==1||prepared.method!=='actual-recovered-prepared-feature'||prepared.featureId!==source.featureId||prepared.fileSha256!==prior.upstream.recordedSourceFileSha256||!eq(props(prepared.properties),props(source.properties))||preparedRow.WP_ID!==source.featureId||preparedRow.preparedBlobSha256!==prepared.blobSha256||preparedRow.currentStrictArraysEqualDonor!==true||preparedRow.currentEqualsDonorWhole!==true||preparedRow.donorEqualsPreparedWhole!==true||preparedRow.currentEqualsPreparedWhole!==true)reject('actual same-UUID prepared source binding required');
 if(donor.id!==next.entityId.slice(6)||!eq(donor.geometry,old.geometry)||proof.preparedAdoptionRoot.sha256!==prior.sourceReview.sha256)reject('immutable prepared donor/root mismatch');
 const roots=root.rows?.filter(r=>r.entityId===next.entityId&&r.versionId===v.versionId),r=roots?.[0];
 if(root.schemaVersion!==1||root.status!=='source-topology-reviewed-conditional-on-coherent-pga-retirement'||roots?.length!==1||r.validFrom!==null||r.validTo!==null||r.candidateGeometrySha256!==digest(old.geometry)||r.donorGeometrySha256!==digest(old.geometry)||r.exactDonorCoordinateCopy!==true||r.periodPreserved!==true||r.candidate?.valid!==true||r.candidate.empty!==false)reject('prepared adoption root row mismatch');
 // Re-encode the actual prepared GeoPackage blob without rounding or repair.
 const g=prepared.geometry,ps=g?.coordinates;let size=9;const box=[Infinity,-Infinity,Infinity,-Infinity];
 if(g?.type!=='MultiPolygon'||Object.keys(g).length!==2||!Array.isArray(ps)||!ps.length)reject('exact prepared MultiPolygon required');
 for(const p of ps){if(!Array.isArray(p)||!p.length)reject('prepared polygon rings required');size+=9;for(const ring of p){if(!Array.isArray(ring)||ring.length<4||!eq(ring[0],ring.at(-1)))reject('closed prepared ring required');size+=4+ring.length*16;for(const q of ring){if(!Array.isArray(q)||q.length!==2||!q.every(Number.isFinite)||Math.abs(q[0])>180||Math.abs(q[1])>90)reject('finite prepared coordinates required');box[0]=Math.min(box[0],q[0]);box[1]=Math.max(box[1],q[0]);box[2]=Math.min(box[2],q[1]);box[3]=Math.max(box[3],q[1]);}}}
 const str=prepared.rawBlobBase64;
 if(size>64*1024*1024||typeof str!=='string'||str.length>90000000||!/^[A-Za-z0-9+/]+={0,2}$/.test(str)||!requiredHash(prepared.blobSha256)||!requiredHash(prepared.wkbSha256))reject('bounded actual prepared blob required');
 const blob=Buffer.from(str,'base64');if(blob.length!==size+40||blob.toString('base64')!==str||hash(blob)!==prepared.blobSha256||blob[0]!==71||blob[1]!==80||blob[2]!==0||blob[3]!==3||blob.readInt32LE(4)!==4326||box.some((x,i)=>blob.readDoubleLE(8+i*8)!==x))reject('actual prepared header/SRID/hash/envelope mismatch');
 const wkb=Buffer.alloc(size);let at=0;const u=n=>{wkb.writeUInt32LE(n,at);at+=4;},head=t=>{wkb[at++]=1;u(t);};head(6);u(ps.length);for(const p of ps){head(3);u(p.length);for(const ring of p){u(ring.length);for(const [x,y]of ring){wkb.writeDoubleLE(x,at);wkb.writeDoubleLE(y,at+8);at+=16;}}}if(!blob.subarray(40).equals(wkb)||hash(wkb)!==prepared.wkbSha256)reject('actual prepared WKB differs');
 // Explicit bijections avoid topology tolerances and quadratic ring searching.
 const before=old.geometry.coordinates,map=proof.preparedCorrespondence,seen=new Set();
 if(!Array.isArray(map)||map.length!==before.length||ps.length!==before.length)reject('complete prepared component correspondence required');
 for(let i=0;i<before.length;i++){const c=map[i],j=c?.preparedComponent;if(c?.currentComponent!==i||!Number.isSafeInteger(j)||j<0||j>=ps.length||seen.has(j)||!Array.isArray(c.rings)||c.rings.length!==before[i].length||ps[j].length!==before[i].length)reject('bijective prepared component mapping required');seen.add(j);const rings=new Set();for(let k=0;k<before[i].length;k++){const m=c.rings[k],b=m?.preparedRing,a=before[i][k];if(m?.currentRing!==k||!Number.isSafeInteger(b)||b<0||b>=ps[j].length||rings.has(b)||(k===0)!==(b===0)||!Number.isSafeInteger(m.offset)||m.offset<0||m.offset>=a.length-1||typeof m.reverse!=='boolean'||ps[j][b].length!==a.length)reject('bijective prepared ring mapping required');rings.add(b);const n=a.length-1;if(!eq(a[0],a.at(-1)))reject('closed current ring required');for(let t=0;t<n;t++)if(!eq(a[t],ps[j][b][(m.offset+(m.reverse?-t:t)+n)%n]))reject('prepared/current binary64 coordinates differ');}}
}
/** Partial append is deliberately independent of all whole-feature completion gates. */
function assertDetachedComponentAppend(next,previous,review,{prefixes,archivedReview,readEvidence,getSourceSnapshot,fail}){
 const reject=m=>fail('detached-component append: '+m),eq=isDeepStrictEqual,hash=b=>createHash('sha256').update(b).digest('hex'),base='assets/data/territorial-entities/source/';
 const method='lossless-original-detached-component-append',marker={schemaVersion:1,method:'append-original-detached-components'},v=next.geometryVersions[0],old=previous.geometryVersions[0],s=v.modernBoundarySupplement,prior=old.modernBoundarySupplement;
 if(prefixes.length!==2||new Set(prefixes).size!==2||previous.geometryVersions.length!==1||next.geometryVersions.length!==1||old.validFrom!==null||old.validTo!==null||v.validFrom!==null||v.validTo!==null||old.historicalProvenance!=null||review.validFrom!==null||review.validTo!==null)reject('one ordinary undated version and two source paths required');
 if(previous.parentEntityId!==''||next.parentEntityId!==''||previous.instantiation?.mode!=='independent'||next.instantiation?.mode!=='independent'||!/^state:[A-Z]{3}$/.test(next.entityId))reject('existing independent identity required');
 const initial=Object.hasOwn(review,'initialPreparedAppend');
 if(!eq(s.detachedComponentAppend,marker)||!eq(review.detachedComponentAppend,marker)||s.adoptionMode!==method||review.method!==method||(!initial&&prior?.wholeCountryRaw!==false)||s.wholeCountryRaw!==false||review.wholeCountryRaw!==false||Object.hasOwn(s,'wholeFeatureCompletion')||Object.hasOwn(review,'wholeFeatureCompletion')||review.rawCoordinateRoundtrip!==true||s.status!=='raw-source-only-not-display-approved')reject('explicit partial append without whole-country completion required');
 const changed=new Set(['sourceId','status','geometrySha256','adoptionMode','priorPreparedAttribution','sourceAdoptionReview','detachedComponentAppend']);
 for(const [k,value]of Object.entries(prior))if(!changed.has(k)&&!eq(s[k],value))reject('existing attribution/index evidence changed: '+k);
 const scope=archivedReview(review.detachedAppendScope),source=archivedReview(review.source);
 if(scope.schemaVersion!==1||scope.method!==method||!eq(scope.originalSource,review.source)||typeof scope.uncertainty!=='string'||!scope.uncertainty.trim()||typeof scope.oldIndexMeaning!=='string'||!scope.oldIndexMeaning.trim())reject('typed partial scope and preimage-index meaning required');
 const targetPath=base+'countries/'+next.entityId.replace(':','-')+'.json',targetBytes=readEvidence(targetPath),descriptor=JSON.parse(targetBytes),targetResource=base+descriptor.geometryVersions[0].geometryResource.file,targetResourceBytes=readEvidence(targetResource);
 if(!eq(decodeTerritorialSource(descriptor,p=>readEvidence(base+p)),previous)||scope.target?.descriptorSha256!==hash(targetBytes)||scope.target.resourceSha256!==hash(targetResourceBytes)||scope.target.supplementSha256!==hash(JSON.stringify(prior)))reject('authoritative target preimage differs');
 if(source.schemaVersion!==1||source.method!=='exact-gpkg-original-feature'||typeof source.sourcePath!=='string'||!source.sourcePath)reject('actual original source required');
 const props=source.properties;
 if(props?.WP_ID!==source.featureId||props.WP_PAR_ID!==source.featureId||props.GENC_3!==next.entityId.slice(6)||props.US_Recog!=='Independent'||props.Map_Disp!==null||props.Show_Disp!==null)reject('original ownership/identity mismatch');
 if(initial)assertInitialPreparedAppend(next,previous,review,scope,source,{archivedReview,getSourceSnapshot,fail});
 else{
  if(Object.hasOwn(scope,'initialPreparedSource')||(!Object.hasOwn(prior,'initialPreparedAppend')&&Object.hasOwn(s,'initialPreparedAppend')))reject('initial prepared proof cannot be acquired without initial admission');
  const first=prior.initialPreparedAppend;if(first!==undefined&&!eq(first,{schemaVersion:1,method:'initial-ordinary-prepared-source-append',rawFeatureId:source.featureId,rawBlobSha256:source.rawBlobSha256}))reject('immutable initial prepared raw anchor mismatch');
  const anchors=[prior.pairedSourceReview,prior.existingComponentSourceReview,first].filter(x=>x&&typeof x.rawFeatureId==='string'&&typeof x.rawBlobSha256==='string');
  if(!anchors.length||anchors.some(x=>x.rawFeatureId!==source.featureId||x.rawBlobSha256!==source.rawBlobSha256))reject('immutable prior raw feature/blob anchor mismatch');
 }
 function polygons(g,bounded=false){if(!g||!['Polygon','MultiPolygon'].includes(g.type)||!Array.isArray(g.coordinates))reject('polygon coordinate payload required');const ps=g.type==='Polygon'?[g.coordinates]:g.coordinates;if(!ps.length)reject('empty polygon payload');for(const p of ps){if(!Array.isArray(p)||!p.length)reject('empty polygon');for(const r of p){if(!Array.isArray(r)||r.length<4||r.some(a=>!Array.isArray(a)||a.length!==2||!a.every(Number.isFinite)||bounded&&(Math.abs(a[0])>180||Math.abs(a[1])>90))||!eq(r[0],r.at(-1)))reject('closed finite rings required');}}return ps;}
 function bounds(ps){const b=[Infinity,Infinity,-Infinity,-Infinity];for(const p of ps)for(const r of p)for(const [x,y]of r){b[0]=Math.min(b[0],x);b[1]=Math.min(b[1],y);b[2]=Math.max(b[2],x);b[3]=Math.max(b[3],y);}return b;}
 const raw=polygons(source.geometry,true),before=polygons(old.geometry,true),after=polygons(v.geometry,true);
 if(source.geometry.type!=='MultiPolygon'||old.geometry.type!=='MultiPolygon'||v.geometry.type!=='MultiPolygon'||Object.keys(source.geometry).length!==2||Object.keys(v.geometry).length!==2)reject('exact MultiPolygon fields required');
 const indexes=scope.selectedRawIndexes;if(!Array.isArray(indexes)||!indexes.length||indexes.some((x,i)=>!Number.isSafeInteger(x)||x<0||x>=raw.length||i>0&&x<=indexes[i-1]))reject('unique increasing original indices required');
 if(after.length!==before.length+indexes.length||!eq(after.slice(0,before.length),before)||indexes.some((x,i)=>!eq(after[before.length+i],raw[x])))reject('candidate must be exact old prefix plus original arrays');
 const additions=indexes.map(i=>raw[i]);let points=0;for(const p of additions){if(p.length!==1)reject('detached additions must have zero holes');points+=p[0].length;}if(points>200000)reject('append exceeds 200000 point bound');
 const blobText=source.rawBlobBase64;if(typeof blobText!=='string'||blobText.length>90000000||!/^[A-Za-z0-9+/]+={0,2}$/.test(blobText)||!requiredHash(source.rawBlobSha256)||!requiredHash(source.rawWkbSha256))reject('bounded canonical original blob required');
 const blob=Buffer.from(blobText,'base64');if(blob.length<53||blob.length>64*1024*1024||blob.toString('base64')!==blobText||hash(blob)!==source.rawBlobSha256||blob[0]!==71||blob[1]!==80||blob[2]!==0||blob[3]!==3||blob.readInt32LE(4)!==4326)reject('actual original header/SRID/hash mismatch');
 const box=bounds(raw),envelope=[box[0],box[2],box[1],box[3]];for(let i=0;i<4;i++)if(blob.readDoubleLE(8+i*8)!==envelope[i])reject('actual original envelope mismatch');
 let size=9;for(const p of raw){size+=9;for(const r of p)size+=4+r.length*16;}if(size!==blob.length-40)reject('actual WKB length mismatch');const wkb=Buffer.alloc(size);let at=0;const u=n=>{wkb.writeUInt32LE(n,at);at+=4;},head=t=>{wkb[at++]=1;u(t);};head(6);u(raw.length);for(const p of raw){head(3);u(p.length);for(const r of p){u(r.length);for(const [x,y]of r){wkb.writeDoubleLE(x,at);wkb.writeDoubleLE(y,at+8);at+=16;}}}if(!blob.subarray(40).equals(wkb)||hash(wkb)!==source.rawWkbSha256)reject('actual original WKB differs');
 // Adaptive orientation: uncertain floating determinants use exact binary64
 // dyadic integers. The normal-magnitude floor also prevents an underflowed
 // error bound from admitting the wrong sign. No epsilon or coordinate repair.
 const buf=Buffer.alloc(8),dyadic=n=>{buf.writeDoubleLE(n);const bits=buf.readBigUInt64LE(),exp=Number((bits>>52n)&2047n),mant=(bits&((1n<<52n)-1n))|(exp?1n<<52n:0n);return [(bits>>63n)?-mant:mant,exp?exp-1075:-1074];};
 let budget=0;
 const orient=(a,b,c)=>{if(++budget>50000000)reject('contact work bound exceeded; smaller batch required');const x=(b[0]-a[0])*(c[1]-a[1]),y=(b[1]-a[1])*(c[0]-a[0]),d=x-y,magnitude=Math.abs(x)+Math.abs(y);if(Number.isFinite(d)&&magnitude>=2**-900&&Math.abs(d)>magnitude*1e-14)return Math.sign(d);const ds=[...a,...b,...c].map(dyadic),e=Math.min(...ds.map(x=>x[1])),n=ds.map(([m,p])=>m<<BigInt(p-e)),v=(n[2]-n[0])*(n[5]-n[1])-(n[3]-n[1])*(n[4]-n[0]);return v>0n?1:v<0n?-1:0;};
 const overlap=(a,b)=>a[0]<=b[2]&&a[2]>=b[0]&&a[1]<=b[3]&&a[3]>=b[1],sb=(a,b)=>[Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[0],b[0]),Math.max(a[1],b[1])],on=(a,b,p)=>orient(a,b,p)===0&&overlap(sb(a,b),[p[0],p[1],p[0],p[1]]);
 function segment(a,b,c,d){if(++budget>50000000)reject('contact work bound exceeded; smaller batch required');if(!overlap(sb(a,b),sb(c,d)))return false;const x=orient(a,b,c),y=orient(a,b,d),z=orient(c,d,a),w=orient(c,d,b);return x*y<0&&z*w<0||x===0&&on(a,b,c)||y===0&&on(a,b,d)||z===0&&on(c,d,a)||w===0&&on(c,d,b);}
 function inRing(p,r){let winding=0;for(let i=1;i<r.length;i++){const a=r[i-1],b=r[i];if(on(a,b,p))return true;const o=orient(a,b,p);if(a[1]<=p[1]&&b[1]>p[1]&&o>0)winding++;else if(a[1]>p[1]&&b[1]<=p[1]&&o<0)winding--;}return winding!==0;}
 const inside=(p,poly)=>inRing(p,poly[0])&&!poly.slice(1).some(r=>inRing(p,r));
 function contact(a,b){for(const ar of a)for(const br of b)for(let i=1;i<ar.length;i++)for(let j=1;j<br.length;j++)if(segment(ar[i-1],ar[i],br[j-1],br[j]))return true;return inside(a[0][0],b)||inside(b[0][0],a);}
 const addedBounds=additions.map(p=>bounds([p]));
 for(let k=0;k<additions.length;k++){const r=additions[k][0],n=r.length-1;let noncollinear=false;for(let i=0;i<n;i++){const prev=r[(i+n-1)%n],a=r[i],b=r[(i+1)%n];if(eq(a,b)||orient(prev,a,b)===0&&(on(prev,a,b)||on(a,b,prev)))reject('degenerate or backtracking added ring');if(orient(prev,a,b)!==0)noncollinear=true;for(let j=i+1;j<n;j++)if(j!==i+1&&!(i===0&&j===n-1)&&segment(a,b,r[j],r[j+1]))reject('self-intersecting added ring');}if(!noncollinear)reject('degenerate added ring');for(let j=0;j<k;j++)if(overlap(addedBounds[k],addedBounds[j])&&contact(additions[k],additions[j]))reject('added components contact one another');}
 // Segment-range trees retain only small bounds/ranges, not cloned edges.
 // Reuse each current polygon's index across the bounded batch, then release it.
 function ringTree(r,lo=1,hi=r.length){if(hi-lo<=64){const box=[Infinity,Infinity,-Infinity,-Infinity];for(let i=lo-1;i<hi;i++){if(++budget>50000000)reject('contact work bound exceeded; smaller batch required');const [x,y]=r[i];box[0]=Math.min(box[0],x);box[1]=Math.min(box[1],y);box[2]=Math.max(box[2],x);box[3]=Math.max(box[3],y);}return {box,lo,hi};}const mid=(lo+hi)>>1,left=ringTree(r,lo,mid),right=ringTree(r,mid,hi),a=left.box,b=right.box;return {box:[Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[2],b[2]),Math.max(a[3],b[3])],left,right};}
 function query(tree,box,visit){if(!overlap(tree.box,box))return false;if(tree.left)return query(tree.left,box,visit)||query(tree.right,box,visit);for(let i=tree.lo;i<tree.hi;i++)if(visit(i))return true;return false;}
 function indexedInside(point,r,tree){let winding=0,boundary=false;query(tree,[point[0],point[1],Infinity,point[1]],i=>{const a=r[i-1],b=r[i];if(on(a,b,point)){boundary=true;return true;}const o=orient(a,b,point);if(a[1]<=point[1]&&b[1]>point[1]&&o>0)winding++;else if(a[1]>point[1]&&b[1]<=point[1]&&o<0)winding--;return false;});return boundary||winding!==0;}
 function screen(ps){for(const p of ps){const box=bounds([p]),hits=additions.map((_,i)=>i).filter(i=>overlap(addedBounds[i],box));if(!hits.length)continue;const trees=p.map(r=>ringTree(r));for(const i of hits){const a=additions[i];for(let k=0;k<p.length;k++)if(query(trees[k],addedBounds[i],j=>{const r=p[k];for(const ar of a)for(let n=1;n<ar.length;n++)if(segment(ar[n-1],ar[n],r[j-1],r[j]))return true;return false;}))reject('added component contacts current geometry');const point=a[0][0];if(indexedInside(point,p[0],trees[0])&&!p.slice(1).some((r,k)=>indexedInside(point,r,trees[k+1]))||inside(p[0][0],a))reject('added component contacts current geometry');}}}
 screen(before);
 if(typeof getSourceSnapshot!=='function')reject('authoritative snapshot required');const snapshot=getSourceSnapshot(),universe=archivedReview(scope.currentUniverse);
 if(!snapshot||!/^[a-f0-9]{40}$/.test(snapshot.archiveRevision||'')||!/^[a-f0-9]{40}$/.test(snapshot.sourcePin||'')||snapshot.sourcePin!==scope.revision||universe.revision!==snapshot.sourcePin||universe.schemaVersion!==1||!Array.isArray(snapshot.countryDescriptorPaths)||!Array.isArray(universe.countries))reject('current authoritative source revision required');
 const paths=snapshot.countryDescriptorPaths,rows=new Map(universe.countries.map(c=>[c.path,c]));if(new Set(paths).size!==paths.length||rows.size!==universe.countries.length||!eq([...paths].sort(),[...rows.keys()].sort()))reject('authoritative census membership mismatch');
 const resources=new Map();for(const p of paths){if(!/^assets\/data\/territorial-entities\/source\/countries\/[\w-]+\.json$/.test(p))reject('invalid authoritative country path');const bytes=readEvidence(p),d=JSON.parse(bytes),row=rows.get(p);if(hash(bytes)!==row.sha256||p!==base+'countries/'+d.entityId.replace(':','-')+'.json'||!Array.isArray(d.geometryVersions)||new Set(d.geometryVersions.map(v=>v.versionId)).size!==d.geometryVersions.length||!eq(row.versions,d.geometryVersions.map(v=>({versionId:v.versionId,validFrom:v.validFrom,validTo:v.validTo,resourceSha256:v.geometryResource?.sha256}))))reject('actual descriptor/version census mismatch');for(const v of d.geometryVersions.filter(v=>v.validTo===null)){const r=v.geometryResource;if(!r||!requiredHash(r.sha256)||r.file!=='geometries/sha256-'+r.sha256+'.json')reject('invalid current resource reference');if(resources.has(r.sha256)){if(resources.get(r.sha256)!==r.bytes)reject('shared current resource byte count mismatch');continue;}const payload=readEvidence(base+r.file);if(!Buffer.isBuffer(payload)||payload.length!==r.bytes||hash(payload)!==r.sha256)reject('actual current resource mismatch');screen(polygons(JSON.parse(payload)));resources.set(r.sha256,payload.length);}}
 if(s.geometrySha256!==digest(v.geometry)||next.sourceInfo?.geometryVersionId!==v.versionId||next.sourceInfo?.geometrySha256!==digest(v.geometry)||review.sourceInfoGeometryDigestFormat!=='sha256(JSON.stringify([geometry.type, geometry.coordinates]))')reject('partial current geometry attribution mismatch');
 return 1;
}

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
export function assertHistoricalSourceStorageChanges(next,previous,{prefixes,readEvidence,getSourceSnapshot}={}){
 const appendMarked=v=>v?.modernBoundarySupplement&&(Object.hasOwn(v.modernBoundarySupplement,'detachedComponentAppend')||Object.hasOwn(v.modernBoundarySupplement,'initialPreparedAppend')||v.modernBoundarySupplement.adoptionMode==='lossless-original-detached-component-append');
 if(next.geometryVersions?.some(v=>appendMarked(v)&&!v.modernBoundarySupplement.sourceAdoptionReview))throw Error('Raw source adoption: detached-component append: initial append receipt is required');
 if(next.geometryVersions?.some(appendMarked)&&previous&&next.geometryVersions.length===previous.geometryVersions?.length&&next.geometryVersions.every((v,i)=>v.versionId===previous.geometryVersions[i].versionId&&digest(v.geometry)===digest(previous.geometryVersions[i].geometry))&&!isDeepStrictEqual(next,previous))throw Error('Raw source adoption: detached-component append: unchanged geometry cannot acquire or alter append attribution');
 if(previous?.geometryVersions?.some(appendMarked)){
  const reject=m=>{throw Error('Raw source adoption: detached-component append: '+m);};
  if(!Array.isArray(next.geometryVersions)||!isDeepStrictEqual(next.geometryVersions.map(v=>v.versionId),previous.geometryVersions.map(v=>v.versionId)))reject('admitted version inventory cannot change');
  for(const old of previous.geometryVersions.filter(appendMarked)){const v=next.geometryVersions.find(v=>v.versionId===old.versionId);if(!isDeepStrictEqual(v.modernBoundarySupplement?.detachedComponentAppend,old.modernBoundarySupplement.detachedComponentAppend)||v.modernBoundarySupplement?.adoptionMode!=='lossless-original-detached-component-append'||!v.modernBoundarySupplement?.sourceAdoptionReview)reject('admitted append marker/method/receipt cannot be removed');}
  if(next.geometryVersions.every((v,i)=>digest(v.geometry)===digest(previous.geometryVersions[i].geometry))&&!isDeepStrictEqual(next,previous))reject('unchanged geometry requires exact admitted metadata');
 }
 const versions=next.geometryVersions||[];
 if(previous?.geometryVersions?.some(v=>v.modernBoundarySupplement&&Object.hasOwn(v.modernBoundarySupplement,'wholeFeatureCompletion'))&&(!Array.isArray(next.geometryVersions)||!isDeepStrictEqual(next.geometryVersions.map(v=>v.versionId),previous.geometryVersions.map(v=>v.versionId))))throw Error('Raw source adoption: whole-feature completion: completed version inventory cannot change');
 for(const v of versions){
  const old=previous?.geometryVersions?.find(p=>p.versionId===v.versionId),s=v.modernBoundarySupplement,prior=old?.modernBoundarySupplement,marked=!!s&&Object.hasOwn(s,'wholeFeatureCompletion')||!!prior&&Object.hasOwn(prior,'wholeFeatureCompletion');
  if(prior?.wholeCountryRaw===false&&s?.wholeCountryRaw===true&&(!s?.sourceAdoptionReview||!Object.hasOwn(s,'wholeFeatureCompletion')))throw Error('Raw source adoption: whole-feature completion: explicit completion receipt required');
  if(marked&&!s?.sourceAdoptionReview)throw Error('Raw source adoption: whole-feature completion: completion receipt cannot be removed');
  if(old&&digest(old.geometry)===digest(v.geometry)&&((marked&&!isDeepStrictEqual(s,prior))||(prior&&Object.hasOwn(prior,'wholeCountryRaw')&&!isDeepStrictEqual(s?.wholeCountryRaw,prior.wholeCountryRaw))))throw Error('Raw source adoption: whole-feature completion: unchanged geometry cannot alter completion attribution');
 }

 for(const v of versions){const old=previous?.geometryVersions?.find(p=>p.versionId===v.versionId);if(old&&['lossless-original-shared-arc','lossless-original-current-version-shared-arc','lossless-original-existing-component'].includes(v.modernBoundarySupplement?.adoptionMode)&&digest(old.geometry)===digest(v.geometry)&&!isDeepStrictEqual(v.modernBoundarySupplement.sourceAdoptionReview,old.modernBoundarySupplement?.sourceAdoptionReview))throw Error('Raw source adoption: unchanged shared arc cannot acquire a new receipt');}
 if(previous&&next.entityId===previous.entityId&&versions.length===previous.geometryVersions?.length&&versions.every(v=>{const old=previous.geometryVersions.find(p=>p.versionId===v.versionId);return old&&digest(old.geometry)===digest(v.geometry);})){
  // A changed review is a new evidentiary claim, not a display-name edit.
  // Keep ordinary unchanged receipts lazy, but resolve new claims before fastpath.
  for(const v of versions){const old=previous.geometryVersions.find(p=>p.versionId===v.versionId),r=v.modernBoundarySupplement?.sourceAdoptionReview;if(r&&!isDeepStrictEqual(r,old.modernBoundarySupplement?.sourceAdoptionReview)){
   if(!evidence(r)||!/^reports\/(?:[\w.-]+\/)*[\w.-]+\.json$/.test(r.reference)||r.reference.split('/').includes('..')||typeof readEvidence!=='function')throw Error('Raw source adoption: changed unchanged-geometry receipt requires archived evidence');
   const bytes=readEvidence(r.reference);if(!Buffer.isBuffer(bytes)||createHash('sha256').update(bytes).digest('hex')!==r.sha256)throw Error('Raw source adoption: changed unchanged-geometry receipt is not archived');
   const claim=JSON.parse(bytes);if(claim.method==='lossless-original-detached-component-append'||claim.detachedAppendScope!==undefined||claim.detachedComponentAppend!==undefined||claim.initialPreparedAppend!==undefined)throw Error('Raw source adoption: detached-component append: unchanged geometry cannot acquire append receipt');
  }}
  // Completion evidence binds every field except ordinary display names.
  // Unchanged coordinates must not become an ownership/date/provenance or
  // source-hash escape hatch after a successful completion.
  if([...versions,...previous.geometryVersions].some(v=>v.modernBoundarySupplement&&Object.hasOwn(v.modernBoundarySupplement,'wholeFeatureCompletion'))){
   const immutable=e=>{const copy=structuredClone(e);delete copy.names;return copy;};
   if(!isDeepStrictEqual(immutable(next),immutable(previous)))throw Error('Raw source adoption: whole-feature completion: unchanged geometry permits names-only metadata edits');
  }
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
 const deferredWholeCompletion=old.modernBoundarySupplement?.wholeCountryRaw===false&&v.modernBoundarySupplement.wholeCountryRaw===true&&Object.hasOwn(v.modernBoundarySupplement,'wholeFeatureCompletion');
 for(const [key,value] of Object.entries(old.modernBoundarySupplement||{}))if(!(key==='wholeCountryRaw'&&deferredWholeCompletion)&&!replacedAttribution.has(key)&&!isDeepStrictEqual(v.modernBoundarySupplement[key],value))fail('source caveat changed: '+key);
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
 if(deferredWholeCompletion||Object.hasOwn(v.modernBoundarySupplement,'wholeFeatureCompletion')||Object.hasOwn(review,'wholeFeatureCompletion')){
  if(v.modernBoundarySupplement.wholeFeatureCompletion?.method==='restore-omitted-original-components')assertOmittedOriginalRestoration(next,previous,review,{prefixes,archivedReview,readEvidence,getSourceSnapshot,fail});
  else assertWholeFeatureCompletion(next,previous,review,{prefixes,archivedReview,fail});
 }
 if(review.method==='lossless-original-detached-component-append')return assertDetachedComponentAppend(next,previous,review,{prefixes,archivedReview,readEvidence,getSourceSnapshot,fail});
 if(review.detachedAppendScope!==undefined||review.initialPreparedAppend!==undefined||v.modernBoundarySupplement.initialPreparedAppend!==undefined||v.modernBoundarySupplement.detachedComponentAppend!==undefined||v.modernBoundarySupplement.adoptionMode==='lossless-original-detached-component-append')fail('detached append cannot claim another method');
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
