import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {chmodSync,existsSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,rmdirSync,symlinkSync,unlinkSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {gzipSync} from 'node:zlib';
import {contentHash,publishContent,linkContent,removeContentLink,removeUnlinkedContentBlob} from '../../tools/data/library-content.mjs';
import {prepareLibraryData,prepareLibraryMetadata,withLibraryWrite} from '../../tools/data/library-runtime.mjs';
import {hydrateReports,reportRegistry} from '../../tools/data/library-reports.mjs';
import {storeLibraryData,runtimeStoreIndex} from '../../tools/data/library-store.mjs';
import {libraryStoragePath} from '../../tools/data/library-storage-paths.mjs';
import {decodeArchiveEntry} from '../../tools/data/library-context.mjs';
import {publishLibraryReports,checkLibraryReports,createReportRetirementCommit} from '../../tools/data/library-report-publication.mjs';
import {previewGeneratedCleanup,applyGeneratedCleanup} from '../../tools/data/worktree-generated.mjs';
import {installFrontendSnapshot} from '../../tools/data/worktree-storage.mjs';
import {collectRuntimeDataAssets} from '../../src/data/runtime-manifest-assets.js';

const put=(root,path,bytes)=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),bytes);};
const git=(root,...args)=>execFileSync('git',['-c','maintenance.auto=false','-c','gc.auto=0','-c','core.autocrlf=false',...args],{cwd:root,encoding:'utf8',stdio:'pipe'}).trim();
const read=(root,path)=>readFileSync(join(root,path),'utf8');
function sandbox(t){
 const base=mkdtempSync(join(tmpdir(),'pando-core-storage-'));
 // Never traverse junctions, including during fixture teardown.
 const clean=path=>{const s=lstatSync(path);if(s.isSymbolicLink()){rmSync(path,{force:true});return;}if(s.isDirectory()){for(const name of readdirSync(path))clean(join(path,name));rmdirSync(path);}else{chmodSync(path,0o600);unlinkSync(path);}};
 t.after(()=>clean(base));return base;
}
function init(root){mkdirSync(root,{recursive:true});git(root,'init','-q','-b','main');git(root,'config','user.name','Storage fixture');git(root,'config','user.email','fixture@example.invalid');}
function archive(data,values,message='archive'){
 const files={};for(const [path,value]of Object.entries(values)){const bytes=Buffer.from(value);put(data,path,bytes);files[path]={stored:path,encoding:'identity',bytes:bytes.length,sha256:contentHash(bytes)};}
 put(data,'archive/index.json',JSON.stringify({branch:'main',files}));git(data,'add','--sparse','.');git(data,'commit','-qm',message);return {files,revision:git(data,'rev-parse','HEAD')};
}
function fixture(t,values={'assets/data/selected/input.bin':'pinned bytes'}){
 const base=sandbox(t),root=join(base,'app'),data=join(root,'.library-data/repository');init(root);init(data);put(data,'.gitignore','.pando-store/\n.pando-cache/\nreports/.*\n');
 const {files,revision}=archive(data,values),config={repository:'fixture/PandoLab-library',revision,mounts:['assets/data','reports']};
 put(root,'config/library-data.json',JSON.stringify(config));put(root,'.gitignore','.library-data/\nassets/data/\nreports/\n');git(root,'add','.');git(root,'commit','-qm','app');return {base,root,data,files,revision,config};
}
function publication(t){const f=fixture(t),remote=join(f.base,'remote.git');git(f.base,'init','--bare','-q',remote);git(f.data,'remote','add','origin',remote);git(f.data,'push','-qu','origin','main');const edits=join(f.data,'reports/.edits/main');put(edits,'development/task/report.md','# original evidence\n');return {...f,remote,edits};}
function request(root,path='test-results/output.txt'){return {roots:[root],requests:[{root,path,action:'delete',reason:'Fixture output can be regenerated'}]};}
const scope=['reports/development/task'];

