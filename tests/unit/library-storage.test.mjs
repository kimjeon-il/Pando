import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { contentFiles, contentHash } from '../../tools/library-content.mjs';
import { prepareLibraryData, withLibraryWrite, libraryMaterializedRoot } from '../../tools/library-data.mjs';
import { libraryStorage } from '../../tools/library-storage.mjs';
import { compactDuplicatePacks, localObjects, repackLocalObjects, snapshotGitStorage } from '../../tools/library-git.mjs';
const git=(root,args,input)=>execFileSync('git',['-c','core.autocrlf=false','-c','gc.auto=0',...args],{cwd:root,input,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
const put=(path,bytes)=>{mkdirSync(dirname(path),{recursive:true});writeFileSync(path,bytes);};
function fixture(t){
  const parent=mkdtempSync(join(tmpdir(),'pando-storage-')),app=join(parent,'app'),ui=join(parent,'ui'),data=join(parent,'data');
  t.after(()=>{for(const f of contentFiles(data))chmodSync(f.path,0o600);rmSync(parent,{recursive:true,force:true});});
  for(const r of [app,data]){mkdirSync(r);git(r,['init','-q']);git(r,['config','user.name','Fixture']);git(r,['config','user.email','fixture@example.invalid']);}
  const logical='assets/data/current.bin',bytes=Buffer.from('immutable runtime'),revisionFiles={[logical]:{stored:logical,encoding:'identity',sha256:contentHash(bytes),bytes:bytes.length}};
  put(join(data,logical),bytes);put(join(data,'archive/index.json'),JSON.stringify({branch:'main',files:revisionFiles}));put(join(data,'library.json'),'{}');put(join(data,'reports/original.md'),'evidence');
  git(data,['add','.']);git(data,['commit','-qm','data']);const revision=git(data,['rev-parse','HEAD']);
  put(join(app,'config/library-data.json'),JSON.stringify({repository:'fixture/data',revision,mounts:['assets/data','reports']}));put(join(app,'.gitignore'),'.library-data/\nassets/data/\nreports/\n');put(join(app,'old-script.mjs'),'recover this script');
  git(app,['add','.']);git(app,['commit','-qm','app']);git(app,['worktree','add','-qb','work/ui',ui]);
  for(const r of [app,ui]){mkdirSync(join(r,'.library-data'),{recursive:true});symlinkSync(data,join(r,'.library-data/repository'),process.platform==='win32'?'junction':'dir');}
  const legacy=join(data,'.pando-cache/materialized',revision);put(join(legacy,logical),bytes);put(join(legacy,'assets/data/unfinished.bin'),'unarchived work');put(join(legacy,'.complete'),revision);put(join(legacy,'.cache-owner.json'),JSON.stringify({files:{[logical]:revisionFiles[logical].sha256}}));
  put(join(data,'.git/info/exclude'),'/.pando-cache/\n/.pando-store/\n/.local-preserved/\n');
  put(join(data,'.local-preserved/script.mjs'),'recover this script');copyFileSync(join(data,'.git/index'),join(data,'.git/migration.index'));
  git(data,['repack','-ad']);const oid=git(data,['rev-parse',`HEAD:${logical}`]),hash=git(data,['pack-objects',join(data,'.git/objects/pack/pack')],oid+'\n');put(join(data,`.git/objects/pack/pack-${hash}.promisor`),'');
  const unreachable=git(data,['hash-object','-w','--stdin'],'unreachable local bytes');
  return {app,ui,data,legacy,logical,unreachable};
}

test('incremental Git compaction resumes without dropping promised or unreachable objects',t=>{
  const f=fixture(t),before=localObjects(f.data),refs=git(f.data,['show-ref']);
  assert.deepEqual(compactDuplicatePacks(f.data,{stopAfter:'inventoried'}),{interruptedAt:'inventoried'});
  const pending=join(f.data,'.git/pando-git-compaction.pending.json');
  assert.ok(existsSync(pending));
  assert.equal(compactDuplicatePacks(f.data).compacted,true);
  assert.deepEqual(localObjects(f.data),before);assert.equal(git(f.data,['show-ref']),refs);
  assert.equal(git(f.data,['cat-file','-p',f.unreachable]),'unreachable local bytes');
  const packRoot=join(f.data,'.git/objects/pack');
  const ids=readdirSync(packRoot).filter(n=>n.endsWith('.idx')).flatMap(n=>git(f.data,['show-index'],readFileSync(join(packRoot,n))).split('\n').map(line=>line.split(' ')[1]));
  assert.equal(ids.length,new Set(ids).size);
  const promised=readdirSync(packRoot).filter(n=>n.endsWith('.promisor')).flatMap(n=>git(f.data,['show-index'],readFileSync(join(packRoot,n.replace('.promisor','.idx')))).split('\n').map(line=>line.split(' ')[1]));
  assert.ok(promised.includes(git(f.data,['rev-parse','HEAD:'+f.logical])));
  assert.equal(existsSync(pending),false);assert.equal(compactDuplicatePacks(f.data).compacted,false);
});

test('incremental Git compaction restarts an undeleted inventory after a legitimate object addition',t=>{
  const f=fixture(t);compactDuplicatePacks(f.data,{stopAfter:'inventoried'});
  const oid=git(f.data,['hash-object','-w','--stdin'],'concurrent unique bytes');
  assert.equal(compactDuplicatePacks(f.data).compacted,true);
  assert.equal(git(f.data,['cat-file','-p',oid]),'concurrent unique bytes');
  assert.equal(existsSync(join(f.data,'.git/pando-git-compaction.pending.json')),false);
});

test('a damaged retained pack cannot justify deleting a valid duplicate original',t=>{
  const f=fixture(t),packRoot=join(f.data,'.git/objects/pack');
  const kept=readdirSync(packRoot).filter(n=>n.endsWith('.pack')).sort((a,b)=>statSync(join(packRoot,b)).size-statSync(join(packRoot,a)).size)[0];
  const path=join(packRoot,kept),bytes=readFileSync(path),oid=git(f.data,['rev-parse','HEAD:'+f.logical]);
  const offset=Number(git(f.data,['show-index'],readFileSync(path.replace('.pack','.idx'))).split('\n').find(line=>line.split(' ')[1]===oid).split(' ')[0]);
  writeFileSync(path.replace('.pack','.promisor'),'');
  bytes[offset+6]^=1;chmodSync(path,0o600);writeFileSync(path,bytes);
  const before=readdirSync(packRoot).sort();
  assert.throws(()=>compactDuplicatePacks(f.data),/pack|checksum|integrity/);
  assert.deepEqual(readdirSync(packRoot).sort(),before,'the valid source pack must remain until retained payload integrity passes');
});

test('only a byte-proven prefix of a verified complete pack is retired as a failed download',t=>{
  const f=fixture(t),packRoot=join(f.data,'.git/objects/pack'),before=localObjects(f.data);
  const source=readdirSync(packRoot).find(n=>n.endsWith('.pack')),bytes=readFileSync(join(packRoot,source));
  const obsolete=readdirSync(packRoot).filter(n=>n.endsWith('.pack')).sort((a,b)=>statSync(join(packRoot,b)).size-statSync(join(packRoot,a)).size)[0];
  const keep=join(packRoot,obsolete.replace('.pack','.keep'));writeFileSync(keep,'');
  const duplicate=join(packRoot,'tmp_pack_proven'),unknown=join(packRoot,'tmp_pack_unknown');
  writeFileSync(duplicate,bytes.subarray(0,Math.floor(bytes.length/2)));writeFileSync(unknown,'unverified unique unfinished bytes');
  compactDuplicatePacks(f.data);
  assert.equal(existsSync(duplicate),false);assert.equal(readFileSync(unknown,'utf8'),'unverified unique unfinished bytes');
  assert.equal(existsSync(keep),false,'a replaced source pack must not leave its obsolete keep marker');
  assert.deepEqual(localObjects(f.data),before);
});

test('standalone application Git compaction preserves unreachable objects and all worktree states',t=>{
 const f=fixture(t),unreachable=git(f.app,['hash-object','-w','--stdin'],'private unreachable app bytes');
 const snapshot=snapshotGitStorage(f.app);const before=localObjects(f.app),refs=git(f.app,['show-ref']);
 repackLocalObjects(f.app,snapshot);
 assert.deepEqual(localObjects(f.app),before);assert.equal(git(f.app,['show-ref']),refs);assert.equal(git(f.app,['cat-file','-p',unreachable]),'private unreachable app bytes');
 assert.equal(existsSync(join(f.app,'.pando-store')),false,'application compaction uses common Git staging, not a library store');
});
test('migration resumes, retains dirty bytes independently, compacts all local objects and removes actual old copies',t=>{
  const f=fixture(t),objects=localObjects(f.data),refs=git(f.data,['show-ref']),head=git(f.data,['rev-parse','HEAD']);
  const preview=libraryStorage({root:f.ui});assert.equal(preview.legacyCaches.length,1);assert.ok(existsSync(f.legacy));
  assert.equal(git(f.data,['show-ref']),refs); // Preview never registers owners.
  assert.deepEqual(libraryStorage({root:f.ui,apply:true,stopAfter:'shared'}),{interruptedAt:'shared'});
  const protectedRefs=git(f.data,['show-ref']);
  assert.equal(protectedRefs.split('\n').filter(row=>!row.includes(' refs/pando/reports/')).join('\n'),refs);
  for(const owner of ['main','ui'])assert.equal(git(f.data,['rev-parse',`refs/pando/reports/${owner}`]),head);
  assert.throws(()=>prepareLibraryData({root:f.app,fetch:false}),/migration must resume/);
  const deadPid=Number(execFileSync(process.execPath,['-e','process.stdout.write(String(process.pid))'],{encoding:'utf8'}));
  put(join(f.ui,'.library-data/prepare.lock'),JSON.stringify({pid:deadPid,root:f.ui}));
  put(join(f.data,'.git/pando-library.lock'),JSON.stringify({pid:deadPid,checkout:f.data}));
  const result=libraryStorage({root:f.ui,apply:true});
  assert.equal(existsSync(f.legacy),false);assert.equal(existsSync(join(f.data,'.local-preserved/script.mjs')),false);
  assert.equal(existsSync(join(f.data,'.git/migration.index')),false);assert.ok(result.relocated.length);
  assert.deepEqual(localObjects(f.data),objects);assert.equal(git(f.data,['show-ref']),protectedRefs);assert.equal(git(f.data,['rev-parse','HEAD']),head);
  assert.equal(git(f.data,['cat-file','-p',f.unreachable]),'unreachable local bytes');
  const a=join(f.app,f.logical),b=join(f.ui,f.logical);assert.equal(statSync(a,{bigint:true}).ino,statSync(b,{bigint:true}).ino);assert.throws(()=>writeFileSync(a,'unsafe'));
  const dirtyA=join(f.app,'assets/data/unfinished.bin'),dirtyB=join(f.ui,'assets/data/unfinished.bin');assert.notEqual(statSync(dirtyA,{bigint:true}).ino,statSync(dirtyB,{bigint:true}).ino);
  writeFileSync(dirtyB,'ui only');assert.equal(readFileSync(dirtyA,'utf8'),'unarchived work');
  assert.ok(result.logicalBytesRemoved>0);assert.equal(existsSync(join(f.data,'.pando-store/storage-migration.pending.json')),false);
  assert.equal(result.evidence,join(f.data,'private-evidence/storage-migrations',result.id));
  const installed=JSON.parse(readFileSync(join(result.evidence,'source-records.json'),'utf8'));installed.phase='packs-installed';
  assert.doesNotThrow(()=>repackLocalObjects(f.data,installed)); // Crash after staging removal, before final journal write.
  prepareLibraryData({root:f.app,fetch:false});assert.equal(readFileSync(a,'utf8'),'immutable runtime');
});

test('migration keeps a newer owner edit and preserves a different legacy edition',t=>{
  const f=fixture(t);prepareLibraryData({root:f.ui,fetch:false});
  withLibraryWrite({root:f.ui,prefixes:['assets/data/current.bin']},()=>writeFileSync(join(f.ui,f.logical),'ui edit'));
  writeFileSync(join(f.ui,f.logical),'ui newest edit'); // Deliberately stale private manifest.
  writeFileSync(join(f.ui,'assets/data/unfinished.bin'),'newer unarchived ui work');
  const result=libraryStorage({root:f.ui,apply:true});
  assert.equal(readFileSync(join(f.ui,f.logical),'utf8'),'ui newest edit');
  assert.equal(readFileSync(join(f.ui,'assets/data/unfinished.bin'),'utf8'),'newer unarchived ui work');
  assert.equal(readFileSync(join(f.app,'assets/data/unfinished.bin'),'utf8'),'unarchived work');
  assert.equal(existsSync(f.legacy),false);
  const manifest=JSON.parse(readFileSync(join(libraryMaterializedRoot(f.ui),'.cache-owner.json'),'utf8'));
  assert.equal(manifest.files[f.logical].sha256,contentHash(Buffer.from('ui newest edit')));
  const journal=JSON.parse(readFileSync(join(result.evidence,'source-records.json'),'utf8'));
  assert.ok(journal.legacy.flatMap(c=>c.files).some(file=>file.ownerDifferences?.length));
});
