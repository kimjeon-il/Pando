import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {encodeTerritorialSource} from '../../../tools/data/territorial-source-codec.mjs';
import {prepareLibraryData,withLibraryWrite} from '../../../tools/data/library-runtime.mjs';
import {storeLibraryData} from '../../../tools/data/library-store.mjs';
import {assertHistoricalSourceStorageChanges,assertHistoricalDisplayChanges,assertHistoricalCompiledChanges} from '../../../tools/gis/historical-display-review.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const digest=g=>hash(JSON.stringify([g.type,g.coordinates]));
const base='assets/data/territorial-entities/source/';
function fixture(){
 const before={schemaVersion:2,entityId:'state:AAA',names:{en:'A'},lifetime:{validFrom:'1900',validTo:null},geometryVersions:[{versionId:'modern',validFrom:null,validTo:null,historicalProvenance:{status:'provisional-modern-proxy'},geometry:{type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,0]]]}}]};
 const next=structuredClone(before),v=next.geometryVersions[0];v.geometry.coordinates[0][1][0]=1.1;
 const proof={schemaVersion:1,status:'raw-source-only-not-display-approved',entityId:next.entityId,versionId:v.versionId,previousGeometrySha256:digest(before.geometryVersions[0].geometry),geometrySha256:digest(v.geometry),source:{reference:'original.gpkg/DoS_WP_11_4/WP_ID',sha256:hash('original')},method:'lossless-original-feature',rawCoordinateRoundtrip:true,topology:{status:'passed',checks:['validity','shared-boundary','gaps-overlaps','holes-islands','ownership'],counterpartVersions:[],noSharedBoundaryReason:'isolated feature'}};
 const bytes=Buffer.from(JSON.stringify(proof));v.modernBoundarySupplement={sourceAdoptionReview:{reference:'reports/borders/test-proof.json',sha256:hash(bytes)}};
 return {before,next,proof,bytes,prefixes:[base+'countries/state-AAA.json',base+'geometries/sha256-'+hash(JSON.stringify(v.geometry)+'\n')+'.json'],readEvidence:()=>bytes};
}
test('raw modern source admission uses archived evidence and is not display approval',()=>{
 const f=fixture();assert.equal(assertHistoricalSourceStorageChanges(f.next,f.before,f),1);
 assert.throws(()=>assertHistoricalDisplayChanges(f.next,f.before),/Historical display review required/);
 const v=f.next.geometryVersions[0];
 const compiled={entityId:f.next.entityId,identity:{properties:{metadata:{historicalTimeline:{geometryVersions:[v]}}}},geometries:[{id:'g',version:1,geojson:v.geometry}],sourceBindings:[{sourceVersionId:v.versionId,geometryRef:{id:'g',version:1},validFrom:null,validTo:null}]};
 assert.throws(()=>assertHistoricalCompiledChanges(compiled,null),/Historical display review required/);
});
test('stored source metadata updates do not require replaying an obsolete adoption receipt',()=>{
 const f=fixture(),next=structuredClone(f.next);next.names.en='Updated name';
 assert.equal(assertHistoricalSourceStorageChanges(next,f.next,{prefixes:[base+'countries/state-AAA.json']}),0);
});

