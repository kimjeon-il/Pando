import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,mkdirSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {assertRemoteOnlyNativeAllowed,remoteOnlyBranch} from "../../../scripts/lib/remote-only-native-policy.mjs";
import {assertRemoteOnlyNativePreparation} from "../../../scripts/prepare-native-test-tools.mjs";
import {retireUnusedNativeViews,installNativeArtifactView,pruneApplicationBlobs,compilerCacheEnvironment} from "../../../tools/data/worktree-storage.mjs";
import {createHash} from 'node:crypto';
const nativeHash=bytes=>createHash('sha256').update(bytes).digest('hex');

test('Pando-owned native installation and compiler gates fail before side effects outside Actions',()=>{
  const never=()=>{throw Error('git probe should not be called when env opt-in is present')};
  assert.equal(remoteOnlyBranch({environment:{PANDO_REMOTE_ONLY:'1'},probe:never}),true);
  for(const options of [
    {environment:{PANDO_REMOTE_ONLY:'1'},branch:'main'},
    {environment:{},branch:'work/remote-only'},
    {environment:{GITHUB_ACTIONS:'false'},branch:'work/remote-only'},
  ]) {
    assert.throws(()=>assertRemoteOnlyNativeAllowed({...options,operation:'SDK install'}),
      {code:'PANDO_REMOTE_ONLY_NATIVE_CI_REQUIRED'});
    assert.throws(()=>assertRemoteOnlyNativePreparation(options),/PANDO_REMOTE_ONLY_NATIVE_CI_REQUIRED/);
  }
  assert.doesNotThrow(()=>assertRemoteOnlyNativeAllowed({
    branch:'work/remote-only',environment:{GITHUB_ACTIONS:'true'}}));
  assert.doesNotThrow(()=>assertRemoteOnlyNativeAllowed({branch:'work/gis',environment:{}}));
});

function fixture(t,{files=['pandolab-web-shell.exe']}={}) {
  const base=mkdtempSync(join(tmpdir(),'pando-remote-native-retire-'));
  t.after(()=>rmSync(base,{recursive:true,force:true}));
  const app=join(base,'worktree'),source=join(base,'download'),settings={cacheRoot:join(base,'cache')};
  for(const dir of [app,source])mkdirSync(dir,{recursive:true});
  const payloads=files.map((path,i)=>({path,bytes:Buffer.from('immutable verified binary '+i)}));
  const manifest={schema:1,sourceCommit:'a'.repeat(40),platform:'windows',mode:'development',
    nativeInputSha256:'b'.repeat(64),files:payloads.map(({path,bytes})=>
      ({path,bytes:bytes.length,sha256:nativeHash(bytes)}))};
  for(const item of payloads)writeFileSync(join(source,item.path),item.bytes);
  writeFileSync(join(source,'native-artifact.json'),JSON.stringify(manifest));
  const directory=installNativeArtifactView({root:app,source,manifest,settings});
  return {app,source,settings,manifest,directory,
    unpin:()=>writeFileSync(join(app,'.library-data/native-artifacts.json'),'{}\n')};
}
test('referenced immutable native view survives cleanup; unreferenced verified view retires',t=>{
  const f=fixture(t);
  const args={root:f.app,roots:[f.app],settings:f.settings,processes:[]};
  assert.deepEqual(retireUnusedNativeViews(args).entries.map(e=>e.status),['referenced']);
  f.unpin();
  assert.deepEqual(retireUnusedNativeViews(args).entries.map(e=>e.status),['eligible']);
  const result=retireUnusedNativeViews({...args,apply:true});
  assert.deepEqual(result.entries.map(e=>e.status),['removed']);
  assert.equal(existsSync(f.directory),false);
  const blob=join(f.settings.cacheRoot,'blobs',f.manifest.files[0].sha256);
  assert.equal(existsSync(blob),true,'content-addressed blob remains until separate verified GC');
  const cleaned=pruneApplicationBlobs({...args,apply:true});
  assert.equal(cleaned.deletedBytes,f.manifest.files[0].bytes);
  assert.equal(existsSync(blob),false);
});
test('native retirement rejects active consumers and modified/unlisted evidence',t=>{
  const f=fixture(t);f.unpin();const args={root:f.app,roots:[f.app],settings:f.settings,processes:[]};
  assert.throws(()=>retireUnusedNativeViews({...args,processes:[{Name:'pandolab-web-shell.exe'}],apply:true}),
    /Active native/);
  writeFileSync(join(f.directory,'unknown-note.txt'),'private');assert.throws(()=>retireUnusedNativeViews(args),/Unlisted/);
  assert.equal(existsSync(f.directory),true);
});
test('interrupted immutable native view cleanup is journaled and resumable',t=>{
  const f=fixture(t,{files:['pandolab-web-shell.exe','WebView2Loader.dll']});
  f.unpin();const args={root:f.app,roots:[f.app],settings:f.settings,processes:[]};
  assert.throws(()=>retireUnusedNativeViews({...args,apply:true,afterFile:()=>{throw Error('interrupted');}}),
    /interrupted/);
  const journal=join(f.settings.cacheRoot,'native-retirement.pending.json');
  assert.equal(existsSync(journal),true);
  assert.throws(()=>pruneApplicationBlobs({...args,apply:true}),/Pending recovery journal/);
  const recovered=retireUnusedNativeViews({...args,apply:true});
  assert.equal(recovered.entries.at(0).status,'removed');
  assert.equal(existsSync(journal),false);
  assert.equal(existsSync(f.directory),false);
});

