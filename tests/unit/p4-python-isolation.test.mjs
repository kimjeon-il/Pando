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
test('normal Web/core CI jobs cannot install Python or execute GIS Python tests',()=>{
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
  const cli=read('scripts/gis/run-source.mjs');
  assert.match(cli,/--execute/);
  assert.match(cli,/if\(!execute\)return 0/);
  assert.match(cli,/spawn\(command\[0\]/);
});
test('Python-only GIS edits select no standard Web/core/WASM job',()=>{
  const caps={core:true,gisTools:true,web:true};
  for(const path of ['tools/build-terrain-dem.py','tools/gis/verify_osm_hydro_batch03_points.py',
      'tests/python/test_build_terrain_dem.py']){
    const plan=classifyPaths([path],caps);
    assert.equal(plan.python,true,path);
    for(const flag of ['web','core','wasm','gisTools','gis','ui'])
      assert.equal(plan[flag],false,path+' unexpectedly triggered '+flag);
  }
});

test('legacy GIS/world validation no longer installs Python on Web code changes',()=>{
  const world=read('.github/workflows/world-dataset-stage3-gate.yml');
  assert.doesNotMatch(world,/setup-python/);
  const archived=read('.github/workflows/pando-pretransfer-cleanup-gate.yml');
  assert.match(archived,/workflow_dispatch:/);
  assert.doesNotMatch(archived,/^ {2}push:/m,
    'obsolete exact-file-count report audit must not block work/gis product pushes');
});
