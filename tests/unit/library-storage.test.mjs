import { describe as contractSuite } from 'node:test';
import * as __dep0 from "node:test";
import * as __dep1 from "node:assert/strict";
import * as __dep2 from "node:child_process";
import * as __dep3 from "node:fs";
import * as __dep4 from "node:path";
import * as __dep5 from "node:os";
import * as __dep6 from "../../tools/data/library-content.mjs";
import * as __dep7_context from "../../tools/data/library-context.mjs";
import * as __dep7_reports from "../../tools/data/library-reports.mjs";
import * as __dep7_runtime from "../../tools/data/library-runtime.mjs";
import * as __dep7_publication from "../../tools/data/library-report-publication.mjs";
import * as __dep7_store from "../../tools/data/library-store.mjs";
const __dep7={...__dep7_context,...__dep7_reports,...__dep7_runtime,...__dep7_publication,...__dep7_store};
import * as __dep8 from "../../tools/data/library-storage.mjs";
import * as __dep9 from "../../tools/data/library-git.mjs";
import * as __dep10 from "node:crypto";
import * as __dep11 from "../../scripts/p3-preview-server.mjs";

// Original feature contract: library-storage.test.mjs
contractSuite("library-storage", () => {
const test=__dep0.default;
const assert=__dep1.default;
const { execFileSync }=__dep2;
const { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync }=__dep3;
const { dirname, join }=__dep4;
const { tmpdir }=__dep5;
const { contentFiles, contentHash }=__dep6;
const { prepareLibraryData, withLibraryWrite, libraryMaterializedRoot }=__dep7;
const { libraryStorage }=__dep8;
const { compactDuplicatePacks, localObjects, repackLocalObjects, snapshotGitStorage }=__dep9;
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
});

