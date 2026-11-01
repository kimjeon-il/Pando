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
    PANDOLAB_NATIVE_BUILD_INFO:Object.freeze({mode:'verification'}),
    __PANDOLAB_SHELL_AUTO__:true,
    __PANDOLAB_SHELL_PROBE_HOLD_MS__:725,
    __PANDOLAB_SHELL_PROBE_PHYSICAL_IMMEDIATE__:true,
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
  assert.deepEqual(adapter.runtime,{verification:true,libraryAvailable:false,autoVerification:true,probeHoldMs:725,physicalImmediate:true,buildInfo:scope.PANDOLAB_NATIVE_BUILD_INFO});
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
  const raw=['__TAURI_INTERNALS__','PANDOLAB_NATIVE_LIBRARY_AVAILABLE','PANDOLAB_SHELL_VERIFICATION','PANDOLAB_NATIVE_BUILD_INFO','__PANDOLAB_SHELL_AUTO__','__PANDOLAB_SHELL_PROBE_HOLD_MS__','__PANDOLAB_SHELL_PROBE_PHYSICAL_IMMEDIATE__'];
  for(const token of raw)assert.match(adapter,new RegExp(token.replaceAll('$','\\$&')));
  for(const path of ['apps/editor/startup.js','apps/editor/native-storage.js','apps/editor/probe-storage.js','apps/editor/full-world-probe.js','apps/editor/verification.js','apps/editor/diagnostics.js','apps/editor/frontend/js/app.js']){
    const source=readFileSync(new URL(path,root),'utf8');
    for(const token of raw)assert.equal(source.includes(token),false,path+' bypasses native-platform-adapter: '+token);
    assert.equal(source.includes('__PANDOLAB_SHELL_PLATFORM__'),false,path+' retains global platform handoff');
  }
});
