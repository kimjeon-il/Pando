import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,symlinkSync,rmSync,unlinkSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {verifyCandidate,stageCandidate,PAGES_LIMIT_BYTES} from '../../tools/prepare-pages-release-bundle.mjs';

const sha=s=>createHash('sha1').update('blob '+Buffer.byteLength(s)+'\0').update(s).digest('hex');
function setup(){
 const temp=mkdtempSync(join(tmpdir(),'pando-release-stage10-')),root=join(temp,'web');
 const paths=['index.html','.nojekyll','assets/js/gis-io.js',
   'assets/js/vendor/gdal/gdal3WebAssembly.wasm','assets/js/vendor/gdal/gdal3WebAssembly.data',
   'assets/data/terrain/v0.12.6/manifest.json',
   'assets/data/hydro/v0.13.1/manifest.json',
   'assets/data/territorial-entities/generated/v2/index.json',
   'assets/data/hydro/v0.12.2/manifest.json','assets/data/terrain/v0.12.0/0/0-0.webp'];
 const fileManifest=paths.map((path,i)=>{const raw=path==='.nojekyll'?'':'file-'+i;
   const full=join(root,path);mkdirSync(dirname(full),{recursive:true});writeFileSync(full,raw);
   return {path,gitBlob:sha(raw),bytes:Buffer.byteLength(raw)};
 });
 const old=fileManifest.filter(f=>f.path.includes('/v0.12.2/')||f.path.includes('/v0.12.0/'));
 const lock={schema:'pandolab-gis-archive-delete-lock',version:1,sourceCommit:'a'.repeat(40),
   files:old.map(f=>({...f,group:'legacy'})),totalFiles:old.length,
   totalBytes:old.reduce((n,f)=>n+f.bytes,0)};
 const sum=fileManifest.reduce((n,f)=>n+f.bytes,0);
 const profile={schema:'pandolab-stage9-publication-profile',version:1,name:'synthetic-main',
   budget:{limitBytes:PAGES_LIMIT_BYTES,includedBytes:sum},assetTotal:{bytes:sum,files:fileManifest.length},
   fileManifest,archive:{files:lock.totalFiles,bytes:lock.totalBytes}};
 return {temp,root,profile,lock,old};
}
test('dry run preserves all public URLs and required Web GIS binary paths',()=>{
 const x=setup();
 try{const result=verifyCandidate(x.profile,x.lock,{expectedHead:'a'.repeat(40)});
  assert.equal(result.readyToStage,true);assert.equal(result.readyToDeploy,false);
  assert.equal(result.retainedHistoricalURLs,2);assert.equal(result.errors.length,0);
 }finally{rmSync(x.temp,{recursive:true,force:true});}
});
test('over-1GB footprint is blocked before creating any artifact directory',async()=>{
 const x=setup();
 try{
  const row=x.profile.fileManifest[0];row.bytes=PAGES_LIMIT_BYTES;
  x.profile.budget.includedBytes=x.profile.assetTotal.bytes=x.profile.fileManifest.reduce((n,f)=>n+f.bytes,0);
  const d=join(x.temp,'NO-ARTIFACT');
  const p=verifyCandidate(x.profile,x.lock);
  assert.equal(p.readyToStage,false);assert.equal(p.blockers[0].code,'PAGES_SIZE_LIMIT');
  await assert.rejects(stageCandidate(x.profile,x.lock,x.root,d),/Stage denied/);
  assert.equal(existsSync(d),false);
 }finally{rmSync(x.temp,{recursive:true,force:true});}
});
test('an old byte changed or duplicate path blocks candidate without deleting',()=>{
 const x=setup();
 try{
  const wrong={...x.profile,fileManifest:x.profile.fileManifest.map(f=>({...f}))};
  wrong.fileManifest.find(f=>f.path===x.old[0].path).gitBlob='f'.repeat(40);
  assert.equal(verifyCandidate(wrong,x.lock).readyToStage,false);
  assert.ok(verifyCandidate(wrong,x.lock).errors.some(x=>x.includes('Old public URL')));
  wrong.fileManifest[0].path='../secret';
  assert.ok(verifyCandidate(wrong,x.lock).errors.some(x=>x.includes('Invalid artifact record')));
  const duplicate={...x.profile,fileManifest:[...x.profile.fileManifest,
   {...x.profile.fileManifest[0]}]};
  assert.ok(verifyCandidate(duplicate,x.lock).errors.some(x=>x.includes('Duplicate URL')));
 }finally{rmSync(x.temp,{recursive:true,force:true});}
});
test('offline materialization verifies Git Blob and produces byte identical files',async()=>{
 const x=setup();
 try{
  const out=join(x.temp,'staged'),r=await stageCandidate(x.profile,x.lock,x.root,out,{expectedHead:'a'.repeat(40)});
  assert.equal(r.verifiedFiles,x.profile.fileManifest.length);
  assert.equal(r.readyToDeploy,false);
  for(const f of x.profile.fileManifest)
   assert.deepEqual(readFileSync(join(out,f.path)),readFileSync(join(x.root,f.path)));
  await assert.rejects(stageCandidate(x.profile,x.lock,x.root,out),/already exists/);
 }finally{rmSync(x.temp,{recursive:true,force:true});}
});
test('modified source contents fail exact Git Blob verification',async()=>{
 const x=setup();
 try{
  writeFileSync(join(x.root,'assets/js/gis-io.js'),'changed');
  await assert.rejects(stageCandidate(x.profile,x.lock,x.root,join(x.temp,'staged')),/size changed|digest/);
 }finally{rmSync(x.temp,{recursive:true,force:true});}
});
test('symlinked source path is rejected without following outside root',async()=>{
 const x=setup();
 try{
  const target=join(x.temp,'outside');writeFileSync(target,'bad');
  const p=x.profile.fileManifest.find(f=>f.path==='assets/js/gis-io.js');
  unlinkSync(join(x.root,p.path));
  symlinkSync(target,join(x.root,p.path));
  await assert.rejects(stageCandidate(x.profile,x.lock,x.root,join(x.temp,'staged')),/Symlink source rejected/);
 }finally{rmSync(x.temp,{recursive:true,force:true});}
});
