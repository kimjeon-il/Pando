import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {prepareOwnedLibraryData,withLibraryWrite,libraryWriteLeases} from '../../../tools/data/library-runtime.mjs';
import {storeLibraryData} from '../../../tools/data/library-store.mjs';
import {decodeArchiveEntry} from '../../../tools/data/library-context.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const git=(root,...args)=>execFileSync('git',['-c','core.autocrlf=false',...args],{cwd:root,encoding:'utf8',stdio:'pipe'}).trim();
const put=(file,bytes)=>{fs.mkdirSync(dirname(file),{recursive:true});fs.writeFileSync(file,bytes);};
function fixture(t){
 const root=fs.mkdtempSync(join(tmpdir(),'pando-unmounted-')),data=join(root,'.library-data/repository');
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 for(const r of [root,data]){fs.mkdirSync(r,{recursive:true});git(r,'init','-q');git(r,'config','user.name','Fixture');git(r,'config','user.email','fixture@example.invalid');}
 const logical='assets/data/selected/value.bin',bytes=Buffer.from('original'),entry={stored:logical,encoding:'identity',bytes:bytes.length,sha256:hash(bytes)};
 put(join(data,logical),bytes);put(join(data,'archive/index.json'),JSON.stringify({files:{[logical]:entry}}));put(join(data,'library.json'),'{}');git(data,'add','.');git(data,'commit','-qm','original');
 const revision=git(data,'rev-parse','HEAD');put(join(root,'config/library-data.json'),JSON.stringify({repository:'fixture/data',revision,mounts:['assets/data','reports']}));put(join(root,'.gitignore'),'.library-data/\nassets/data/\nreports/\n');git(root,'add','.');git(root,'commit','-qm','app');
 return {root,data,logical,bytes,revision};
}
test('unmounted owned source view writes and archives without links, preserving pool and pin contract',t=>{
 const f=fixture(t),link=fs.linkSync,symlink=fs.symlinkSync;
 fs.linkSync=()=>{throw Object.assign(Error('no hardlinks'),{code:'EPERM',syscall:'link'});};
 fs.symlinkSync=()=>{throw Error('mounts must not be attempted');};syncBuiltinESMExports();
 try {
  const ready=prepareOwnedLibraryData({root:f.root,fetch:false,purpose:'gis',prefixes:[f.logical],mount:false});
  assert.equal(fs.existsSync(join(f.root,'assets/data')),false);
  const materialized=ready.materialized,file=join(materialized,f.logical),next=Buffer.from('saved candidate');
  withLibraryWrite({root:f.root,prefixes:[f.logical],materialized},lease=>{
   assert.equal(lease.view,materialized);assert.equal(libraryWriteLeases(f.data).filter(x=>x.alive).length,1);
   fs.writeFileSync(file,next);
   assert.throws(()=>storeLibraryData({root:f.root,prefixes:[f.logical],materialized,push:false}),/active library write lease/);
  });
  const revision=storeLibraryData({root:f.root,prefixes:[f.logical],materialized,push:false});
  assert.notEqual(revision,f.revision);
  const index=JSON.parse(fs.readFileSync(join(f.data,'archive/index.json')));
  assert.deepEqual(decodeArchiveEntry(f.data,index.files[f.logical],revision,{fetch:false}),next);
  assert.deepEqual(fs.readFileSync(join(f.data,'.pando-store/blobs',hash(f.bytes))),f.bytes);
  assert.equal(JSON.parse(fs.readFileSync(join(f.root,'config/library-data.json'))).revision,revision);
  assert.equal(git(f.data,'status','--porcelain'),'');
  assert.throws(()=>withLibraryWrite({root:f.root,prefixes:[f.logical],materialized},()=>{}),/owned|pinned|scope|revision/i,'old explicit view cannot write through new pin');
 } finally {fs.linkSync=link;fs.symlinkSync=symlink;syncBuiltinESMExports();}
});
test('explicit materialized views reject arbitrary directories and another owner before writes',t=>{
 const f=fixture(t),outside=join(f.root,'unowned');fs.mkdirSync(outside);
 for(const path of [outside,join(f.data,'.pando-cache/materialized/ui',f.revision,'scopes','a'.repeat(64))]){
  assert.throws(()=>withLibraryWrite({root:f.root,prefixes:[f.logical],materialized:path},()=>assert.fail('must not write')),/owned|scope|escaped/i);
  assert.throws(()=>storeLibraryData({root:f.root,prefixes:[f.logical],materialized:path,push:false}),/owned|scope|escaped/i);
 }
 assert.equal(git(f.data,'rev-parse','HEAD'),f.revision);
});