test('preparation reads the pinned edition across storage relocation and newer checkout data',t=>{
 const f=fixture(t),path='assets/data/selected/input.bin',bytes=Buffer.from('pinned bytes');
 const doc='assets/data/selected/task.md',docBytes=Buffer.from('# finished task');
 put(f.data,doc,docBytes);
 const entry={...f.files[path],stored:'archive/blobs/'+contentHash(bytes)+'.bin'},pinned={files:{[path]:entry,[doc]:{stored:doc,encoding:'identity',sha256:contentHash(docBytes),bytes:docBytes.length}}};
 put(f.data,entry.stored,bytes);put(f.data,'archive/index.json',JSON.stringify(pinned));git(f.data,'add','.');git(f.data,'commit','-qm','pinned archived original');
 const revision=git(f.data,'rev-parse','HEAD');put(f.root,'config/library-data.json',JSON.stringify({...f.config,revision}));
 const relocated={...entry,stored:libraryStoragePath(path,entry)},current={files:{[path]:relocated}};
 put(f.data,relocated.stored,bytes);put(f.data,'archive/index.json',JSON.stringify(current));git(f.data,'add','.');git(f.data,'commit','-qm','relocate identical original');
 const merged=runtimeStoreIndex(pinned,current);assert.deepEqual(merged.files[path],relocated);
 assert.deepEqual(decodeArchiveEntry(f.data,merged.files[path],git(f.data,'rev-parse','HEAD'),{fetch:false}),bytes);
 const newer=archive(f.data,{[path]:'newer bytes'},'newer');assert.deepEqual(runtimeStoreIndex(pinned,newer).files[path],entry);
 assert.equal(prepareLibraryMetadata({root:f.root,fetch:false}).index.files[path].sha256,contentHash(bytes));
 prepareLibraryData({root:f.root,fetch:false,purpose:'gis',prefixes:['assets/data/selected']});
 assert.equal(existsSync(join(f.root,doc)),false,'old pinned task Markdown is not materialized');
 assert.equal(read(f.root,path),'pinned bytes');assert.notEqual(git(f.data,'rev-parse','HEAD'),revision);
});

test('preparation preserves unfinished working bytes when the pin advances',t=>{
 const f=fixture(t),path='assets/data/selected/input.bin';prepareLibraryData({root:f.root,fetch:false,purpose:'gis',prefixes:[path]});withLibraryWrite({root:f.root,prefixes:[path]},()=>put(f.root,path,'unfinished private bytes'));
 const next=archive(f.data,{[path]:'new baseline'},'advance');put(f.root,'config/library-data.json',JSON.stringify({...f.config,revision:next.revision}));prepareLibraryData({root:f.root,fetch:false,purpose:'gis',prefixes:[path]});
 assert.equal(read(f.root,path),'unfinished private bytes');assert.equal(git(f.data,'show',`${f.revision}:${path}`),'pinned bytes');
});

test('cleanup preserves protected source even inside a generated directory',t=>{
 const root=sandbox(t),path='test-results/output.txt';put(root,path,'unfinished source');assert.throws(()=>previewGeneratedCleanup({...request(root),protectedPaths:[join(root,path)]}),/protected/i);assert.equal(read(root,path),'unfinished source');
 const bytes=Buffer.from('shared immutable original'),blob=publishContent(root,bytes),view=join(root,'reports/shared.md');
 linkContent(root,blob.sha256,view);
 const before=lstatSync(blob.path),originalChmod=fs.chmodSync;
 assert.equal(before.nlink,2);
 assert.throws(()=>removeUnlinkedContentBlob(root,blob.sha256),/consumer/);
 fs.chmodSync=(target,...args)=>{
  if(existsSync(target)){
   const current=lstatSync(target);
   assert.ok(current.dev!==before.dev||current.ino!==before.ino,'deleting a view must never chmod the shared original inode');
  }
  return originalChmod(target,...args);
 };
 syncBuiltinESMExports();
 try { removeContentLink(root,view); }
 finally { fs.chmodSync=originalChmod;syncBuiltinESMExports(); }
 assert.equal(existsSync(view),false);
 assert.deepEqual(readFileSync(blob.path),bytes);
 assert.equal(lstatSync(blob.path).mode,before.mode);
 assert.equal(lstatSync(blob.path).nlink,1);
 assert.equal(existsSync(join(root,'.pando-store/.permission-restore.json')),false);
 assert.deepEqual(readdirSync(join(root,'reports')),[],'the capability probe leaves no temporary files');
 assert.equal(removeUnlinkedContentBlob(root,blob.sha256),true);
 assert.equal(existsSync(blob.path),false);
});

test('cleanup rejects escaping targets without deleting outside bytes',t=>{
 const base=sandbox(t),root=join(base,'app');mkdirSync(root);put(base,'outside.txt','original outside bytes');assert.throws(()=>previewGeneratedCleanup(request(root,'../outside.txt')),/escap/i);assert.equal(read(base,'outside.txt'),'original outside bytes');
});

