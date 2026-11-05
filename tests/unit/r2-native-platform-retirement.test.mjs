import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {parse} from 'yaml';
const exists=path=>existsSync(new URL('../../'+path,import.meta.url));
const read=path=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');
test('Retired Windows editor inputs are absent while Web engine remains',()=>{
  for(const path of ['apps/editor/src-tauri/Cargo.toml','apps/editor/src-tauri/Cargo.lock',
    'apps/editor/src-tauri/build.rs','apps/editor/src-tauri/src/main.rs',
    'apps/editor/native-producer.mjs','apps/editor/packaged-artifacts.mjs',
    'apps/editor/dev.mjs','scripts/remote-only-windows-cache.mjs','config/native-artifacts.json'])
    assert.equal(exists(path),false,path);
  const root=JSON.parse(read('package.json'));
  for(const key of ['dev:windows','build:windows'])assert.equal(Object.hasOwn(root.scripts,key),false,key);
  assert.equal(Object.hasOwn(root.scripts,'dev:editor'),false);
});
test('remote-only CI has no Windows runners and preserves C++/GIS/WASM',()=>{
  for(const path of ['.github/workflows/remote-development-p1.yml',
    '.github/workflows/remote-only-gate.yml']){
    const workflow=parse(read(path));
    for(const [id,job] of Object.entries(workflow.jobs)){
      assert.equal(['native-artifact','windows-real-webview2'].includes(id),false,id);
      for(const runner of [job['runs-on']].flat())assert.doesNotMatch(runner,/windows-/i);
      for(const step of job.steps||[]){
        assert.doesNotMatch(step.uses||'',/rust-toolchain/i);
        assert.doesNotMatch(step.run||'',/^\s*node apps\/editor\/packaged-artifacts\.mjs\b[^\n]*--ci-build/m);
      }
    }
  }
  for(const path of ['.github/workflows/e5-windows-review-acceptance.yml',
    '.github/workflows/e6-retirement-acceptance.yml',
    '.github/workflows/e7-final-readonly-regression.yml'])
    assert.equal(exists(path),false,path);
  assert.match(read('.github/workflows/remote-only-gate.yml'),/wasm-compile-and-smoke:/);
  assert.match(read('.github/workflows/remote-only-gate.yml'),/viewer-map-integration:/);
});
