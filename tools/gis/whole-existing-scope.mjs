import {decodeOriginalBlobGeometry} from '../data/chunked-original-source.mjs';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual as eq} from 'node:util';
import {jsonByteChunks} from '../data/buffer-json.mjs';
const digest=g=>{const h=createHash('sha256');for(const b of jsonByteChunks([g.type,g.coordinates]))h.update(b);return h.digest('hex');};
export const approvedScopeDonorSha256='da1fbbf46e7a1e4cf41ec891133cf150f59e8a5f36c0fd990d1ed7c29d51956e';
export const preparedScopeGpkgSha256='903802ac3af29e071a608f27a3c1ca67372d38dba2125f8325b9569f454f519d';
const fail=m=>{throw Error('Whole original batch: existing scope '+m);};
// Linear-time minimum cyclic rotation. Only comparison serialization changes;
// Comparison ignores consecutive identical points only. No output coordinates,
// precision, distinct collinear vertices, polygons or holes are removed.
function rotation(a){const n=a.length;let i=0,j=1,k=0;while(i<n&&j<n&&k<n){const x=a[(i+k)%n],y=a[(j+k)%n];if(x===y){k++;continue;}if(x>y){i+=k+1;if(i===j)i++;}else{j+=k+1;if(i===j)j++;}k=0;}const start=Math.min(i,j);return a.slice(start).concat(a.slice(0,start));}
function canonicalRing(r){if(!Array.isArray(r)||r.length<4||!eq(r[0],r.at(-1)))fail('closed geometry rings required');const a=r.slice(0,-1).map(p=>{if(!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)||Math.abs(p[0])>180||Math.abs(p[1])>90)fail('bounded original coordinates required');return JSON.stringify(p);});const clean=[];for(const p of a)if(p!==clean.at(-1))clean.push(p);while(clean.length>1&&clean.at(-1)===clean[0])clean.pop();if(clean.length<3)fail('nondegenerate comparison ring required');const forward=rotation(clean).join(';'),reverse=rotation([...clean].reverse()).join(';');return forward<reverse?forward:reverse;}
export function normalizedWholeScope(g){const ps=g?.type==='Polygon'?[g.coordinates]:g?.type==='MultiPolygon'?g.coordinates:null;if(!Array.isArray(ps)||!ps.length)fail('complete polygon scope required');return ps.map(p=>{if(!Array.isArray(p)||!p.length)fail('nonempty polygon required');const rings=[canonicalRing(p[0]),...p.slice(1).map(canonicalRing).sort()];return createHash('sha256').update(JSON.stringify(rings)).digest('hex');}).sort();}
/** Mandatory proof of the already-approved WHOLE territorial scope, distinct
 * from raw UUID and coordinate provenance. Omission or carve-out is fatal.
 * Conservative exact normalized equality may reject topologically equivalent
 * differently segmented inputs; never replace it with area epsilon alone.
 */
export function assertExistingWholeScope({review,source,previous,version,descriptor,archived}){
 const proof=archived(review.existingScope),stored=descriptor.geometryVersions.find(x=>x.versionId===version.versionId),code=previous.entityId.slice(6);
 if(proof.schemaVersion!==1||proof.method!=='existing-approved-single-feature-scope'||proof.normalization!=='exact-coordinate-rings; rotation-direction-order; consecutive-identical-only'||proof.entityId!==previous.entityId||proof.versionId!==version.versionId||proof.validFrom!==version.validFrom||proof.validTo!==null||proof.previousDescriptorSha256!==review.previousDescriptorSha256||proof.previousGeometryResourceSha256!==stored?.geometryResource?.sha256||proof.approvedDonorSha256!==approvedScopeDonorSha256||proof.preparedGpkgSha256!==preparedScopeGpkgSha256||proof.preparedFeatureId!==source.featureId||proof.equals!==true||proof.donorMinusPreparedEmpty!==true||proof.preparedMinusDonorEmpty!==true||proof.donorMinusPreparedArea!==0||proof.preparedMinusDonorArea!==0||proof.donorValid!==true||proof.preparedValid!==true)fail('fixed preimage and bidirectional equality proof required');
 const donor=archived(proof.approvedDonorFeature),prepared=archived(proof.preparedFeature);
 if(donor.schemaVersion!==1||donor.method!=='approved-current-donor-feature'||donor.sourceFileSha256!==approvedScopeDonorSha256||donor.featureId!==code||prepared.schemaVersion!==1||prepared.method!=='prepared-original-whole-feature'||prepared.sourceFileSha256!==preparedScopeGpkgSha256||prepared.featureId!==source.featureId)fail('official donor and complete corresponding prepared feature required');
 for(const k of ['WP_ID','WP_PAR_ID','GENC_3','US_Recog','Map_Disp','Show_Disp'])if(!Object.hasOwn(prepared.properties||{},k)||!Object.hasOwn(source.properties||{},k)||!eq(prepared.properties[k],source.properties[k]))fail('prepared/raw feature identity mismatch');
 if(typeof prepared.rawBlobBase64!=='string'||prepared.rawBlobBase64.length>360*1024*1024)fail('complete prepared original blob required');const pb=Buffer.from(prepared.rawBlobBase64,'base64'),phash=createHash('sha256').update(pb).digest('hex');if(pb.toString('base64')!==prepared.rawBlobBase64||phash!==prepared.rawBlobSha256||proof.preparedRawBlobSha256!==phash||proof.preparedRawWkbSha256!==prepared.rawWkbSha256||!eq(decodeOriginalBlobGeometry(pb,{expectedWkbSha256:prepared.rawWkbSha256}),prepared.geometry))fail('prepared whole feature WKB mismatch');
 const dh=digest(donor.geometry),ph=digest(prepared.geometry);if(donor.geometrySha256!==dh||prepared.geometrySha256!==ph||proof.approvedDonorGeometrySha256!==dh||proof.preparedGeometrySha256!==ph)fail('geometry provenance digest mismatch');
 let cursor=version.modernBoundarySupplement,roots=[],depth=0;while(cursor){if(++depth>64)fail('bounded prior attribution required');if(cursor.status==='approved-prepared-current-source-adoption')roots.push(cursor);cursor=cursor.priorPreparedAttribution;}
 if(roots.length!==1||roots[0].sourceFileSha256!==approvedScopeDonorSha256||roots[0].upstream?.recordedSourceFileSha256!==preparedScopeGpkgSha256||roots[0].geometryDigestFormat!=='sha256(JSON.stringify([geometry.type, geometry.coordinates]))'||roots[0].geometrySha256!==dh)fail('actual prior approved donor anchor required');
 if(!eq(normalizedWholeScope(donor.geometry),normalizedWholeScope(prepared.geometry)))fail('donor differs from full prepared original: additions or carve-outs require a dedicated contract');
 return 1;
}