// Original feature contract: library-input-mount.test.mjs
contractSuite("library-input-mount", () => {
const test=__dep0.default;
const assert=__dep1.default;
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync }=__dep3;
const { tmpdir }=__dep5;
const { join }=__dep4;
const { execFileSync }=__dep2;
const library=__dep7;

test('explicit library input checkout mounts bytes without overwriting a target or modifying inputs',t=>{
  assert.equal(typeof library.mountLibraryInputs,'function');
  const base=mkdtempSync(join(tmpdir(),'pando-input-mount-'));
  t.after(()=>rmSync(base,{recursive:true,force:true}));
  const source=join(base,'input'),target=join(base,'application');
  mkdirSync(join(source,'assets/data'),{recursive:true});mkdirSync(target);
  writeFileSync(join(source,'assets/data/source.json'),'original bytes');
  library.mountLibraryInputs({source,root:target});
  assert.equal(readFileSync(join(target,'assets/data/source.json'),'utf8'),'original bytes');
  assert.throws(()=>library.mountLibraryInputs({source,root:target}),/exists|existing/i);
  assert.equal(readFileSync(join(source,'assets/data/source.json'),'utf8'),'original bytes');
});

test('isolated Git baseline stays clean and input edits remain independently visible',t=>{
  const base=mkdtempSync(join(tmpdir(),'pando-input-git-'));
  t.after(()=>rmSync(base,{recursive:true,force:true}));
  const source=join(base,'input'),target=join(base,'baseline');
  for(const root of [source,target])mkdirSync(join(root,'assets'),{recursive:true});
  mkdirSync(join(source,'assets/data'));writeFileSync(join(source,'assets/data/source.json'),'pinned input');
  writeFileSync(join(target,'index.html'),'pinned source');
  const git=(root,args)=>execFileSync('git',['-C',root,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid',...args],{encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
  for(const root of [source,target]){git(root,['init','-q']);git(root,['add','.']);git(root,['commit','-qm','fixture']);}
  library.mountLibraryInputs({source,root:target});
  assert.equal(git(target,['status','--porcelain','--untracked-files=all','--','index.html','assets']), '');
  assert.equal(git(source,['status','--porcelain','--untracked-files=all','--','assets/data']), '');
  assert.equal(readFileSync(join(target,'index.html'),'utf8'),'pinned source');
  writeFileSync(join(source,'assets/data/source.json'),'changed input');
  assert.match(git(source,['status','--porcelain','--untracked-files=all','--','assets/data']),/M assets\/data\/source.json/);
});

test('library input mounts refuse indirect source and destination parents',t=>{
  const base=mkdtempSync(join(tmpdir(),'pando-input-containment-'));
  t.after(()=>rmSync(base,{recursive:true,force:true}));
  const source=join(base,'source'),external=join(base,'external'),target=join(base,'target');
  for(const p of [source,external,target])mkdirSync(p);
  mkdirSync(join(external,'data'));
  symlinkSync(external,join(source,'assets'),process.platform==='win32'?'junction':'dir');
  assert.throws(()=>library.mountLibraryInputs({source,root:target}),/indirect|link/i);
});
});

// Original feature contract: library-runtime-sharing.test.mjs
contractSuite("library-runtime-sharing", () => {
const test=__dep0.default;
const assert=__dep1.default;
const { execFileSync }=__dep2;
const { createHash }=__dep10;
const { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync }=__dep3;
const { dirname, join }=__dep4;
const { tmpdir }=__dep5;
const library=__dep7;
const { contentFiles }=__dep6;
const { createP3PreviewServer }=__dep11;

const put = (p, bytes) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, bytes); };
const git = (cwd, ...args) => execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'gc.auto=0', ...args], { cwd, encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }).trim();
function fixture(t) {
  const parent = mkdtempSync(join(tmpdir(), 'pando-runtime-share-')), app = join(parent, 'app'), ui = join(parent, 'ui'), data = join(parent, 'data');
  t.after(() => { for (const f of contentFiles(data)) chmodSync(f.path, 0o600); rmSync(parent, { recursive: true, force: true }); });
  for (const root of [app, data]) { mkdirSync(root); git(root,'init','-q'); git(root,'config','user.name','Fixture'); git(root,'config','user.email','fixture@example.invalid'); }
  const bytes = Buffer.from('runtime original'), logical = 'assets/data/current.bin';
  put(join(data, logical), bytes); put(join(data,'library.json'),'{}');
  put(join(data,'archive/index.json'),JSON.stringify({branch:'main',files:{[logical]:{stored:logical,encoding:'identity',sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length}}}));
  git(data,'add','.');git(data,'commit','-qm','data');const revision=git(data,'rev-parse','HEAD');
  put(join(app,'config/library-data.json'),JSON.stringify({repository:'fixture/data',revision,mounts:['assets/data','reports']}));
  put(join(app,'.gitignore'),'.library-data/\nassets/data/\nreports/\n');git(app,'add','.');git(app,'commit','-qm','app');git(app,'worktree','add','-qb','work/ui',ui);
  for(const root of [app,ui]){mkdirSync(join(root,'.library-data'),{recursive:true});symlinkSync(data,join(root,'.library-data/repository'),process.platform==='win32'?'junction':'dir');}
  return {parent,app,ui,data,revision,logical};
}

test('same-pin runtime views share readonly bytes but scoped writes stay branch-private', t => {
  const f=fixture(t);library.prepareLibraryData({root:f.app,fetch:false});library.prepareLibraryData({root:f.ui,fetch:false});
  const a=join(f.app,f.logical),b=join(f.ui,f.logical);
  assert.notEqual(library.libraryMaterializedRoot(f.app),library.libraryMaterializedRoot(f.ui));
  assert.equal(statSync(a,{bigint:true}).ino,statSync(b,{bigint:true}).ino);
  assert.throws(()=>writeFileSync(b,'unsafe'));
  library.withLibraryWrite({root:f.ui,prefixes:['assets/data/current.bin']},()=>{
    assert.equal(library.libraryWriteLeases(f.data).filter(lease=>lease.alive).length,1);
    writeFileSync(b,'ui edit');
  });
  assert.equal(library.libraryWriteLeases(f.data).filter(lease=>lease.alive).length,0);
  assert.equal(readFileSync(a,'utf8'),'runtime original');assert.equal(readFileSync(b,'utf8'),'ui edit');
  assert.notEqual(statSync(a,{bigint:true}).ino,statSync(b,{bigint:true}).ino);
  library.prepareLibraryData({root:f.ui,fetch:false});assert.equal(readFileSync(b,'utf8'),'ui edit');
});

