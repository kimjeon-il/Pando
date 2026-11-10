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
test('actual source storage reads archived proof and preserves generated data',t=>{
 const f=fixture(),parent=mkdtempSync(join(tmpdir(),'pando-source-admission-')),root=join(parent,'app'),data=join(root,'.library-data/repository');
 t.after(()=>rmSync(parent,{recursive:true,force:true}));
 const put=(r,p,b)=>{mkdirSync(dirname(join(r,p)),{recursive:true});writeFileSync(join(r,p),b);};
 const git=(r,...args)=>execFileSync('git',['-c','core.autocrlf=false',...args],{cwd:r,encoding:'utf8',stdio:'pipe'}).trim();
 for(const r of [root,data]){mkdirSync(r,{recursive:true});git(r,'init','-q');git(r,'config','core.longpaths','true');git(r,'config','user.name','Fixture');git(r,'config','user.email','fixture@example.invalid');}
 const old=encodeTerritorialSource(f.before),candidate=encodeTerritorialSource(f.next),source=base+'countries/state-AAA.json',generated='assets/data/territorial-entities/generated/v2/index.json',files={};
 const original=new Map([[source,Buffer.from(JSON.stringify(old.descriptor))],[generated,Buffer.from(JSON.stringify({entities:[]}))],['reports/borders/test-proof.json',f.bytes],...[...old.geometries].map(([p,b])=>[base+p,b])]);
 for(const [p,b] of original){put(data,p,b);files[p]={stored:p,encoding:'identity',sha256:hash(b),bytes:b.length};}
 put(data,'archive/index.json',JSON.stringify({schema:'pando-library-archive-v1',files}));git(data,'add','.');git(data,'commit','-qm','fixture inputs');
 const pin=git(data,'rev-parse','HEAD');put(root,'config/library-data.json',JSON.stringify({repository:'fixture/data',revision:pin,mounts:['assets/data','reports']}));
 put(root,'.gitignore','.library-data/\nassets/data/\nreports/\n');git(root,'add','.');git(root,'commit','-qm','fixture app');
 prepareLibraryData({root,fetch:false,purpose:'gis',prefixes:[base+'countries',base+'geometries',generated]});
 const write=descriptor=>withLibraryWrite({root,prefixes:f.prefixes},()=>{put(root,source,JSON.stringify(descriptor));for(const [p,b]of candidate.geometries)put(root,base+p,b);});
 const bad=structuredClone(candidate.descriptor);bad.geometryVersions[0].modernBoundarySupplement.sourceAdoptionReview.sha256=hash('wrong');write(bad);
 assert.throws(()=>storeLibraryData({root,prefixes:f.prefixes,push:false}),/corrupt adoption evidence/);
 assert.equal(git(data,'rev-parse','HEAD'),pin,'rejected evidence must not commit');
 write(candidate.descriptor);const revision=storeLibraryData({root,prefixes:f.prefixes,push:false});assert.notEqual(revision,pin);
 const stored=JSON.parse(readFileSync(join(data,'archive/index.json')));
 assert.equal(stored.files[source].sha256,hash(JSON.stringify(candidate.descriptor)));
 assert.deepEqual(stored.files[generated],files[generated]);
 assert.deepEqual(stored.files['reports/borders/test-proof.json'],files['reports/borders/test-proof.json']);
});
