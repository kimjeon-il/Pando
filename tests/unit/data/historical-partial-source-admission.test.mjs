import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {decodeArchiveEntry} from '../../../tools/data/library-context.mjs';
import {decodeTerritorialSource} from '../../../tools/data/territorial-source-codec.mjs';
const app=fileURLToPath(new URL('../../../',import.meta.url));
const fixtureRoot=process.env.PANDO_PARTIAL_REVIEW_FIXTURES;
const repo=process.env.PANDOLAB_LIBRARY_DATA_ROOT;
const base='assets/data/territorial-entities/source/';
const sourcePin=JSON.parse(fs.readFileSync(path.join(app,'config/library-data.json'))).revision;
const hash=b=>createHash('sha256').update(b).digest('hex');
const fixtureImport=p=>import(pathToFileURL(path.join(fixtureRoot,p)).href);
function archive(pin){
 const index=JSON.parse(execFileSync('git',['-C',repo,'show',pin+':archive/index.json'],{maxBuffer:100e6}));
 const cache=new Map();
 return {index,read:p=>{assert(index.files[p],'missing '+p);if(!cache.has(p))cache.set(p,decodeArchiveEntry(repo,index.files[p],pin,{fetch:false}));return cache.get(p);}};
}
const enabled=Boolean(fixtureRoot&&repo);
const options=(built,index,pin)=>({...built,getSourceSnapshot:()=>({sourcePin:pin,archiveRevision:pin,countryDescriptorPaths:Object.keys(index.files).filter(p=>p.startsWith(base+'countries/'))})});
function rejectedMutations(check,row,opts,versionId){
 for(const [name,mutate] of Object.entries({metadata:n=>{n.sourceInfo.title+=' altered';},date:n=>{n.geometryVersions.find(v=>v.versionId===versionId).validFrom='1801-01-01';},coordinate:n=>{const g=n.geometryVersions.find(v=>v.versionId===versionId).geometry;const r=g.type==='Polygon'?g.coordinates[0]:g.coordinates[0][0];r[1][0]+=0.001;}})){
  const n=structuredClone(row.next);mutate(n);assert.throws(()=>check(n,row.before,opts),name);
 }
 assert.throws(()=>check(row.next,row.before,{...opts,prefixes:[...opts.prefixes,base+'countries/state-UNRELATED.json']}),'extra write scope');
}
test('IRN live gate accepts fixed three histories and rejects unrelated changes',{skip:!enabled},async()=>{
 const {assertIrnGulfLiteral:check,irnGulfVersions}=await import('../../../tools/gis/irn-historical-gulf-source-review.mjs');
 const {buildFamilyBatch}=await fixtureImport('irn-history-gulf-literal-feasibility-20261113/build-gulf-batch.mjs');
 const a=archive(sourcePin),b=buildFamilyBatch({sourcePin,readArchive:a.read}),o=options(b,a.index,sourcePin),r=b.rows[0];
 assert.equal(check(r.next,r.before,o),3);rejectedMutations(check,r,o,irnGulfVersions[0]);
 assert.throws(()=>check(r.next,r.before,{...o,getSourceSnapshot:()=>({...o.getSourceSnapshot(),sourcePin:'0'.repeat(40)})}));
});
test('Arctic live gate accepts fixed three histories and rejects unrelated changes',{skip:!enabled},async()=>{
 const {assertArcticLiteral:check}=await import('../../../tools/gis/arctic-historical-mainland-source-review.mjs');
 const {buildFamilyBatch}=await fixtureImport('arctic-history-literal-feasibility-20261113/build-arctic-batch.mjs');
 const a=archive(sourcePin),b=buildFamilyBatch({sourcePin,readArchive:a.read}),o=options(b,a.index,sourcePin);
 let count=0;for(const r of b.rows){count+=check(r.next,r.before,o);const v=r.next.geometryVersions.find(v=>v.historicalProvenance?.arcticLiteralReuse);rejectedMutations(check,r,o,v.versionId);}assert.equal(count,3);
});
test('Korean live gate accepts fixed three phases and rejects policy drift',{skip:!enabled},async()=>{
 const {assertKoreanHistoricalCoast:check}=await import('../../../tools/gis/korean-historical-coast-source-review.mjs');
 const {buildKoreanCoast}=await fixtureImport('korean-historical-coast-three-20261113/build-historical-batch.mjs');
 const a=archive(sourcePin),b=buildKoreanCoast(a.read),o={prefixes:b.prefixes,readEvidence:b.readEvidence};let count=0;
 for(const r of b.rows){count+=check(r.next,r.before,o);rejectedMutations(check,r,o,b.manifest.versions.find(v=>v.code===r.code).versionId);}assert.equal(count,3);
});
test('DEU combined live gate accepts saved proof fixture and rejects extra changes',{skip:!enabled},async()=>{
 const {assertDeu1914Combined:check}=await import('../../../tools/gis/deu1914-combined-source-review.mjs');
 const dir=path.join(fixtureRoot,'historical-deu1914-combined-20261113/prepared-7a18e7a2-1794558792218');
 const j=n=>JSON.parse(fs.readFileSync(path.join(dir,n))),s=j('summary.json'),a=archive(s.sourceRevision),local=new Map();
 const owner=path.resolve(fixtureRoot,'../../..');
 for(const ref of s.evidenceFiles){const b=fs.readFileSync(path.join(owner,ref.reference.slice('reports/'.length)));assert.equal(hash(b),ref.sha256);local.set(ref.reference,b);}
 const read=p=>local.get(p)||a.read(p),before=decodeTerritorialSource(JSON.parse(read(s.targetPath)),p=>read(base+p)),next=j('next-entity.json');
 const o={prefixes:s.writePrefixes,readEvidence:read,getSourceSnapshot:()=>({sourcePin:s.sourceRevision,archiveRevision:s.sourceRevision,countryDescriptorPaths:s.countryDescriptorPaths})};
 assert.equal(check(next,before,o),1);rejectedMutations(check,{next,before},o,s.versionId);
});
