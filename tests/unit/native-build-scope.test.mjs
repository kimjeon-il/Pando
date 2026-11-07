import assert from 'node:assert/strict';
import test from 'node:test';
import {selectNativeBuilds,pinnedToolchain} from '../../scripts/lib/check-changes.mjs';

test('toolchain pins agree with Node and frozen package manager',()=>{
  const pinned=pinnedToolchain();
  assert.ok(pinned.cmake);
  assert.ok(pinned.emscripten);
  assert.match(pinned.emsdkCommit,/^[a-f0-9]{40}$/);
  assert.throws(()=>pinnedToolchain(process.cwd(),'0.0.0'),/PINNED_TOOLCHAIN_NODE_MAJOR/);
});
test('Core and GIS changes select native builds without repeating WASM publication',()=>{
  const core=selectNativeBuilds(['shared/core/src/document.cpp']);
  assert.deepEqual(core,{core:true,gis:false,wasm:false});
  assert.deepEqual(selectNativeBuilds(['tools/cpp/hydro/connectivity.cpp']),
    {core:false,gis:true,wasm:false});
  assert.deepEqual(selectNativeBuilds(['CMakePresets.json']),
    {core:true,gis:true,wasm:false});
  assert.deepEqual(selectNativeBuilds(['.devcontainer/start-preview.sh','README.md']),
    {core:false,gis:false,wasm:false});
});
test('manual native targets are focused and invalid targets fail closed',()=>{
  assert.deepEqual(selectNativeBuilds([],'native-core'),{core:true,gis:false,wasm:false});
  assert.deepEqual(selectNativeBuilds([],'native-gis'),{core:false,gis:true,wasm:false});
  assert.deepEqual(selectNativeBuilds([],'native-all'),{core:true,gis:true,wasm:false});
  assert.throws(()=>selectNativeBuilds([],'unknown'),/Unknown native build scope/);
});
