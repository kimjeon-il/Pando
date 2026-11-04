import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {wasmCacheIdentity,recordWasmCache,verifyWasmCache,restoreWasmCache} from '../../scripts/remote-only-wasm-cache.mjs';
import {remoteOnlyAcceptanceScope} from '../../scripts/remote-only-ci-scope.mjs';
import {verifyWindowsCache} from '../../scripts/remote-only-windows-cache.mjs';

test('CI source planning skips documentation-only pushes and forces explicit acceptance',()=>{
  assert.equal(remoteOnlyAcceptanceScope(['docs/something.md','README.md']).runHeavy,false);
  assert.equal(remoteOnlyAcceptanceScope(['shared/core/src/document.cpp']).runHeavy,true);
  assert.equal(remoteOnlyAcceptanceScope(['tools/worktree-storage.mjs']).runHeavy,true);
  assert.equal(remoteOnlyAcceptanceScope([],{}).runHeavy,true);
  assert.equal(remoteOnlyAcceptanceScope(['README.md'],{event:'workflow_dispatch'}).runHeavy,true);
  assert.equal(remoteOnlyAcceptanceScope(['README.md'],{baselineKnown:false}).runHeavy,true);
});
function fixture(t){
  const repository=mkdtempSync(join(tmpdir(),'pando-remote-wasm-cache-'));
  t.after(()=>rmSync(repository,{recursive:true,force:true}));
  const put=(path,content)=>{const full=join(repository,path);mkdirSync(dirname(full),{recursive:true});writeFileSync(full,content);};
  put('shared/CMakeLists.txt','project(core)\n');
  put('shared/core/sample.cpp','int old=1;\n');
  put('CMakeLists.txt','cmake_minimum_required(VERSION 3.21)\n');
  put('CMakePresets.json','{"version":3}');
  put('config/toolchain-versions.json',JSON.stringify({emscripten:'6.0.3',emsdkCommit:'a'.repeat(40),cmake:'3.31.6'}));
  put('tools/package-shared-core-assets.mjs','// owner\n');
  put('scripts/remote-only-wasm-cache.mjs','// input identity\n');
  put('.github/workflows/remote-only-gate.yml','name: test\n');
  return {repository,put};
}
test('WASM CI cache is keyed by inputs, verified and restored without re-compilation',async t=>{
  const f=fixture(t),before=wasmCacheIdentity(f.repository);
  const build=join(f.repository,'temporary-build');
  const core={coreAbiVersion:1,coreCompilerVersion:'6.0.3',coreSourceSha256:before.sourceSha256};
  f.put('temporary-build/pandoeditor-core.js','export default async()=>({});\n');
  f.put('temporary-build/pandoeditor-core.wasm',Buffer.from([0,97,115,109,1,0,0,0]));
  const instantiate=async()=>core;
  const directory=join(f.repository,'cache');
  await recordWasmCache({repository:f.repository,build,directory,instantiate});
  await verifyWasmCache({repository:f.repository,directory,instantiate});
  const target=join(f.repository,'restored');
  await restoreWasmCache({repository:f.repository,directory,build:target,instantiate});
  assert.equal(readFileSync(join(target,'pandoeditor-core.js'),'utf8'),
    readFileSync(join(build,'pandoeditor-core.js'),'utf8'));
  f.put('shared/core/sample.cpp','int old=2;\n');
  assert.notEqual(wasmCacheIdentity(f.repository).key,before.key);
  await assert.rejects(verifyWasmCache({repository:f.repository,directory,instantiate}),/input|source/);
});
test('cache cannot reuse tampered WASM bytes even with a retained manifest',async t=>{
  const f=fixture(t),expected=wasmCacheIdentity(f.repository);
  f.put('temporary-build/pandoeditor-core.js','export default async()=>({});\n');
  f.put('temporary-build/pandoeditor-core.wasm',Buffer.from([0,97,115,109,1,0,0,0]));
  const directory=join(f.repository,'cache'),instantiate=async()=>({
    coreAbiVersion:1,coreCompilerVersion:'6.0.3',coreSourceSha256:expected.sourceSha256
  });
  await recordWasmCache({repository:f.repository,build:join(f.repository,'temporary-build'),directory,instantiate});
  writeFileSync(join(directory,'pandoeditor-core.wasm'),Buffer.from([0,97,115,109,1,0,0,1]));
  await assert.rejects(verifyWasmCache({repository:f.repository,directory,instantiate}),/byte hash/);
});
test('Windows remote cache requires a pinned input, exact embedded SHA and verification mode',()=>{
  const identity={platform:'windows',target:'x86_64-pc-windows-msvc',mode:'verification',
    toolchainVersion:'1.99.1',sha256:'b'.repeat(64)};
  const marker={schema:1,sourceCommit:'c'.repeat(40),
    nativeInputSha256:identity.sha256,platform:'windows',target:identity.target,
    mode:identity.mode,toolchainVersion:identity.toolchainVersion,
    files:[{path:'pandolab-web-shell.exe',bytes:3,sha256:'a'.repeat(64)}]};
  const root=mkdtempSync(join(tmpdir(),'pando-win-cache-'));
  try{
    writeFileSync(join(root,'native-artifact.json'),JSON.stringify(marker));
    // Source-matched manifest validation always precedes any executable inspection.
    assert.throws(()=>verifyWindowsCache({repository:root,directory:root,identity,
      sourceCommit:marker.sourceCommit,inspect:()=>({})}),/ENOENT|artifact bytes/);
    writeFileSync(join(root,'pandolab-web-shell.exe'),'abc');
    marker.files[0].sha256=createHash('sha256').update('abc').digest('hex');
    writeFileSync(join(root,'native-artifact.json'),JSON.stringify(marker));
    assert.throws(()=>verifyWindowsCache({repository:root,directory:root,identity,
      sourceCommit:marker.sourceCommit,inspect:()=>({nativeInputSha256:identity.sha256,
        executionMode:'development',sourceCommit:marker.sourceCommit})}),/execution mode/);
    assert.equal(verifyWindowsCache({repository:root,directory:root,identity,
      sourceCommit:marker.sourceCommit,inspect:()=>({nativeInputSha256:identity.sha256,
        executionMode:'verification',sourceCommit:marker.sourceCommit})}).sha256,identity.sha256);
  }finally{rmSync(root,{recursive:true,force:true});}
});