test('dirty legacy cache bytes and extra files are independently retained for every old consumer', t => {
  const f=fixture(t),legacy=join(f.data,'.pando-cache/materialized',f.revision);
  put(join(legacy,f.logical),'unfinished');put(join(legacy,'assets/data/local.json'),'unarchived');
  for(const root of [f.app,f.ui])library.prepareLibraryData({root,fetch:false});
  const a=join(f.app,f.logical),b=join(f.ui,f.logical);assert.equal(readFileSync(a,'utf8'),'unfinished');assert.equal(readFileSync(b,'utf8'),'unfinished');
  assert.notEqual(statSync(a,{bigint:true}).ino,statSync(b,{bigint:true}).ino);
  writeFileSync(b,'ui edit');assert.equal(readFileSync(a,'utf8'),'unfinished');
  assert.equal(readFileSync(join(f.app,'assets/data/local.json'),'utf8'),'unarchived');assert.ok(existsSync(join(legacy,'assets/data/local.json')));
});

test('an unregistered read-only peer defers cache retirement without blocking the owned runtime',t=>{
  const f=fixture(t),audit=join(f.parent,'audit');
  const staleRevision='a'.repeat(40),stale=join(dirname(library.libraryMaterializedRoot(f.ui)),staleRevision);
  const bytes=Buffer.from('runtime original');
  put(join(stale,f.logical),bytes);
  put(join(stale,'.cache-owner.json'),JSON.stringify({schema:'pando-shared-runtime-v1',revision:staleRevision,files:{[f.logical]:{sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,storage:'shared'}}}));
  git(f.app,'worktree','add','--detach',audit);
  const result=library.prepareLibraryData({root:f.ui,fetch:false});
  assert.equal(readFileSync(join(f.ui,f.logical),'utf8'),'runtime original');
  assert.equal(result.cacheRetirement.status,'skipped');
  assert.equal(result.cacheRetirement.reason,'unrecognized-peer-owner');
  assert.equal(result.cacheRetirement.worktree,audit);
  assert.deepEqual(readFileSync(join(stale,f.logical)),bytes);
  assert.throws(()=>library.libraryOwnerId(audit),/worktree owner/i);
  assert.equal(existsSync(join(audit,'assets/data')),false);
  assert.equal(git(audit,'rev-parse','HEAD'),git(f.app,'rev-parse','HEAD'));
});

test('unrelated peer configuration failures still abort runtime preparation',t=>{
  const f=fixture(t),audit=join(f.parent,'audit');
  git(f.app,'worktree','add','--detach',audit);
  put(join(audit,'config/library-data.json'),'{invalid');
  assert.throws(()=>library.prepareLibraryData({root:f.ui,fetch:false}),SyntaxError);
});

test('async write leases persist until completion and reject overlapping writes', async t => {
  const f=fixture(t);library.prepareLibraryData({root:f.app,fetch:false});
  let release;const waiting=new Promise(resolve=>{release=resolve;});
  const operation=library.withLibraryWrite({root:f.app,prefixes:['assets/data']},async()=>{await waiting;writeFileSync(join(f.app,f.logical),'finished');});
  assert.throws(()=>library.withLibraryWrite({root:f.app,prefixes:['assets/data/current.bin']},()=>{}),/write|lease|running/i);
  release();await operation;assert.equal(readFileSync(join(f.app,f.logical),'utf8'),'finished');
  library.withLibraryWrite({root:f.app,prefixes:['assets/data/current.bin']},()=>{});
  assert.throws(()=>library.withLibraryWrite({root:f.app,prefixes:['assets/data/current.bin']},()=>{throw Error('fixture failure');}),/fixture failure/);
  assert.equal(library.libraryWriteLeases(f.data).filter(lease=>lease.alive).length,0);
});