test('cleanup preserves a junction and its target contents',t=>{
 const base=sandbox(t),root=join(base,'app'),target=join(base,'originals');mkdirSync(root);put(target,'original.txt','unique original');mkdirSync(join(root,'test-results'));const link=join(root,'test-results/linked');symlinkSync(target,link,process.platform==='win32'?'junction':'dir');
 assert.throws(()=>previewGeneratedCleanup(request(root,'test-results/linked/original.txt')),/linked|preserv/i);assert.equal(lstatSync(link).isSymbolicLink(),true);assert.equal(read(target,'original.txt'),'unique original');
});

test('cleanup rechecks active consumers before applying a previously idle plan',t=>{
 const root=sandbox(t);put(root,'test-results/output.txt','disposable cache');const manifest=previewGeneratedCleanup(request(root));assert.throws(()=>applyGeneratedCleanup({roots:[root],manifest,consumers:[{ProcessId:process.pid,Name:'node.exe',CommandLine:`node ${root}/server.mjs`}]}),/active consumer/i);assert.equal(read(root,'test-results/output.txt'),'disposable cache');
});

test('publication enforces another writer lock and preserves original bytes',t=>{
 const f=publication(t),lock=join(f.data,'.git/pando-library.lock');writeFileSync(lock,'another writer');assert.throws(()=>publishLibraryReports({root:f.root,prefixes:scope}),/running/i);assert.equal(readFileSync(lock,'utf8'),'another writer');assert.equal(read(f.edits,'development/task/report.md'),'# original evidence\n');assert.equal(git(f.remote,'rev-parse','main'),f.revision);
});

test('injected installation failure preserves the active snapshot and original bytes',t=>{
 const root=sandbox(t),cacheRoot=join(root,'cache'),settings={cacheRoot};
 put(root,'original.txt','untouched original');
 const baseline={sourceSha256:'d'.repeat(64),sourceCommit:'b'.repeat(40),dataCommit:'c'.repeat(40),assets:new Map([['assets/first.bin',{bytes:Buffer.from('good first')}],['assets/second.bin',{bytes:Buffer.from('good second')}]])};
 const active=installFrontendSnapshot({root,snapshot:baseline,settings});
 const pointerPath=join(root,'.library-data/frontend-artifacts.json'),pointerBefore=readFileSync(pointerPath);
 const manifestBefore=readFileSync(join(active,'frontend-manifest.json'));
 assert.equal(JSON.parse(pointerBefore).common.directory,active);
 const replacement={...baseline,sourceSha256:'a'.repeat(64),assets:new Map([['assets/first.bin',{bytes:Buffer.from('new first')}],['assets/second.bin',{bytes:Buffer.from('new second')}]])};
 let copied=0;
 assert.throws(()=>installFrontendSnapshot({root,snapshot:replacement,settings,afterFile:file=>{
  copied++;
  assert.equal(read(join(cacheRoot,'frontend',replacement.sourceSha256+'.pending'),file.path),'new first');
  throw Error('injected mid-install failure');
 }}),/injected/);
 assert.equal(copied,1,'failure occurs after the first replacement file is installed');
 assert.equal(read(root,'original.txt'),'untouched original');
 assert.deepEqual(readFileSync(pointerPath),pointerBefore,'the active snapshot reference remains byte-for-byte intact');
 assert.deepEqual(readFileSync(join(active,'frontend-manifest.json')),manifestBefore);
 assert.equal(read(active,'assets/first.bin'),'good first');
 assert.equal(read(active,'assets/second.bin'),'good second');
 assert.equal(existsSync(join(cacheRoot,'frontend',replacement.sourceSha256)),false);
 assert.equal(existsSync(join(cacheRoot,'frontend',replacement.sourceSha256+'.pending/assets/second.bin')),false);
 assert.ok(existsSync(join(cacheRoot,'frontend-install.pending.json')));
});
test('publication refuses diverged remote history rather than overwriting it',t=>{
 const f=publication(t),peer=join(f.base,'peer');git(f.base,'clone','-q','-b','main',f.remote,peer);git(peer,'config','user.name','Peer');git(peer,'config','user.email','peer@example.invalid');put(peer,'remote.txt','new remote original');git(peer,'add','.');git(peer,'commit','-qm','remote change');git(peer,'push','-q','origin','main');const remoteHead=git(f.remote,'rev-parse','main');put(f.data,'local.txt','unfinished local original');git(f.data,'add','.');git(f.data,'commit','-qm','local change');
 assert.throws(()=>publishLibraryReports({root:f.root,prefixes:scope}),/diverged|preserv/i);assert.equal(git(f.remote,'rev-parse','main'),remoteHead);assert.equal(git(f.remote,'show','main:remote.txt'),'new remote original');assert.equal(read(f.data,'local.txt'),'unfinished local original');
});

