import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { classifyPaths } from '../../scripts/p1-plan-remote-checks.mjs';

const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
test('general Web tests and versioning use only Node; old Python suite remains explicit',()=>{
  const scripts=JSON.parse(read('package.json')).scripts;
  assert.ok(scripts['test:gis-python'].includes('python -m unittest'));
  for(const name of ['test','check:versioning','check:architecture'])
    assert.doesNotMatch(scripts[name],/\bpython(?:3)?\b|test:python|test:gis-python/,
      'Normal '+name+' must not invoke Python');
  assert.match(scripts['check:versioning'],/versioning-source-schema\.test\.mjs/);
});
test('normal Qt CMake config registers no Python tests and has no mandatory interpreter',()=>{
  const source=read('native/app/CMakeLists.txt');
  assert.match(source,/option\(PANDOEDITOR_ENABLE_PYTHON_ORACLES [^\n]+ OFF\)/);
  assert.match(source,/if\(BUILD_TESTING AND PANDOEDITOR_ENABLE_PYTHON_ORACLES\)\s+find_package\(Python3 REQUIRED COMPONENTS Interpreter\)/);
  assert.equal((source.match(/find_package\(Python3/g)||[]).length,1);
  assert.doesNotMatch(source,/if\(Python3_Interpreter_FOUND\)/);
  assert.match(source,/if\(BUILD_TESTING AND PANDOEDITOR_ENABLE_PYTHON_ORACLES\)\s+add_test\(NAME m974_regression_gate_tests/);
  assert.match(source,/if\(BUILD_TESTING AND PANDOEDITOR_ENABLE_PYTHON_ORACLES\)\s+add_test\(NAME m974_boundary_delivery_tests/);
  const river=read('native/tools/m97/river-kernel.test.mjs');
  assert.match(river,/skip: process\.env\.PANDOEDITOR_ENABLE_PYTHON_ORACLES !== '1'/);
});
test('normal Web/Qt CI jobs cannot install Python or execute GIS Python tests',()=>{
  for(const wf of ['remote-development-p1.yml','remote-preview-p3.yml','application-architecture.yml']){
    const source=read('.github/workflows/'+wf);
    assert.doesNotMatch(source,/setup-python|python -m pip|python -m unittest|python -m compileall/,
      wf+' must have no Python install/calls');
    assert.doesNotMatch(source,/^\s+python-contracts:|^\s+python-source:|^\s+historical-geometry:/m,
      wf+' must not contain an isolated GIS job');
  }
});
test('raw Python GIS inputs only run from the dedicated opt-in workflow and CLI',()=>{
  const wf=read('.github/workflows/gis-python-p4.yml');
  assert.match(wf,/workflow_dispatch:/);
  assert.match(wf,/python-syntax:/);
  assert.match(wf,/python-contracts:/);
  assert.match(wf,/historical-geometry:/);
  assert.doesNotMatch(wf,/^\s+schedule:/m);
  assert.ok(wf.includes("github.event_name == 'workflow_dispatch'"));
  const cli=read('scripts/gis/run-source.py');
  assert.match(cli,/add_argument\("--execute", action="store_true"/);
  assert.match(cli,/if not namespace\.execute:\s+return 0/);
  assert.match(cli,/subprocess\.run\(command, cwd=REPO, check=False\)/);
});
test('Python-only GIS edits select no standard Web/Qt/WASM job',()=>{
  const caps={core:true,native:true,gisTools:true,web:true};
  for(const path of ['tools/build-terrain-dem.py','scripts/research/siachen/compare_independent_dem_saltoro.py',
      'tests/python/test_build_terrain_dem.py']){
    const plan=classifyPaths([path],caps);
    assert.equal(plan.python,true,path);
    for(const flag of ['web','core','native','qt','wasm','gisTools','gis','ui'])
      assert.equal(plan[flag],false,path+' unexpectedly triggered '+flag);
  }
});

test('legacy GIS/world validation no longer installs Python on Web code changes',()=>{
  const world=read('.github/workflows/world-dataset-stage3-gate.yml');
  assert.doesNotMatch(world,/setup-python/);
  const archived=read('.github/workflows/pando-pretransfer-cleanup-gate.yml');
  assert.match(archived,/workflow_dispatch:/);
  assert.doesNotMatch(archived,/^  push:/m,
    'obsolete exact-file-count report audit must not block work/gis product pushes');
});
