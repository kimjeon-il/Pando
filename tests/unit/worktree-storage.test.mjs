import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, statSync, chmodSync, existsSync, unlinkSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { editorStageRoot, compilerCacheEnvironment, assertCompilerCacheServer, writeStagedContent, removeStagedDirectory, previewWorktreeStorage, applyWorktreeStorage, pruneApplicationBlobs, shareRetiredQtRuntimes } from '../../tools/worktree-storage.mjs';
import { contentHash, contentFiles, publishContent } from '../../tools/library-content.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function fixture(t){const root=mkdtempSync(join(tmpdir(),'pando-worktree-storage-'));t.after(()=>{for(const file of contentFiles(root))chmodSync(file.path,0o600);rmSync(root,{recursive:true,force:true});});return root;}
test('unconfigured hosts preserve current compiler and incremental environment',t=>{
  const root=fixture(t),env={PATH:'existing',CARGO_INCREMENTAL:'1',RUSTC_WRAPPER:'other-wrapper'};
  assert.deepEqual(compilerCacheEnvironment({root,env,settings:null}),env);
});
test('activated compiler cache verifies its tool and preserves branch target and incremental state',t=>{
  const root=fixture(t),tool=join(root,'sccache.exe');writeFileSync(tool,'verified fixture');
  const settings={schema:'pando-worktree-storage-v1',cacheRoot:join(root,'cache'),tool,toolSha256:contentHash(readFileSync(tool)),port:42427};
  const env=compilerCacheEnvironment({root,settings,env:{CARGO_INCREMENTAL:'1',CARGO_TARGET_DIR:'branch-target'}});
  assert.equal(env.RUSTC_WRAPPER,tool);assert.equal(env.EM_COMPILER_WRAPPER,tool);
  assert.equal(env.CARGO_INCREMENTAL,'1');assert.equal(env.CARGO_TARGET_DIR,'branch-target');
  assert.equal(env.SCCACHE_CACHE_SIZE,'2147483648');assert.equal(env.SCCACHE_SERVER_PORT,'42427');
  assert.throws(()=>compilerCacheEnvironment({root,settings,env:{RUSTC_WRAPPER:'another'}}),/conflict/i);
  assert.throws(()=>compilerCacheEnvironment({root,settings,env:{SCCACHE_DIR:'another'}}),/conflict/i);
  writeFileSync(tool,'corrupted');assert.throws(()=>compilerCacheEnvironment({root,settings,env:{}}),/integrity/i);
});
test('compiler server ownership uses an exact cache directory rather than a matching prefix',()=>{
  const settings={version:'0.19.0',cacheRoot:'D:/build/cache/pandolab'};
  const stats={version:'0.19.0',max_cache_size:2147483648,basedirs:[],cache_location:'Local disk: "D:\\\\build\\\\cache\\\\pandolab\\\\sccache"'};
  assert.doesNotThrow(()=>assertCompilerCacheServer(settings,stats));
  assert.throws(()=>assertCompilerCacheServer(settings,{...stats,cache_location:'Local disk: "D:\\\\build\\\\cache\\\\pandolab\\\\sccache-other"'}),/ownership|configuration/);
});
test('explicit compiler command forwards its exit status without shell interpolation',t=>{
  const root=fixture(t), script=fileURLToPath(new URL('../../tools/worktree-storage.mjs',import.meta.url));
  const result=spawnSync(process.execPath,[script,`--root=${root}`,'--with-compiler-cache','--',process.execPath,'-e','process.exit(7)'],{encoding:'utf8'});
  assert.equal(result.status,7,result.stderr);
});
test('owned staging shares IDs, rejects writes, and removing a stage protects other views',t=>{
  const root=fixture(t),settings={cacheRoot:join(root,'cache')},roots=[join(root,'a'),join(root,'b')];
  for(const app of roots){const directory=join(editorStageRoot(app,settings),'dist');mkdirSync(directory,{recursive:true});writeFileSync(join(directory,'.pandolab-web-shell-stage'),'owned');
    writeStagedContent({root:app,directory,path:'data.bin',bytes:Buffer.from('original'),settings});}
  const [a,b]=roots.map(x=>join(editorStageRoot(x,settings),'dist/data.bin'));
  assert.equal(statSync(a,{bigint:true}).ino,statSync(b,{bigint:true}).ino);assert.throws(()=>writeFileSync(a,'unsafe'));
  removeStagedDirectory({root:roots[0],directory:join(editorStageRoot(roots[0],settings),'dist'),settings});
  assert.equal(existsSync(a),false);assert.equal(readFileSync(b,'utf8'),'original');assert.equal(statSync(b).mode&0o200,0);
  assert.throws(()=>writeStagedContent({root:roots[1],directory:join(roots[1],'elsewhere'),path:'file',bytes:Buffer.from('unsafe'),settings}),/owned|stage/i);
});
test('cleanup applies only evidence-matching idle stage files and resumes an interrupted conversion',t=>{
  const root=fixture(t),app=join(root,'app'),settings={cacheRoot:join(root,'cache')},directory=join(editorStageRoot(app,settings),'dist');
  mkdirSync(directory,{recursive:true});writeFileSync(join(directory,'.pandolab-web-shell-stage'),'owned');
  writeFileSync(join(directory,'same.bin'),'original');writeFileSync(join(directory,'changed.bin'),'private change');
  mkdirSync(join(directory,'shell'));writeFileSync(join(directory,'shell/stage-evidence.json'),JSON.stringify({schema:'pandolab-web-shell-stage',files:[
    {path:'same.bin',bytes:8,sha256:contentHash(Buffer.from('original')),root:'outside',directory:'outside'},{path:'changed.bin',bytes:8,sha256:contentHash(Buffer.from('original'))}]}));
  const options={root:app,roots:[app],settings,processes:[]};
  const preview=previewWorktreeStorage(options);assert.equal(preview.entries.filter(x=>x.status==='eligible').length,1);
  assert.equal(statSync(join(directory,'same.bin')).nlink,1);
  assert.throws(()=>applyWorktreeStorage({...options,afterPrepared:()=>{unlinkSync(join(directory,'same.bin'));throw Error('interruption');}}),/interruption/);
  assert.ok(existsSync(join(settings.cacheRoot,'migration.pending.json')));
  const result=applyWorktreeStorage(options);assert.equal(result.recovered.path,'same.bin');assert.equal(result.entries.filter(x=>x.status==='already-shared').length,1);
  assert.equal(existsSync(join(settings.cacheRoot,'migration.pending.json')),false);
  assert.equal(readFileSync(join(directory,'changed.bin'),'utf8'),'private change');
  assert.equal(previewWorktreeStorage(options).entries.filter(x=>x.status==='eligible').length,0);
  writeFileSync(join(editorStageRoot(app,settings),'.stage-lock'),'active');
  assert.match(previewWorktreeStorage(options).entries[0].reason,/active/i);
});
test('staging reuses archived immutable bytes even when its live runtime edition has changed',t=>{
  const root=fixture(t),settings={cacheRoot:join(root,'cache')},directory=join(editorStageRoot(root,settings),'dist');
  mkdirSync(directory,{recursive:true});writeFileSync(join(directory,'.pandolab-web-shell-stage'),'owned');
  mkdirSync(join(root,'config'));writeFileSync(join(root,'config/library-data.json'),JSON.stringify({repository:'fixture/data',revision:'a'.repeat(40),mounts:['assets/data']}));
  writeStagedContent({root,directory,path:'old-edition.bin',bytes:Buffer.from('archived edition'),settings});
  const shared=join(root,'.library-data/repository');const blob=publishContent(shared,Buffer.from('archived edition'));
  writeStagedContent({root,directory,path:'old-edition.bin',bytes:Buffer.from('archived edition'),source:'assets/data/older.bin',settings});
  assert.equal(statSync(join(directory,'old-edition.bin'),{bigint:true}).ino,statSync(blob.path,{bigint:true}).ino);
  assert.equal(statSync(blob.path).mode&0o200,0);
});
test('cross-store migration preserves a peer whose hardlink ctime changes, then removes only orphan blobs',t=>{
  const root=fixture(t),settings={cacheRoot:join(root,'cache')},roots=[join(root,'a'),join(root,'b')],shared=join(root,'library');
  const bytes=Buffer.from('archived bytes'),sha256=contentHash(bytes);
  for(const app of roots){
    const directory=join(editorStageRoot(app,settings),'dist');mkdirSync(join(directory,'shell'),{recursive:true});writeFileSync(join(directory,'.pandolab-web-shell-stage'),'owned');
    writeStagedContent({root:app,directory,path:'data.bin',bytes,settings});
    writeFileSync(join(directory,'shell/stage-evidence.json'),JSON.stringify({schema:'pandolab-web-shell-stage',files:[{path:'data.bin',sourcePath:'assets/data/old.bin',bytes:bytes.length,sha256}]}));
    mkdirSync(join(app,'config'),{recursive:true});writeFileSync(join(app,'config/library-data.json'),JSON.stringify({repository:'fixture/data',revision:'b'.repeat(40),mounts:['assets/data']}));
    mkdirSync(join(app,'.library-data'),{recursive:true});mkdirSync(shared,{recursive:true});symlinkSync(shared,join(app,'.library-data/repository'),'junction');
  }
  try{
    const blob=publishContent(shared,bytes),result=applyWorktreeStorage({root:roots[0],roots,settings,processes:[]});
    assert.equal(result.entries.filter(x=>x.status==='shared').length,2);
    for(const app of roots)assert.equal(statSync(join(editorStageRoot(app,settings),'dist/data.bin'),{bigint:true}).ino,statSync(blob.path,{bigint:true}).ino);
    const retained=publishContent({root:settings.cacheRoot,blobDirectory:'blobs'},Buffer.from('unreferenced'));
    const preview=pruneApplicationBlobs({root:roots[0],roots,settings,processes:[]});assert.equal(preview.deletedBytes,0);assert.ok(existsSync(retained.path));
    const removed=pruneApplicationBlobs({root:roots[0],roots,settings,processes:[],apply:true});assert.equal(removed.deletedBytes,bytes.length+12);
    assert.ok(existsSync(blob.path));assert.equal(statSync(blob.path).mode&0o200,0);
  }finally{for(const app of roots)unlinkSync(join(app,'.library-data/repository'));}
});
test('retired Qt SDK views share exact bytes while unknown owners and executable-bearing views remain protected',t=>{
  const root=fixture(t),settings={cacheRoot:join(root,'cache')};
  const views=['qt-pair-9bd078c7','qt-pair-ad3ba73b-baseline','qt-pair-b81c6173-candidate'].map(x=>join(root,'build-native/p9',x,'qt-runtime'));
  for(const directory of views){mkdirSync(directory,{recursive:true});writeFileSync(join(directory,'Qt6Core.dll'),'same SDK bytes');}
  for(const directory of views.slice(0,2))writeFileSync(join(directory,'source-identity.json'),JSON.stringify({qtVersion:'6.8.3',binaries:{baseline:{file:'baseline-ui_tests.exe'}}}));
  const result=shareRetiredQtRuntimes({root,roots:[root],settings,processes:[],apply:true});
  assert.equal(result.entries.filter(x=>x.status==='shared').length,2);
  assert.equal(statSync(join(views[0],'Qt6Core.dll'),{bigint:true}).ino,statSync(join(views[1],'Qt6Core.dll'),{bigint:true}).ino);
  assert.equal(statSync(join(views[2],'Qt6Core.dll')).nlink,1);
  const retired=shareRetiredQtRuntimes({root,roots:[root],settings,processes:[],apply:true,retire:true});
  assert.equal(retired.entries.filter(x=>x.status==='removed-runtime').length,2);
  assert.equal(existsSync(views[0]),false);assert.equal(existsSync(views[1]),false);
  mkdirSync(views[0],{recursive:true});writeFileSync(join(views[0],'source-identity.json'),JSON.stringify({qtVersion:'6.8.3',binaries:{baseline:{file:'baseline-ui_tests.exe'}}}));
  writeFileSync(join(views[0],'baseline-ui_tests.exe'),'still needed');
  assert.ok(shareRetiredQtRuntimes({root,roots:[root],settings,processes:[]}).entries.some(x=>/executable/i.test(x.reason||'')));
});
test('actual process termination releases only its dead-owned migration stage lease on resume',t=>{
  const root=fixture(t),settings={cacheRoot:join(root,'cache')},directory=join(editorStageRoot(root,settings),'dist'),bytes=Buffer.from('resume bytes');
  mkdirSync(join(directory,'shell'),{recursive:true});writeFileSync(join(directory,'.pandolab-web-shell-stage'),'owned');writeFileSync(join(directory,'data.bin'),bytes);
  writeFileSync(join(directory,'shell/stage-evidence.json'),JSON.stringify({schema:'pandolab-web-shell-stage',files:[{path:'data.bin',bytes:bytes.length,sha256:contentHash(bytes)}]}));
  const script=new URL('../../tools/worktree-storage.mjs',import.meta.url).href,options={root,roots:[root],settings,processes:[]};
  const child=spawnSync(process.execPath,['--input-type=module','-e',`const {applyWorktreeStorage}=await import(${JSON.stringify(script)});applyWorktreeStorage({...${JSON.stringify(options)},afterPrepared(){process.exit(77)}});`],{encoding:'utf8'});
  assert.equal(child.status,77,child.stderr);const lease=join(editorStageRoot(root,settings),'.stage-lock');assert.ok(existsSync(lease));
  const result=applyWorktreeStorage(options);assert.equal(result.recovered.path,'data.bin');assert.equal(existsSync(lease),false);assert.equal(readFileSync(join(directory,'data.bin'),'utf8'),'resume bytes');
  writeFileSync(lease,JSON.stringify({schema:'pando-worktree-stage-migration-v1',pid:process.pid,root,operation:'share immutable stage'}));
  applyWorktreeStorage(options);assert.ok(existsSync(lease),'live owner must stay');
  writeFileSync(lease,'unknown writer');applyWorktreeStorage(options);assert.equal(readFileSync(lease,'utf8'),'unknown writer');
});
test('blob pruning never deletes the sole content referenced by either pending migration journal',t=>{
  const root=fixture(t),settings={cacheRoot:join(root,'cache')},blob=publishContent({root:settings.cacheRoot,blobDirectory:'blobs'},Buffer.from('only recoverable SDK'));
  for(const name of ['migration.pending.json','runtime-migration.pending.json','generated-retirement.pending.json','app-git-compaction.pending.json']){
    const journal=join(settings.cacheRoot,name);writeFileSync(journal,JSON.stringify({schema:'pando-worktree-storage-v1',entry:{sha256:blob.sha256}}));
    assert.throws(()=>pruneApplicationBlobs({root,roots:[root],settings,processes:[],apply:true}),/pending|journal|recovery/i);
    assert.equal(readFileSync(blob.path,'utf8'),'only recoverable SDK');assert.ok(existsSync(journal));unlinkSync(journal);
  }
});
