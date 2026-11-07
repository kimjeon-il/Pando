import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import test from 'node:test';
import {selectNativeBuilds} from '../../scripts/lib/check-changes.mjs';

const read=path=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');
const exists=path=>existsSync(new URL('../../'+path,import.meta.url));

test('retired P1 and P3 workflows cannot be selected instead of the shared Core owner',()=>{
 for(const path of ['remote-development-p1.yml','remote-preview-p3.yml','p6-preflight.yml'])
  assert.equal(exists('.github/workflows/'+path),false,path);
 const shared=read('.github/workflows/shared-core.yml');
 assert.match(shared,/native-branch-core:/);
 assert.match(shared,/native-branch-gis:/);
 assert.match(shared,/ctest --preset pando-core/);
 const checks=JSON.parse(read('scripts/contracts/application-checks.json'));
 const native=checks.externalChecks.find(x=>x.id==='native-core');
 assert.equal(native.workflow,'.github/workflows/shared-core.yml');
 assert.equal(native.job,'native-branch-core');
});

test('unrelated GIS JavaScript edits do not trigger a native or WASM build',()=>{
 for(const path of ['tools/gis/build-hydro.mjs','tools/gis/hydro-generation-manifest.mjs']){
  assert.deepEqual(selectNativeBuilds([path]),{core:false,gis:false,wasm:false});
 }
 assert.deepEqual(selectNativeBuilds(['tools/cpp/hydro/point-screen.cpp']),{core:false,gis:true,wasm:false});
 assert.deepEqual(selectNativeBuilds(['shared/core/src/project.cpp']),{core:true,gis:false,wasm:false});
});

test('application and native Core contracts do not install GIS Python test suites',()=>{
 const scripts=JSON.parse(read('package.json')).scripts;
 for(const name of ['test','check:versioning','check:architecture'])
  assert.doesNotMatch(scripts[name],/\bpython(?:3)?\b|test:python|test:gis-python/);
 for(const workflow of ['shared-core.yml','application-architecture.yml']){
  const body=read('.github/workflows/'+workflow);
  assert.doesNotMatch(body,/setup-python|python -m pip|python -m unittest|python -m compileall/);
 }
});
