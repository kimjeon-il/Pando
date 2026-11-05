import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
const exists=path=>existsSync(new URL('../../'+path,import.meta.url));
const read=path=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');
test('Windows Tauri/Rust build inputs and CLI are gone; Web engine remains',()=>{
  for(const path of ['apps/editor/src-tauri/Cargo.toml','apps/editor/src-tauri/Cargo.lock',
    'apps/editor/src-tauri/build.rs','apps/editor/src-tauri/src/main.rs',
    'apps/editor/native-producer.mjs','apps/editor/packaged-artifacts.mjs',
    'apps/editor/dev.mjs','scripts/remote-only-windows-cache.mjs','config/native-artifacts.json'])
    assert.equal(exists(path),false,path);
  const root=JSON.parse(read('package.json')),stage=JSON.parse(read('apps/editor/package.json'));
  for(const key of ['dev:windows','build:windows'])assert.equal(Object.hasOwn(root.scripts,key),false,key);
  assert.equal(Object.hasOwn(stage.devDependencies||{},'@tauri-apps/cli'),false);
  for(const key of ['build:windows','test:native','dev:windows','build:verification:windows'])
    assert.equal(Object.hasOwn(stage.scripts,key),false,key);
  assert.equal(exists('shared/core/src/geometrypredicates.cpp'),true);
  assert.equal(exists('shared/frontend/static/wasm/pandoeditor-core.wasm'),true);
});
test('remote-only CI has no Windows runners and preserves C++/GIS/WASM',()=>{
  for(const path of ['.github/workflows/remote-development-p1.yml',
    '.github/workflows/remote-only-gate.yml']){
    const source=read(path);
    assert.doesNotMatch(source,/windows-2022|rust-toolchain|native-artifact:|windows-real-webview2:|--ci-build/);
  }
  for(const path of ['.github/workflows/e5-windows-review-acceptance.yml',
    '.github/workflows/e6-retirement-acceptance.yml',
    '.github/workflows/e7-final-readonly-regression.yml'])
    assert.equal(exists(path),false,path);
  assert.match(read('.github/workflows/remote-only-gate.yml'),/wasm-compile-and-smoke:/);
  assert.match(read('.github/workflows/remote-only-gate.yml'),/viewer-map-integration:/);
});