test('materialization peak includes private edits and unarchived files even with a populated pool',()=>{
  const sha='a'.repeat(64),index={files:{'assets/data/current.bin':{sha256:sha,bytes:10}}};
  const peak=library.runtimeMaterializationPeak(index,[{logical:'assets/data/current.bin',sha256:'b'.repeat(64),bytes:2*1024**3},{logical:'assets/data/local.bin',sha256:'c'.repeat(64),bytes:1024**3}],new Set([sha]));
  assert.equal(peak.privateBytes,3*1024**3);assert.equal(peak.totalBytes,3*1024**3);
});

test('offline archive restoration never starts a promisor lazy-fetch child',t=>{
  const f=fixture(t),entry=JSON.parse(git(f.data,'show',`${f.revision}:archive/index.json`)).files[f.logical];
  const oid=git(f.data,'rev-parse',`${f.revision}:${f.logical}`);
  unlinkSync(join(f.data,f.logical));unlinkSync(join(f.data,'.git/objects',oid.slice(0,2),oid.slice(2)));
  git(f.data,'config','remote.origin.promisor','true');git(f.data,'config','remote.origin.url',join(f.parent,'unavailable-local-promisor'));
  const trace=join(f.parent,'git-trace.json'),oldTrace=process.env.GIT_TRACE2_EVENT,oldLazy=process.env.GIT_NO_LAZY_FETCH;
  try{
    process.env.GIT_TRACE2_EVENT=trace;delete process.env.GIT_NO_LAZY_FETCH;
    assert.throws(()=>library.decodeArchiveEntry(f.data,entry,f.revision));
    const events=readFileSync(trace,'utf8').trim().split('\n').map(line=>JSON.parse(line));
    assert.equal(events.some(event=>event.event==='child_start'&&event.argv?.includes('fetch')),false);
  }finally{oldTrace===undefined?delete process.env.GIT_TRACE2_EVENT:process.env.GIT_TRACE2_EVENT=oldTrace;oldLazy===undefined?delete process.env.GIT_NO_LAZY_FETCH:process.env.GIT_NO_LAZY_FETCH=oldLazy;}
});

test('scoped producer output stores and rehydrates without changing a peer pin or bytes',t=>{
  const f=fixture(t);for(const root of [f.app,f.ui])library.prepareLibraryData({root,fetch:false});
  const peerPin=readFileSync(join(f.app,'config/library-data.json'));
  library.withLibraryOutputs({root:f.ui,paths:[join(f.ui,f.logical)]},()=>writeFileSync(join(f.ui,f.logical),'published ui bytes'));
  library.storeLibraryData({root:f.ui,prefixes:[f.logical]});
  for(const root of [f.app,f.ui])library.prepareLibraryData({root,fetch:false});
  assert.equal(readFileSync(join(f.ui,f.logical),'utf8'),'published ui bytes');
  assert.equal(readFileSync(join(f.app,f.logical),'utf8'),'runtime original');
  assert.deepEqual(readFileSync(join(f.app,'config/library-data.json')),peerPin);
});

test('Web preview serves only the configured owner runtime mount outside its code root',async t=>{
  const f=fixture(t);library.prepareLibraryData({root:f.app,fetch:false});
  const secret=join(f.parent,'unrelated');put(join(secret,'secret.txt'),'private');
  symlinkSync(secret,join(f.app,'assets/unrelated'),process.platform==='win32'?'junction':'dir');
  const server=createP3PreviewServer(f.app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const origin=`http://127.0.0.1:${server.address().port}`;
    const response=await fetch(origin+'/'+f.logical);assert.equal(response.status,200);assert.equal(await response.text(),'runtime original');
    assert.equal((await fetch(origin+'/assets/unrelated/secret.txt')).status,403);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
});
