import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
import {createGeometryVersionStore} from '../../src/geometry/geometry-version-store.js';
import {normalizeTerritorialLibraryEntity} from '../gis/territorial-library.js';
import {assertHistoricalSourceStorageChanges} from '../gis/historical-display-review.mjs';
import {encodeTerritorialSource,decodeTerritorialSource} from './territorial-source-codec.mjs';
import {entityFileName,writeTerritorialSource} from './territorial-entity-sources.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const digest=g=>hash(JSON.stringify([g.type,g.coordinates]));
const fail=message=>{throw Error('Original authoring source: '+message);};
const sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const base='assets/data/territorial-entities/source/';
const maxLongitude=180+4*2**-45; // Four binary64 ULP at the longitude boundary.
const admitted=new WeakSet(); // Never the generic/project/canonical admission sets.
const markers=['originalAuthoringReview','sourceAdoptionReview'];
const freeze=value=>{if(value&&typeof value==='object'){for(const v of Object.values(value))freeze(v);Object.freeze(value);}return value;};
function archived(ref,readEvidence){
 if(!ref||typeof ref.reference!=='string'||!/^reports\/(?:[\w.-]+\/)*[\w.-]+\.json$/.test(ref.reference)||ref.reference.split('/').includes('..')||!sha(ref.sha256)||typeof readEvidence!=='function')fail('archived receipt required');
 const bytes=readEvidence(ref.reference);if(!Buffer.isBuffer(bytes)||hash(bytes)!==ref.sha256)fail('missing or corrupt archive evidence');
 try{return JSON.parse(bytes);}catch{fail('invalid evidence JSON');}
}
export function originalAuthoringDescriptorDigest(entity){
 const copy=structuredClone(entity);for(const v of copy.geometryVersions||[])for(const key of markers)if(v.modernBoundarySupplement)delete v.modernBoundarySupplement[key];
 return hash(JSON.stringify(encodeTerritorialSource(copy).descriptor));
}
export function originalAuthoringPreservedDigest(entity){
 const copy=structuredClone(entity);for(const key of ['sourceId','title','geometrySha256','geometryVersionId'])if(copy.sourceInfo)delete copy.sourceInfo[key];
 for(const v of copy.geometryVersions||[])for(const key of ['geometry','sourceId','modernBoundarySupplement'])delete v[key];
 return hash(JSON.stringify(copy));
}
/** Deterministic binary64 WKB, not geometric normalization. */
export function originalAuthoringWkb(geometry){
 const chunks=[],u32=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);chunks.push(b);},header=type=>{chunks.push(Buffer.from([1]));u32(type);};
 function polygon(rings){header(3);u32(rings.length);for(const ring of rings){u32(ring.length);for(const point of ring){const b=Buffer.alloc(16);b.writeDoubleLE(point[0],0);b.writeDoubleLE(point[1],8);chunks.push(b);}}}
 if(geometry.type==='Polygon')polygon(geometry.coordinates);else if(geometry.type==='MultiPolygon'){header(6);u32(geometry.coordinates.length);for(const p of geometry.coordinates)polygon(p);}else fail('original Polygon/MultiPolygon required');
 return Buffer.concat(chunks);
}
function originalGeometry(source){
 if(source?.schemaVersion!==1||source.method!=='exact-gpkg-original-feature'||typeof source.featureId!=='string'||!source.featureId||!sha(source.rawBlobSha256)||!sha(source.rawWkbSha256)||typeof source.rawBlobBase64!=='string'||!/^[A-Za-z0-9+/]+={0,2}$/.test(source.rawBlobBase64))fail('original feature extraction required');
 const blob=Buffer.from(source.rawBlobBase64,'base64');if(blob.length<13||blob.length>64*1024*1024||blob.toString('base64')!==source.rawBlobBase64||hash(blob)!==source.rawBlobSha256||blob[0]!==71||blob[1]!==80||blob[2]!==0||(blob[3]&0xf0)!==0)fail('invalid original GeoPackage blob');
 const envelope=(blob[3]>>1)&7;if(envelope>4)fail('unsupported GeoPackage envelope');
 const srs=blob[3]&1?blob.readInt32LE(4):blob.readInt32BE(4);if(srs!==4326)fail('original EPSG:4326 required');
 const wkb=blob.subarray(8+[0,4,6,6,8][envelope]*8);if(hash(wkb)!==source.rawWkbSha256)fail('original WKB hash mismatch');let offset=0;
 const need=n=>{if(offset+n>wkb.length)fail('truncated original WKB');};
 const count=le=>{need(4);const n=le?wkb.readUInt32LE(offset):wkb.readUInt32BE(offset);offset+=4;return n;};
 function read(expected){need(1);const byte=wkb[offset++];if(byte!==0&&byte!==1)fail('invalid WKB byte order');const le=byte===1,type=count(le);if(expected&&type!==expected)fail('invalid nested WKB type');
  if(type===3){const n=count(le),coordinates=[];if(!n||n>(wkb.length-offset)/4)fail('invalid WKB ring count');for(let i=0;i<n;i++){const points=count(le);if(points<4||points>(wkb.length-offset)/16)fail('invalid WKB coordinate count');const ring=[];for(let j=0;j<points;j++){need(16);ring.push([le?wkb.readDoubleLE(offset):wkb.readDoubleBE(offset),le?wkb.readDoubleLE(offset+8):wkb.readDoubleBE(offset+8)]);offset+=16;}coordinates.push(ring);}return {type:'Polygon',coordinates};}
  if(type===6&&!expected){const n=count(le),coordinates=[];if(!n||n>(wkb.length-offset)/9)fail('invalid WKB polygon count');for(let i=0;i<n;i++)coordinates.push(read(3).coordinates);return {type:'MultiPolygon',coordinates};}fail('original two-dimensional polygon WKB required');
 }
 const geometry=read();if(offset!==wkb.length)fail('trailing original WKB bytes');return {geometry,wkb};
}
function structuralOriginal(geometry,certificate){
 if(!geometry||Object.keys(geometry).length!==2||!Object.hasOwn(geometry,'type')||!Object.hasOwn(geometry,'coordinates')||!['Polygon','MultiPolygon'].includes(geometry.type))fail('exact polygon geometry fields required');
 const polygons=geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;if(!Array.isArray(polygons)||!polygons.length)fail('empty polygons');const exceptions=[];let count=0;
 for(let pi=0;pi<polygons.length;pi++){const rings=polygons[pi];if(!Array.isArray(rings)||!rings.length)fail('empty polygon');for(let ri=0;ri<rings.length;ri++){const ring=rings[ri];if(!Array.isArray(ring)||ring.length<4)fail('short ring');let area=0;
  for(let i=0;i<ring.length;i++){const p=ring[i];if(!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)||Math.abs(p[0])>maxLongitude||Math.abs(p[1])>90)fail('coordinate outside original numerical envelope');count++;if(Math.abs(p[0])>180)exceptions.push({polygonIndex:pi,ringIndex:ri,pointIndex:i,longitude:p[0],latitude:p[1]});}
  if(!equal(ring[0],ring.at(-1)))fail('open original ring');for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length];area+=a[0]*b[1]-b[0]*a[1];}if(!Number.isFinite(area)||Math.abs(area)<1e-14)fail('degenerate original ring');
 }}
 if(!exceptions.length||!equal(exceptions,certificate.exceptions)||certificate.componentCount!==polygons.length||certificate.coordinateCount!==count)fail('exact original exception and component inventory required');
 const copy=freeze(structuredClone(geometry));admitted.add(copy);return copy;
}
/** Explicit authoring owner. The default source reader and all derived ingress
 * remain strict. Even already-frozen authoring values must recheck evidence. */
