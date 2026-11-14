// Explicit local integration: PANDO_ATA_REVIEW_DIR points to preserved antarctic-review-22.
// No downloads, production source writes, pins, or commits. Only OS temporary fixture data.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {encodeTerritorialSource,decodeTerritorialSource} from '../../../tools/data/territorial-source-codec.mjs';
import {readTerritorialSource,writeTerritorialSource} from '../../../tools/data/territorial-entity-sources.mjs';
import {createGeometryVersionStore,createCanonicalGeometryVersionStore,geometryReferenceFor} from '../../../src/geometry/geometry-version-store.js';
import {normalizeOriginalAuthoringSource,readOriginalAuthoringSource,writeOriginalAuthoringSource,originalAuthoringDescriptorDigest,originalAuthoringPreservedDigest,originalAuthoringWkb} from '../../../tools/data/territorial-original-authoring.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex'),json=x=>Buffer.from(JSON.stringify(x)+'\n'),digest=g=>hash(JSON.stringify([g.type,g.coordinates]));
export function actualFixture(directory){
 const read=n=>JSON.parse(fs.readFileSync(join(directory,n))),proof=read('ATA-raw-proof.json'),rawBytes=fs.readFileSync(join(directory,'ATA-raw-candidate.geojson'));
 assert.equal(hash(rawBytes),proof.candidateSha256);const geometry=JSON.parse(rawBytes).geometry;assert.equal(digest(geometry),proof.candidateGeometryDigest);
 const previous=decodeTerritorialSource(read('source-metadata.json').rows[0].descriptor,()=>fs.readFileSync(join(directory,'ATA-current-geometry-0.json')));
 const next=decodeTerritorialSource(read('ATA-existing-source-candidate.json'),()=>json(geometry)),v=next.geometryVersions[0];
 v.modernBoundarySupplement.status='raw-source-only-not-display-approved';
 const python=process.env.PANDO_PYTHON||'python';
 const blob=execFileSync(python,['-c',`import sqlite3,sys\nfrom pathlib import Path\nc=sqlite3.connect(Path(sys.argv[1]).resolve().as_uri()+'?mode=ro',uri=True)\nr=c.execute('SELECT geom FROM DoS_WP_11_4 WHERE WP_ID=?',(sys.argv[2],)).fetchall()\nassert len(r)==1\nsys.stdout.buffer.write(r[0][0])`,proof.sourceFile,proof.sourceWP_IDs[0]],{maxBuffer:4*1024*1024});
 assert.equal(hash(blob),proof.rawBlobSha256);const wkb=originalAuthoringWkb(geometry);assert.equal(hash(wkb),proof.rawWkbSha256);assert.deepEqual(wkb,blob.subarray(40));
 const source={schemaVersion:1,method:'exact-gpkg-original-feature',featureId:proof.sourceWP_IDs[0],rawBlobSha256:hash(blob),rawWkbSha256:hash(wkb),rawBlobBase64:blob.toString('base64')};
 const sourceBytes=json(source),sourcePath='reports/borders/validation/ata-local-original.json',receiptPath='reports/borders/validation/ata-local-admission.json',resource=encodeTerritorialSource(next).descriptor.geometryVersions[0].geometryResource;
 const exceptions=[];let count=0;geometry.coordinates.forEach((rings,polygonIndex)=>rings.forEach((ring,ringIndex)=>ring.forEach(([longitude,latitude],pointIndex)=>{count++;if(Math.abs(longitude)>180)exceptions.push({polygonIndex,ringIndex,pointIndex,longitude,latitude});})));
 assert.equal(count,24291);assert.equal(geometry.coordinates.length,184);assert.equal(exceptions.length,14);assert(exceptions.every((x,i)=>x.polygonIndex===116&&x.ringIndex===0&&x.pointIndex===11303+i&&x.longitude===180.0000000000001));
 const receipt={schemaVersion:1,status:'raw-source-only-not-display-approved',method:'lossless-original-feature',entityId:next.entityId,versionId:v.versionId,validFrom:null,validTo:null,previousGeometrySha256:digest(previous.geometryVersions[0].geometry),geometrySha256:digest(geometry),rawCoordinateRoundtrip:true,source:{reference:sourcePath,sha256:hash(sourceBytes)},topology:{status:'passed',checks:['validity','shared-boundary','gaps-overlaps','holes-islands','ownership'],counterpartVersions:[],noSharedBoundaryReason:'Local integration fixture only. Preserved ATA proof records all 184 old component scopes matched, no claimant allocation, no neighboring shared boundary.'},originalAuthoring:{schemaVersion:1,method:'exact-original-longitude-boundary-4ulp',descriptorDigestFormat:'sha256(JSON.stringify(encoded-descriptor-without-admission-markers))',descriptorSha256:originalAuthoringDescriptorDigest(next),preservedMetadataSha256:originalAuthoringPreservedDigest(previous),geometryResourceSha256:resource.sha256,geometryResourceBytes:resource.bytes,originalFeatureId:source.featureId,rawBlobSha256:source.rawBlobSha256,rawWkbSha256:source.rawWkbSha256,componentCount:184,coordinateCount:count,exceptions}};
 const receiptBytes=json(receipt),marker={reference:receiptPath,sha256:hash(receiptBytes)};v.modernBoundarySupplement.sourceAdoptionReview=marker;v.modernBoundarySupplement.originalAuthoringReview=marker;
 const evidence=new Map([[sourcePath,sourceBytes],[receiptPath,receiptBytes]]),prefixes=['assets/data/territorial-entities/source/countries/state-ATA.json','assets/data/territorial-entities/source/'+resource.file];
 return {previous,next,evidence,prefixes,receipt,readEvidence:p=>evidence.get(p),wkb};
}
test('actual archived ATA binary64 and WKB survive explicit source owner only',{skip:!process.env.PANDO_ATA_REVIEW_DIR},t=>{
 const f=actualFixture(process.env.PANDO_ATA_REVIEW_DIR),root=fs.mkdtempSync(join(tmpdir(),'pando-ata-local-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const n=normalizeOriginalAuthoringSource(f.next,f);assert.deepEqual(n,f.next);assert.equal(geometryReferenceFor(n.geometryVersions[0].geometry),null);
 for(const create of [createGeometryVersionStore,createCanonicalGeometryVersionStore])assert.throws(()=>create([{id:'ATA',version:1,geojson:n.geometryVersions[0].geometry}]),/Coordinate/);
 writeTerritorialSource(f.previous,root);writeOriginalAuthoringSource(f.next,root,f);const loaded=readOriginalAuthoringSource('state:ATA',root,f);assert.deepEqual(loaded,f.next);assert.deepEqual(originalAuthoringWkb(loaded.geometryVersions[0].geometry),f.wkb);assert.throws(()=>readTerritorialSource('state:ATA',root),/Coordinate/);
});

test('actual ATA archive store revalidates evidence and leaves generated bytes untouched',{skip:!process.env.PANDO_ATA_STORE_INTEGRATION},async t=>{
 const {prepareLibraryData,withLibraryWrite}=await import('../../../tools/data/library-runtime.mjs');
 const {storeLibraryData}=await import('../../../tools/data/library-store.mjs');
 const {decodeArchiveEntry}=await import('../../../tools/data/library-context.mjs');
 const f=actualFixture(process.env.PANDO_ATA_REVIEW_DIR),parent=fs.mkdtempSync(join(tmpdir(),'pando-ata-store-')),root=join(parent,'app'),data=join(root,'.library-data/repository');
 t.after(()=>fs.rmSync(parent,{recursive:true,force:true}));
 const put=(r,p,b)=>{const file=join(r,p);fs.mkdirSync(join(file,'..'),{recursive:true});fs.writeFileSync(file,b);};
 const git=(r,...args)=>execFileSync('git',['-c','core.autocrlf=false',...args],{cwd:r,encoding:'utf8',stdio:'pipe'}).trim();
 for(const r of [root,data]){fs.mkdirSync(r,{recursive:true});git(r,'init','-q');git(r,'config','core.longpaths','true');git(r,'config','user.name','Fixture');git(r,'config','user.email','fixture@example.invalid');}
 const base='assets/data/territorial-entities/source/',source=base+'countries/state-ATA.json',generated='assets/data/territorial-entities/generated/v2/index.json',old=encodeTerritorialSource(f.previous),candidate=encodeTerritorialSource(f.next),files={};
 const original=new Map([[source,json(old.descriptor)],[generated,json({entities:[]})],...f.evidence,...[...old.geometries].map(([p,b])=>[base+p,b])]);
 for(const [p,b]of original){put(data,p,b);files[p]={stored:p,encoding:'identity',sha256:hash(b),bytes:b.length};}
 put(data,'archive/index.json',JSON.stringify({schema:'pando-library-archive-v1',files}));git(data,'add','.');git(data,'commit','-qm','fixture inputs');
 const pin=git(data,'rev-parse','HEAD');put(root,'config/library-data.json',JSON.stringify({repository:'fixture/data',revision:pin,mounts:['assets/data','reports']}));put(root,'.gitignore','.library-data/\nassets/data/\nreports/\n');git(root,'add','.');git(root,'commit','-qm','fixture app');
 prepareLibraryData({root,fetch:false,purpose:'gis',prefixes:[base+'countries',base+'geometries',generated]});
 const [oldResource,oldBytes]=[...old.geometries][0],oldPath=base+oldResource;
 withLibraryWrite({root,prefixes:[oldPath]},()=>put(root,oldPath,Buffer.from('{}')));
 assert.throws(()=>storeLibraryData({root,prefixes:[oldPath],push:false}),/hash mismatch/);assert.equal(git(data,'rev-parse','HEAD'),pin);
 withLibraryWrite({root,prefixes:[oldPath]},()=>put(root,oldPath,oldBytes));
 const orphanPath=base+'geometries/not-content-addressed.json';withLibraryWrite({root,prefixes:[orphanPath]},()=>put(root,orphanPath,json(f.next.geometryVersions[0].geometry)));
 assert.throws(()=>storeLibraryData({root,prefixes:[orphanPath],push:false}),/hash mismatch/);assert.equal(git(data,'rev-parse','HEAD'),pin);
 const write=d=>withLibraryWrite({root,prefixes:f.prefixes},()=>{put(root,source,json(d));for(const [p,b]of candidate.geometries)put(root,base+p,b);});
 // A codec-valid out-of-bounds shape must not bypass the gate by deleting its marker.
 const missing=structuredClone(candidate.descriptor);delete missing.geometryVersions[0].modernBoundarySupplement.originalAuthoringReview;delete missing.geometryVersions[0].modernBoundarySupplement.sourceAdoptionReview;write(missing);
 assert.throws(()=>storeLibraryData({root,prefixes:f.prefixes,push:false}),/Coordinate|authoring/);assert.equal(git(data,'rev-parse','HEAD'),pin);
 const corrupt=structuredClone(candidate.descriptor);corrupt.geometryVersions[0].modernBoundarySupplement.originalAuthoringReview.sha256='0'.repeat(64);write(corrupt);
 assert.throws(()=>storeLibraryData({root,prefixes:f.prefixes,push:false}),/authoring/);assert.equal(git(data,'rev-parse','HEAD'),pin);
 write(candidate.descriptor);const revision=storeLibraryData({root,prefixes:f.prefixes,push:false});assert.notEqual(revision,pin);
 const stored=JSON.parse(fs.readFileSync(join(data,'archive/index.json'))),read=p=>decodeArchiveEntry(data,stored.files[p],revision,{fetch:false});
 assert.deepEqual(stored.files[generated],files[generated]);for(const [p]of f.evidence)assert.deepEqual(stored.files[p],files[p]);
 const storedEntity=decodeTerritorialSource(JSON.parse(read(source)),p=>read(base+p));assert.deepEqual(normalizeOriginalAuthoringSource(storedEntity,{readEvidence:read}),f.next);assert.deepEqual(originalAuthoringWkb(storedEntity.geometryVersions[0].geometry),f.wkb);
 assert.throws(()=>normalizeOriginalAuthoringSource(storedEntity,{readEvidence:()=>undefined}),/authoring/);
 assert.deepEqual(readOriginalAuthoringSource('state:ATA',join(root,base),{readEvidence:read}),f.next);
});
