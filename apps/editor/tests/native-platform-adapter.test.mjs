import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createPlatformPorts } from '../../../shared/frontend/js/modules/platform-ports.js';
import { createNativePlatformAdapter } from '../native-platform-adapter.js';

test('native adapter owns raw shell inputs and binds one explicit invoke transport', async () => {
  const calls=[];
  const scope={
    __TAURI_INTERNALS__:{invoke:async(command,payload)=>{calls.push([command,payload]);return {path:'diagnostic.json'};}},
    PANDOLAB_NATIVE_LIBRARY_AVAILABLE:false,
    PANDOLAB_SHELL_VERIFICATION:true,
    __PANDOLAB_SHELL_AUTO__:true,
    __PANDOLAB_SHELL_PROBE_HOLD_MS__:725,
    location:{search:''},document:{title:'before'},
  };
  let installed=null;
  const loadModule=async url=>{
    if(url.includes('library-geometry-context.js'))return {parseNativeLibraryGeometryRequest:()=>null,createLibraryGeometryContext:()=>assert.fail('no request')};
    if(url.includes('platform-ports.js'))return {createPlatformPorts};
    if(url.includes('platform-runtime.js'))return {installRuntimePlatform:value=>{installed=value;return value;}};
    throw new Error('Unexpected module '+url);
  };
  const adapter=createNativePlatformAdapter({scope,loadModule});
  assert.deepEqual(adapter.runtime,{verification:true,libraryAvailable:false,autoVerification:true,probeHoldMs:725});
  await adapter.writeDiagnosticReport({ok:true});
  assert.deepEqual(calls,[['write_diagnostic_report',{report:{ok:true}}]]);
  const platform=await adapter.preparePlatform({
    profile:{mode:'map-data',platform:{resources:{builtinHydro:true,builtinPlaces:true,startupMesh:'builtin'},storage:{namespace:'native-test'}}},
    meta:{appVersion:'0.36.0'},versionedAsset:path=>({href:path}),install:true,
  });
  assert.equal(platform.kind,'native');assert.equal(platform.files.access,adapter.storage);assert.equal(platform.storage.namespace,'native-test');
  assert.equal(installed,platform);
  assert.doesNotThrow(()=>adapter.assertVerification(true,true));
  assert.throws(()=>adapter.assertVerification(false,true),/Verification assets/);
});

test('raw native globals occur only in the native platform adapter runtime', () => {
  const root=new URL('../../../',import.meta.url);
  const adapter=readFileSync(new URL('apps/editor/native-platform-adapter.js',root),'utf8');
  const raw=['__TAURI_INTERNALS__','PANDOLAB_NATIVE_LIBRARY_AVAILABLE','PANDOLAB_SHELL_VERIFICATION','__PANDOLAB_SHELL_AUTO__','__PANDOLAB_SHELL_PROBE_HOLD_MS__'];
  const retired=['PANDOLAB_NATIVE_BUILD_INFO','__PANDOLAB_SHELL_PROBE_PHYSICAL_IMMEDIATE__'];
  for(const token of raw)assert.match(adapter,new RegExp(token.replaceAll('
  for(const path of ['apps/editor/startup.js','apps/editor/native-storage.js','apps/editor/probe-storage.js','apps/editor/full-world-probe.js','apps/editor/verification.js','apps/editor/diagnostics.js','apps/editor/frontend/js/app.js']){
    const source=readFileSync(new URL(path,root),'utf8');
    for(const token of raw)assert.equal(source.includes(token),false,path+' bypasses native-platform-adapter: '+token);
    assert.equal(source.includes('__PANDOLAB_SHELL_PLATFORM__'),false,path+' retains global platform handoff');
  }
});
,'\\  for(const token of raw)assert.match(adapter,new RegExp(token.replaceAll('$','\\$&')));')));
  for(const token of retired)assert.equal(adapter.includes(token),false,'retired adapter input: '+token);
  const shell=readFileSync(new URL('apps/editor/src-tauri/src/lib.rs',root),'utf8');
  for(const token of retired)assert.equal(shell.includes(token),false,'retired shell injection: '+token);
  for(const path of ['apps/editor/startup.js','apps/editor/native-storage.js','apps/editor/probe-storage.js','apps/editor/full-world-probe.js','apps/editor/verification.js','apps/editor/diagnostics.js','apps/editor/frontend/js/app.js']){
    const source=readFileSync(new URL(path,root),'utf8');
    for(const token of raw)assert.equal(source.includes(token),false,path+' bypasses native-platform-adapter: '+token);
    assert.equal(source.includes('__PANDOLAB_SHELL_PLATFORM__'),false,path+' retains global platform handoff');
  }
});


test('retired T7 shell inputs and physical A-B benchmark stay removed', () => {
  const root=new URL('../../../',import.meta.url);
  const runtimeOptions=readFileSync(new URL('apps/editor/src-tauri/src/runtime_options.rs',root),'utf8');
  const shell=readFileSync(new URL('apps/editor/src-tauri/src/lib.rs',root),'utf8');
  const measure=readFileSync(new URL('apps/editor/measure-windows-startup.ps1',root),'utf8');
  const workflow=readFileSync(new URL('.github/workflows/integration-windows-startup-memory-20261016.yml',root),'utf8');
  const performance=readFileSync(new URL('config/performance-baseline-v1.json',root),'utf8');
  assert.doesNotMatch(runtimeOptions,/physical_immediate/);
  assert.match(runtimeOptions,/--probe-physical-immediate/);
  assert.doesNotMatch(shell,/PANDOLAB_NATIVE_BUILD_INFO|__PANDOLAB_SHELL_PROBE_PHYSICAL_IMMEDIATE__/);
  assert.match(shell,/NATIVE_BUILD_INFO/);
  assert.doesNotMatch(measure,/paired|physicalDeferredUntilReady|\bimmediate\b|\bdeferred\b/);
  assert.match(measure,/pandolab-windows-webview-startup-memory/);
  assert.match(workflow,/buildNativeOnCI/);
  assert.match(workflow,/startup-memory\.json/);
  assert.match(performance,/windows-webview-startup-memory/);
  assert.match(performance,/integration-windows-startup-memory-20261016\.yml/);
});