test('compiler activation refuses local SDKs before I/O; Windows download uses same entrypoint guard',async t=>{
  const {activateCompilerCache}=await import("../../../tools/data/worktree-storage.mjs");
  const root=mkdtempSync(join(tmpdir(),'pando-entrypoint-guard-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const environment={PANDO_REMOTE_ONLY:'1'};
  await assert.rejects(activateCompilerCache(root,{environment}),{
    code:'PANDO_REMOTE_ONLY_NATIVE_CI_REQUIRED'
  });
  assert.equal(existsSync(new URL("../../../apps/editor/packaged-artifacts.mjs",import.meta.url)),false);
  assert.equal(existsSync(new URL("../../../apps/editor/native-producer.mjs",import.meta.url)),false);
  assert.equal(existsSync(join(root,'build-native')),false);
  assert.equal(existsSync(join(root,'cache')),false);
});
test('checked-in policy marker blocks detached-HEAD native setup without probing Git',t=>{
  const root=mkdtempSync(join(tmpdir(),'pando-detached-remote-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  mkdirSync(join(root,'config'));
  const marker=join(root,'config/remote-only-policy.json');
  writeFileSync(marker,JSON.stringify({schema:'pando-remote-only-policy-v1',
    nativeBuildLocation:'github-actions',localSdkInstallation:false}));
  const never=()=>{throw Error('git probe cannot be used when marker establishes scope');};
  assert.equal(remoteOnlyBranch({root,environment:{},probe:never}),true);
  assert.throws(()=>assertRemoteOnlyNativeAllowed({root,environment:{},probe:never}),
    {code:'PANDO_REMOTE_ONLY_NATIVE_CI_REQUIRED'});
  writeFileSync(marker,JSON.stringify({schema:'unknown'}));
  assert.throws(()=>remoteOnlyBranch({root,environment:{},probe:never}),/Unknown remote-only policy marker/);
});

test('existing compiler cache wrappers are stripped without launching their executable',t=>{
  const root=mkdtempSync(join(tmpdir(),'pando-disabled-compiler-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const settings={cacheRoot:join(root,'cache'),tool:join(root,'missing-sccache.exe')};
  const source={PANDO_REMOTE_ONLY:'1',RUSTC_WRAPPER:settings.tool,
    CMAKE_CXX_COMPILER_LAUNCHER:settings.tool,SCCACHE_DIR:join(settings.cacheRoot,'sccache'),
    SCCACHE_CACHE_SIZE:'2147483648',PATH:'unrelated'};
  const result=compilerCacheEnvironment({root,settings,env:source});
  for(const key of ['RUSTC_WRAPPER','CMAKE_CXX_COMPILER_LAUNCHER','SCCACHE_DIR','SCCACHE_CACHE_SIZE'])
    assert.equal(result[key],undefined,key);
  assert.equal(result.PATH,'unrelated');
  assert.equal(existsSync(settings.cacheRoot),false);
});