function currentFixture(){
 const f=fixture(),old=f.before.geometryVersions[0],v=f.next.geometryVersions[0];
 old.validFrom=v.validFrom='2002-05-20';
 const priorProof={schemaVersion:1,status:'source-topology-reviewed-conditional-on-coherent-pga-retirement',rows:[{entityId:f.before.entityId,versionId:old.versionId,validFrom:old.validFrom,validTo:null,candidateGeometrySha256:digest(old.geometry),donorGeometrySha256:digest(old.geometry),exactDonorCoordinateCopy:true,periodPreserved:true,candidate:{valid:true,empty:false}}]};
 const priorBytes=Buffer.from(JSON.stringify(priorProof)),priorReceipt={reference:'reports/borders/prior-prepared.json',sha256:hash(priorBytes)};
 const current={status:'approved-prepared-current-source-adoption',sourceId:'prepared',geometrySha256:digest(old.geometry),sourceReview:{reference:'D:/archive/reports/.edits/gis/borders/prior-prepared.json',sha256:priorReceipt.sha256},historicalAccuracyVerified:false,effectiveDateEstablished:false};
 old.historicalProvenance.currentGeometrySource=structuredClone(current);v.historicalProvenance.currentGeometrySource=structuredClone(current);
 old.modernBoundarySupplement=structuredClone(current);Object.assign(v.modernBoundarySupplement,current,{priorPreparedAttribution:structuredClone(current)});
 f.before.metadata=f.next.metadata={representativeGeometryVersionId:old.versionId};
 f.before.sourceInfo={geometryVersionId:old.versionId,license:'preserved',geometrySha256:hash(JSON.stringify(old.geometry))};f.next.sourceInfo={...f.before.sourceInfo,geometrySha256:digest(v.geometry)};
 const other={versionId:'historical',validFrom:'1900',validTo:'2002-05-19',sourceId:'original-historical',geometry:structuredClone(old.geometry)};
 f.before.geometryVersions.unshift(other);f.next.geometryVersions.unshift(structuredClone(other));
 Object.assign(f.proof,{validFrom:v.validFrom,validTo:v.validTo,priorPreparedSourceReview:priorReceipt,sourceInfoGeometryDigestFormat:'sha256(JSON.stringify([geometry.type, geometry.coordinates]))'});
 f.refresh=()=>{f.bytes=Buffer.from(JSON.stringify(f.proof));v.modernBoundarySupplement.sourceAdoptionReview.sha256=hash(f.bytes);};f.refresh();
 f.priorProof=priorProof;f.priorBytes=priorBytes;
 f.readEvidence=reference=>reference===priorReceipt.reference?f.priorBytes:f.bytes;
 return f;
}