test('report owners retain independent editions after another owner advances',t=>{
 const path='reports/development/task/report.md',f=fixture(t,{[path]:'# old edition\n'});const old=hydrateReports({root:f.root,path:path.slice(8),access:'read'});assert.equal(readFileSync(old,'utf8'),'# old edition\n');const other=join(f.base,'objects');git(f.root,'worktree','add','-qb','work/objects',other);const next=archive(f.data,{[path]:'# next edition\n'},'next report');put(other,'config/library-data.json',JSON.stringify({...f.config,revision:next.revision}));mkdirSync(join(other,'.library-data'));symlinkSync(f.data,join(other,'.library-data/repository'),process.platform==='win32'?'junction':'dir');const newer=hydrateReports({root:other,path:path.slice(8),access:'read'});
 assert.equal(readFileSync(newer,'utf8'),'# next edition\n');assert.equal(readFileSync(hydrateReports({root:f.root,path:path.slice(8),access:'read'}),'utf8'),'# old edition\n');assert.equal(reportRegistry(f.root).owners.main.revision,f.revision);assert.equal(reportRegistry(other).owners.objects.revision,next.revision);assert.equal(git(f.data,'rev-parse','refs/pando/reports/main'),f.revision);
 const retained='reports/development/task/retained.md',binary='reports/development/task/evidence.bin';
 const parent=archive(f.data,{[path]:'# retirement candidate\n',[retained]:'# retained report\n',[binary]:'unique evidence'},'retirement parent');
 const source='tools/historical-library/source-note.mdx',sharedSource='tools/historical-library/shared-note.markdown',raw='reports/development/task/unindexed.md';
 const manual='docs/task.md',unselected='docs/retained.md';put(f.data,manual,'selected task manual');put(f.data,unselected,'unselected original');
 const orphan='archive/blobs/orphan.gz',shared='archive/blobs/shared.bin',alias='assets/data/retained.bin',sourceBytes=Buffer.from('# archived source');
 const originalIndex=JSON.parse(read(f.data,'archive/index.json'));
 const entry={stored:orphan,encoding:'gzip',bytes:sourceBytes.length,sha256:contentHash(sourceBytes)};
 originalIndex.files[source]=entry;originalIndex.files[sharedSource]={...entry,stored:shared,encoding:'identity'};originalIndex.files[alias]={...originalIndex.files[sharedSource]};
 originalIndex.ownerMetadata={keep:'unchanged'};put(f.data,orphan,gzipSync(sourceBytes));put(f.data,shared,sourceBytes);put(f.data,raw,'unindexed raw report');
 put(f.data,'archive/index.json',JSON.stringify(originalIndex));git(f.data,'add','.');git(f.data,'commit','-qm','archived Markdown variants');parent.revision=git(f.data,'rev-parse','HEAD');
 put(f.data,'unfinished.txt','staged original');git(f.data,'add','unfinished.txt');put(f.data,'unfinished.txt','unstaged original');
 const head=git(f.data,'rev-parse','HEAD'),refs=git(f.data,'show-ref'),working=git(f.data,'status','--porcelain'),staged=git(f.data,'write-tree');
 assert.throws(()=>createReportRetirementCommit({root:f.root,revision:parent.revision,removePaths:[manual]}),/archived source/i);
 assert.throws(()=>createReportRetirementCommit({root:f.root,revision:parent.revision,removePaths:[path],documentationPaths:[manual]}),/documentation/i);
 const result=createReportRetirementCommit({root:f.root,revision:parent.revision,removePaths:[path,source,sharedSource,raw,manual],documentationPaths:[manual]});
 assert.equal(git(f.data,'ls-tree','-r','--name-only',result.revision,'--',manual),'');assert.equal(git(f.data,'show',result.revision+':'+unselected),'unselected original');
 assert.equal(git(f.data,'rev-parse',`${result.revision}^`),parent.revision);
 assert.equal(git(f.data,'ls-tree','-r','--name-only',result.revision,'--',path),'');
 const retired=JSON.parse(git(f.data,'show',`${result.revision}:archive/index.json`));
 assert.equal(retired.files[source],undefined);assert.equal(retired.files[sharedSource],undefined);assert.deepEqual(retired.files[alias],originalIndex.files[alias]);assert.deepEqual(retired.ownerMetadata,originalIndex.ownerMetadata);
 assert.equal(git(f.data,'ls-tree','-r','--name-only',result.revision,'--',orphan,raw),'');assert.equal(git(f.data,'show',result.revision+':'+shared),'# archived source');
 assert.equal(retired.files[path],undefined);assert.deepEqual(retired.files[retained],parent.files[retained]);assert.deepEqual(retired.files[binary],parent.files[binary]);
 assert.equal(git(f.data,'show',`${result.revision}:${retained}`),'# retained report');assert.equal(git(f.data,'show',`${result.revision}:${binary}`),'unique evidence');
 assert.equal(git(f.data,'show',`${parent.revision}:${path}`),'# retirement candidate');
 assert.equal(git(f.data,'rev-parse','HEAD'),head);assert.equal(git(f.data,'show-ref'),refs);assert.equal(git(f.data,'status','--porcelain'),working);assert.equal(git(f.data,'write-tree'),staged);
 assert.equal(read(f.data,'unfinished.txt'),'unstaged original');assert.equal(git(f.data,'show',':unfinished.txt'),'staged original');
 assert.throws(()=>createReportRetirementCommit({root:f.root,revision:parent.revision,removePaths:['../escape.md']}),/path/i);
 assert.throws(()=>createReportRetirementCommit({root:f.root,revision:parent.revision,removePaths:['AGENTS.md']}),/path|protected/i);
 assert.deepEqual(readdirSync(join(f.data,'.pando-store')).filter(name=>name.startsWith('report-retirement-')),[]);
});

