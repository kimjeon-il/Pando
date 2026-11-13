import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, statSync, chmodSync, existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { compilerCacheEnvironment, assertCompilerCacheServer, pruneApplicationBlobs, shareRetiredQtRuntimes, parseAvailableWorktrees } from "../../../tools/data/worktree-storage.mjs";
import { contentHash, contentFiles, publishContent } from "../../../tools/data/library-content.mjs";
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function fixture(t){const root=mkdtempSync(join(tmpdir(),'pando-worktree-storage-'));t.after(()=>{for(const file of contentFiles(root))chmodSync(file.path,0o600);rmSync(root,{recursive:true,force:true});});return root;}
test('storage inventory skips only missing worktrees that Git marks prunable',()=>{
 const listing='worktree /present\nHEAD 123\nbranch refs/heads/main\n\nworktree /missing\nHEAD 456\ndetached\nprunable gitdir file points to non-existent location\n\n';
 assert.deepEqual(parseAvailableWorktrees(listing,p=>p.endsWith('present')), [resolve('/present')]);
 assert.throws(()=>parseAvailableWorktrees('worktree /missing\nHEAD 456\n\n',()=>false),/missing/i);
});
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
  const root=fixture(t), script=fileURLToPath(new URL("../../../tools/data/worktree-storage.mjs",import.meta.url));
  const result=spawnSync(process.execPath,[script,`--root=${root}`,'--with-compiler-cache','--',process.execPath,'-e','process.exit(7)'],{encoding:'utf8'});
  assert.equal(result.status,7,result.stderr);
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
test('blob pruning never deletes the sole content referenced by either pending migration journal',t=>{
  const root=fixture(t),settings={cacheRoot:join(root,'cache')},blob=publishContent({root:settings.cacheRoot,blobDirectory:'blobs'},Buffer.from('only recoverable SDK'));
  for(const name of ['migration.pending.json','runtime-migration.pending.json','generated-retirement.pending.json','app-git-compaction.pending.json']){
    const journal=join(settings.cacheRoot,name);writeFileSync(journal,JSON.stringify({schema:'pando-worktree-storage-v1',entry:{sha256:blob.sha256}}));
    assert.throws(()=>pruneApplicationBlobs({root,roots:[root],settings,processes:[],apply:true}),/pending|journal|recovery/i);
    assert.equal(readFileSync(blob.path,'utf8'),'only recoverable SDK');assert.ok(existsSync(journal));unlinkSync(journal);
  }
});

// Retirement is observable at the module and CLI boundaries.
test('retired editor staging is absent from the storage API',async()=>{
 const api=await import('../../../tools/data/worktree-storage.mjs');
 for(const name of ['editorStageRoot','writeStagedContent','removeStagedDirectory','previewWorktreeStorage','applyWorktreeStorage'])assert.equal(name in api,false,name);
});
test('storage CLI requires an explicit current operation',t=>{
 const root=fixture(t),script=fileURLToPath(new URL('../../../tools/data/worktree-storage.mjs',import.meta.url));
 for(const flag of ['', '--apply', '--resume']){
  const child=spawnSync(process.execPath,[script,'--root='+root,...(flag?[flag]:[])],{encoding:'utf8'});
  assert.notEqual(child.status,0);assert.match(child.stderr,/explicit storage operation/i);
 }
});
test('blob pruning preserves modified bytes and blocks current preparation locks',t=>{
 const root=fixture(t),settings={cacheRoot:join(root,'cache')};
 const blob=publishContent({root:settings.cacheRoot,blobDirectory:'blobs'},Buffer.from('original'));
 chmodSync(blob.path,0o600);writeFileSync(blob.path,'changed');
 const options={root,roots:[root],settings,processes:[],apply:true};
 assert.equal(pruneApplicationBlobs(options).deletedBytes,0);assert.equal(readFileSync(blob.path,'utf8'),'changed');
 mkdirSync(join(root,'.library-data'));writeFileSync(join(root,'.library-data/prepare.lock'),'active');
 assert.throws(()=>pruneApplicationBlobs(options),/prepar|lock/i);
});