export function normalizeOriginalAuthoringSource(entity,{readEvidence}={}){
 if(entity?.geometryVersions?.length!==1||entity.entityKind!=='general')fail('one current territorial source required');const v=entity.geometryVersions[0],supplement=v.modernBoundarySupplement,marker=supplement?.originalAuthoringReview;
 if(v.validFrom!==null||v.validTo!==null||!equal(marker,supplement?.sourceAdoptionReview))fail('undated source and paired admission marker required');const review=archived(marker,readEvidence),cert=review.originalAuthoring;
 if(review.schemaVersion!==1||review.status!=='raw-source-only-not-display-approved'||review.method!=='lossless-original-feature'||review.rawCoordinateRoundtrip!==true||review.entityId!==entity.entityId||review.versionId!==v.versionId||review.validFrom!==null||review.validTo!==null||review.geometrySha256!==digest(v.geometry)||!sha(review.previousGeometrySha256))fail('stale source admission identity/geometry');
 const topology=review.topology;if(topology?.status!=='passed'||!Array.isArray(topology.checks)||['validity','shared-boundary','gaps-overlaps','holes-islands','ownership'].some(c=>!topology.checks.includes(c))||!Array.isArray(topology.counterpartVersions)||!topology.counterpartVersions.every(c=>typeof c.entityId==='string'&&typeof c.versionId==='string'&&sha(c.geometrySha256))||(!topology.counterpartVersions.length&&!(typeof topology.noSharedBoundaryReason==='string'&&topology.noSharedBoundaryReason.trim())))fail('source-only ownership/topology review required');
 if(cert?.schemaVersion!==1||cert.method!=='exact-original-longitude-boundary-4ulp'||cert.descriptorDigestFormat!=='sha256(JSON.stringify(encoded-descriptor-without-admission-markers))'||cert.descriptorSha256!==originalAuthoringDescriptorDigest(entity)||cert.preservedMetadataSha256!==originalAuthoringPreservedDigest(entity))fail('stale descriptor or preserved metadata certificate');
 if(supplement.adoptionMode!=='lossless-original-feature'||supplement.status!=='raw-source-only-not-display-approved'||supplement.geometrySha256!==review.geometrySha256||entity.sourceInfo?.geometrySha256!==review.geometrySha256||entity.sourceInfo?.geometryVersionId!==v.versionId)fail('explicit source-only attribution required');
 const encoded=encodeTerritorialSource(entity),resource=encoded.descriptor.geometryVersions[0].geometryResource;if(cert.geometryResourceSha256!==resource.sha256||cert.geometryResourceBytes!==resource.bytes)fail('stale coordinate resource certificate');
 if(!equal(decodeTerritorialSource(encoded.descriptor,p=>encoded.geometries.get(p)),entity))fail('lossless source codec roundtrip required');
 const original=archived(review.source,readEvidence);if(cert.originalFeatureId!==original.featureId||cert.rawBlobSha256!==original.rawBlobSha256||cert.rawWkbSha256!==original.rawWkbSha256)fail('stale original feature identity');const extracted=originalGeometry(original);if(!equal(extracted.geometry,v.geometry))fail('candidate differs from original feature WKB');
 const normalized=normalizeTerritorialLibraryEntity(entity,{normalizeVersionGeometry:version=>({geometry:structuralOriginal(version.geometry,cert)})});if(!equal(normalized,entity))fail('source metadata normalization changed');return normalized;
}
/** Revalidated by the archive store as well as the explicit writer. */
export function assertOriginalAuthoringSourceStorageChanges(next,previous,{prefixes,readEvidence}={}){
 if(!next.geometryVersions?.some(v=>v.modernBoundarySupplement?.originalAuthoringReview)){for(const v of next.geometryVersions||[])createGeometryVersionStore([{id:v.versionId,version:1,geojson:v.geometry}]);return 0;}
 const normalized=normalizeOriginalAuthoringSource(next,{readEvidence}),v=normalized.geometryVersions[0],review=archived(v.modernBoundarySupplement.originalAuthoringReview,readEvidence);
 if(!previous||previous.geometryVersions?.length!==1||review.previousGeometrySha256!==digest(previous.geometryVersions[0].geometry)||review.originalAuthoring.preservedMetadataSha256!==originalAuthoringPreservedDigest(previous)||!equal(v.modernBoundarySupplement.priorPreparedAttribution,previous.geometryVersions[0].modernBoundarySupplement))fail('source preimage or metadata changed');
 const resource=encodeTerritorialSource(normalized).descriptor.geometryVersions[0].geometryResource,exact=[base+'countries/'+entityFileName(next.entityId),base+resource.file];if(!Array.isArray(prefixes)||prefixes.length!==2||!equal([...prefixes].sort(),exact.sort()))fail('exact descriptor and original resource scope required');
 assertHistoricalSourceStorageChanges(normalized,previous,{prefixes,readEvidence});return 1;
}
function decode(entityId,root){const file=path.join(root,'countries',entityFileName(entityId)),descriptor=JSON.parse(fs.readFileSync(file));if(descriptor.entityId!==entityId)fail('filename identity mismatch');return decodeTerritorialSource(descriptor,p=>fs.readFileSync(path.join(root,p)));}
export function readOriginalAuthoringSource(entityId,root,options){return normalizeOriginalAuthoringSource(decode(entityId,root),options);}
export function writeOriginalAuthoringSource(entity,root,options){const previous=decode(entity.entityId,root);assertOriginalAuthoringSourceStorageChanges(entity,previous,options);const result=writeTerritorialSource(entity,root);if(!equal(readOriginalAuthoringSource(entity.entityId,root,options),entity))fail('authoring readback mismatch');return result;}

/** CAS validation does not admit a geometry as a domain entity. Unreferenced
 * original blobs may be archived; a descriptor linking them still needs the
 * numerical/domain gate above. Existing resource bytes can never be replaced. */
export function assertTerritorialSourceResourceBytes(logicalPath,bytes){
 const match=/^assets\/data\/territorial-entities\/source\/geometries\/sha256-([a-f0-9]{64})\.json$/.exec(logicalPath);
 if(!match||!Buffer.isBuffer(bytes)||hash(bytes)!==match[1])fail('source resource filename/content hash mismatch');
}