test('selected dated current source admits raw geometry while preserving other versions and display gates',()=>{
 const f=currentFixture(),snapshot=structuredClone(f.next);
 assert.equal(assertHistoricalSourceStorageChanges(f.next,f.before,f),1);assert.deepEqual(f.next,snapshot);
 assert.throws(()=>assertHistoricalDisplayChanges(f.next,f.before),/Historical display review required/);
 const v=f.next.geometryVersions[1],compiled={entityId:f.next.entityId,identity:{properties:{metadata:{historicalTimeline:{geometryVersions:[v]}}}},geometries:[{id:'g',version:1,geojson:v.geometry}],sourceBindings:[{sourceVersionId:v.versionId,geometryRef:{id:'g',version:1},validFrom:v.validFrom,validTo:null}]};
 assert.throws(()=>assertHistoricalCompiledChanges(compiled,null),/Historical display review required/);
});
for(const kind of ['target dates','closed target','version identity','version order','duplicate version','other geometry','other attribution','source info','missing metadata','wrong selection','wrong source selection','stale source hash','stale current hash','missing prior proof','corrupt prior proof','stale prior row','duplicate prior row','stale receipt dates','missing receipt dates','mixed scope'])test('selected current admission rejects '+kind,()=>{
 const f=currentFixture(),v=f.next.geometryVersions[1];
 if(kind==='target dates')v.validFrom='2003-01-01';
 if(kind==='closed target')f.before.geometryVersions[1].validTo=v.validTo='2020-01-01';
 if(kind==='version identity')v.versionId='other';
 if(kind==='version order')f.next.geometryVersions.reverse();
 if(kind==='duplicate version')f.next.geometryVersions[0].versionId=v.versionId;
 if(kind==='other geometry')f.next.geometryVersions[0].geometry.coordinates[0][1][0]=2;
 if(kind==='other attribution')f.next.geometryVersions[0].sourceId='replacement';
 if(kind==='source info')f.next.sourceInfo.license='changed';
 if(kind==='missing metadata')delete f.before.geometryVersions[1].historicalProvenance.currentGeometrySource;
 if(kind==='wrong selection')f.before.metadata={representativeGeometryVersionId:'historical'};
 if(kind==='wrong source selection')f.next.sourceInfo.geometryVersionId='historical';
 if(kind==='stale source hash')f.next.sourceInfo.geometrySha256=f.before.sourceInfo.geometrySha256;
 if(kind==='stale current hash')f.before.geometryVersions[1].historicalProvenance.currentGeometrySource.geometrySha256=hash('stale');
 if(kind==='missing prior proof')delete f.proof.priorPreparedSourceReview;
 if(kind==='corrupt prior proof')f.priorBytes=Buffer.from('{}');
 if(kind==='stale receipt dates')f.proof.validFrom='2001-01-01';
 if(kind==='missing receipt dates')delete f.proof.validFrom;
 if(kind==='mixed scope')f.prefixes.push('assets/data/territorial-entities/generated/v2/index.json');
 if(kind==='stale prior row'||kind==='duplicate prior row'){
  if(kind==='stale prior row')f.priorProof.rows[0].validFrom='2001-01-01';else f.priorProof.rows.push({...f.priorProof.rows[0]});
  f.priorBytes=Buffer.from(JSON.stringify(f.priorProof));const sha=hash(f.priorBytes);f.proof.priorPreparedSourceReview.sha256=sha;
  for(const e of [f.before,f.next])e.geometryVersions[1].historicalProvenance.currentGeometrySource.sourceReview.sha256=sha;
  f.before.geometryVersions[1].modernBoundarySupplement.sourceReview.sha256=sha;
  v.modernBoundarySupplement.sourceReview.sha256=sha;v.modernBoundarySupplement.priorPreparedAttribution.sourceReview.sha256=sha;
 }
 f.refresh();assert.throws(()=>assertHistoricalSourceStorageChanges(f.next,f.before,f),kind==='stale prior row'?/stale prior current-source adoption evidence/:kind==='duplicate prior row'?/prior current-source adoption row required/:undefined);
});
test('raw source admission preserves old supplement attribution and caveats in place',()=>{
 const f=fixture(),prior={sourceId:'prepared',historicalAccuracyVerified:false,displayExclusions:['island']};
 f.before.geometryVersions[0].modernBoundarySupplement=prior;
 const supplement=f.next.geometryVersions[0].modernBoundarySupplement;
 supplement.priorPreparedAttribution=structuredClone(prior);
 assert.throws(()=>assertHistoricalSourceStorageChanges(f.next,f.before,f),/source caveat changed/);
 Object.assign(supplement,prior);assert.equal(assertHistoricalSourceStorageChanges(f.next,f.before,f),1);
 supplement.priorPreparedAttribution.sourceId='invented';
 assert.throws(()=>assertHistoricalSourceStorageChanges(f.next,f.before,f),/prior source attribution/);
});
for(const kind of ['missing evidence','corrupt evidence','stale geometry','changed lifetime','changed provenance','dated version','mixed output','broad scope','unrelated resource'])test('source admission rejects '+kind,()=>{
 const f=fixture();
 if(kind==='missing evidence')f.readEvidence=()=>undefined;
 if(kind==='corrupt evidence')f.readEvidence=()=>Buffer.from('{}');
 if(kind==='stale geometry')f.next.geometryVersions[0].geometry.coordinates[0][1][0]=1.2;
 if(kind==='changed lifetime')f.next.lifetime.validFrom='1801';
 if(kind==='changed provenance')f.next.geometryVersions[0].historicalProvenance.status='approved';
 if(kind==='dated version')f.next.geometryVersions[0].validFrom='1900';
 if(kind==='mixed output')f.prefixes.push('assets/data/builtin-world/generated/v1/index.json');
 if(kind==='broad scope')f.prefixes=['assets/data/territorial-entities/source'];
 if(kind==='unrelated resource')f.prefixes[1]=base+'geometries/sha256-'+hash('unrelated')+'.json';
 assert.throws(()=>assertHistoricalSourceStorageChanges(f.next,f.before,f));
});
for(const multiversion of [false,true])test('actual source storage reads archived proof and preserves generated data'+(multiversion?' for a selected dated current version':''),t=>{
 const f=multiversion?currentFixture():fixture(),parent=mkdtempSync(join(tmpdir(),'pando-source-admission-')),root=join(parent,'app'),data=join(root,'.library-data/repository');
 t.after(()=>rmSync(parent,{recursive:true,force:true}));
 const put=(r,p,b)=>{mkdirSync(dirname(join(r,p)),{recursive:true});writeFileSync(join(r,p),b);};
 const git=(r,...args)=>execFileSync('git',['-c','core.autocrlf=false',...args],{cwd:r,encoding:'utf8',stdio:'pipe'}).trim();
 for(const r of [root,data]){mkdirSync(r,{recursive:true});git(r,'init','-q');git(r,'config','core.longpaths','true');git(r,'config','user.name','Fixture');git(r,'config','user.email','fixture@example.invalid');}
 const old=encodeTerritorialSource(f.before),candidate=encodeTerritorialSource(f.next),source=base+'countries/state-AAA.json',generated='assets/data/territorial-entities/generated/v2/index.json',files={};
 const original=new Map([[source,Buffer.from(JSON.stringify(old.descriptor))],[generated,Buffer.from(JSON.stringify({entities:[]}))],['reports/borders/test-proof.json',f.bytes],...[...old.geometries].map(([p,b])=>[base+p,b])]);
 if(multiversion)original.set(f.proof.priorPreparedSourceReview.reference,f.priorBytes);
 for(const [p,b] of original){put(data,p,b);files[p]={stored:p,encoding:'identity',sha256:hash(b),bytes:b.length};}
 put(data,'archive/index.json',JSON.stringify({schema:'pando-library-archive-v1',files}));git(data,'add','.');git(data,'commit','-qm','fixture inputs');
 const pin=git(data,'rev-parse','HEAD');put(root,'config/library-data.json',JSON.stringify({repository:'fixture/data',revision:pin,mounts:['assets/data','reports']}));
 put(root,'.gitignore','.library-data/\nassets/data/\nreports/\n');git(root,'add','.');git(root,'commit','-qm','fixture app');
 prepareLibraryData({root,fetch:false,purpose:'gis',prefixes:[base+'countries',base+'geometries',generated]});
 const write=descriptor=>withLibraryWrite({root,prefixes:f.prefixes},()=>{put(root,source,JSON.stringify(descriptor));for(const [p,b]of candidate.geometries)if(f.prefixes.includes(base+p))put(root,base+p,b);});
 const bad=structuredClone(candidate.descriptor);bad.geometryVersions.at(-1).modernBoundarySupplement.sourceAdoptionReview.sha256=hash('wrong');write(bad);
 assert.throws(()=>storeLibraryData({root,prefixes:f.prefixes,push:false}),/corrupt adoption evidence/);
 assert.equal(git(data,'rev-parse','HEAD'),pin,'rejected evidence must not commit');
 write(candidate.descriptor);const revision=storeLibraryData({root,prefixes:f.prefixes,push:false});assert.notEqual(revision,pin);
 const stored=JSON.parse(readFileSync(join(data,'archive/index.json')));
 assert.equal(stored.files[source].sha256,hash(JSON.stringify(candidate.descriptor)));
 assert.deepEqual(stored.files[generated],files[generated]);
 assert.deepEqual(stored.files['reports/borders/test-proof.json'],files['reports/borders/test-proof.json']);
 if(multiversion){
  assert.deepEqual(candidate.descriptor.geometryVersions[0],old.descriptor.geometryVersions[0]);
  const unchanged=base+old.descriptor.geometryVersions[0].geometryResource.file;
  assert.deepEqual(stored.files[unchanged],files[unchanged]);
  assert.deepEqual(stored.files[f.proof.priorPreparedSourceReview.reference],files[f.proof.priorPreparedSourceReview.reference]);
 }
});