test('storing a hydrated report does not delete another unhydrated archive original',t=>{
 const selected='reports/development/task/selected.md',missing='reports/development/task/unhydrated.md',f=fixture(t,{[selected]:'before',[missing]:'preserve unhydrated'});const working=hydrateReports({root:f.root,path:selected.slice(8),access:'write'});writeFileSync(working,'after');assert.equal(existsSync(join(f.root,'reports/development/task/unhydrated.md')),false);storeLibraryData({root:f.root,prefixes:scope});const index=JSON.parse(git(f.data,'show','HEAD:archive/index.json'));assert.deepEqual(index.files[missing],f.files[missing]);assert.equal(git(f.data,'show',`HEAD:${missing}`),'preserve unhydrated');assert.equal(index.files[selected].sha256,contentHash(Buffer.from('after')));
});

test('remote byte verification failure cannot be reported as completed archival',t=>{
 const f=publication(t);publishLibraryReports({root:f.root,prefixes:scope});const corrupt=execFileSync('git',['hash-object','-w','--stdin'],{cwd:f.data,input:'corrupt remote body',encoding:'utf8'}).trim();git(f.data,'update-index','--cacheinfo','100644,'+corrupt+',reports/development/task/report.md');git(f.data,'commit','-qm','out of band corruption');git(f.data,'push','-q','origin','main');assert.throws(()=>checkLibraryReports({root:f.root,prefixes:scope}),/corrupt|mismatch|content|original/i);assert.equal(read(f.edits,'development/task/report.md'),'# original evidence\n');assert.equal(git(f.remote,'show','main:reports/development/task/report.md'),'corrupt remote body');
});

test('Viewer closure rejects missing payloads and private report dependencies',()=>{
 const manifest='assets/data/world/current.json',payload='assets/data/world/objects/current.bin',privateReport='reports/development/private.md';assert.throws(()=>collectRuntimeDataAssets({availablePaths:[manifest],readManifest:()=>({assets:{canonicalMesh:{url:'world/objects/missing.bin'}}})}),/missing/i);assert.throws(()=>collectRuntimeDataAssets({availablePaths:[manifest,privateReport],entryPaths:[privateReport],readManifest:()=>({assets:{}})}),/invalid/i);const selected=collectRuntimeDataAssets({availablePaths:[manifest,payload,privateReport],readManifest:()=>({assets:{canonicalMesh:{url:payload}},source:{url:privateReport}})});assert.deepEqual([...selected].sort(),[manifest,payload].sort());
});

test('failed and blocked checks stop execution before any publication action',async t=>{
 const {executeChecks}=await import('../../scripts/run-application-checks.mjs');const root=sandbox(t),published=join(root,'published.txt'),catalog={groups:[{id:'verify',argv:['node','verify.mjs']},{id:'publish',argv:['node','publish.mjs']}]};let calls=[];
 assert.throws(()=>executeChecks({groups:['verify','publish'],root,catalog,run:argv=>{calls.push(argv);if(calls.length===1)return {status:1};writeFileSync(published,'wrong');return {status:0};}}),/fail|exit|status/i);assert.equal(calls.length,1);assert.equal(existsSync(published),false);calls=[];
 assert.throws(()=>executeChecks({groups:['verify','publish'],root,catalog,run:argv=>{calls.push(argv);return {status:null,error:Error('blocked execution')};}}),/fail|block|status|exit/i);assert.equal(calls.length,1);assert.equal(existsSync(published),false);
});
