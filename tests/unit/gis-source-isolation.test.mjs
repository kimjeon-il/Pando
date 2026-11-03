import assert from 'node:assert/strict';
import { readFileSync,existsSync } from 'node:fs';
import test from 'node:test';
import { classifyPaths } from '../../scripts/p1-plan-remote-checks.mjs';

const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
test('the historical P6 inventory is retired while current product gates remain active',()=>{
  assert.equal(existsSync(new URL('../../.github/workflows/p6-preflight.yml',import.meta.url)),false);
  assert.match(read('.github/workflows/shared-core.yml'),/core-gpkg-file-boundary\.test\.mjs/);
  assert.match(read('.github/workflows/e7-final-readonly-regression.yml'),/push:/);
});
test('general Web tests and versioning use only Node',()=>{
  const scripts=JSON.parse(read('package.json')).scripts;
  assert.equal(Object.hasOwn(scripts,'test:gis-python'),false);
  assert.equal(Object.hasOwn(scripts,'test:python'),false);
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
test('GIS source work uses the dedicated workflow and opt-in CLI',()=>{
  const wf=read('.github/workflows/gis-source-p4.yml');
  assert.match(wf,/workflow_dispatch:/);
  assert.match(wf,/gis-source:/);
  assert.match(wf,/historical-geometry:/);
  const events=wf.split('  workflow_dispatch:')[0];
  for(const extension of ['py','pyi','ipynb'])
    assert.equal(events.split(`'**/*.${extension}'`).length-1,2,`push and pull request must guard ${extension}`);
  assert.doesNotMatch(wf,/setup-python|python -m/);
  assert.doesNotMatch(wf,/^\s+schedule:/m);
  assert.ok(wf.includes("github.event_name == 'workflow_dispatch'"));
  const cli=read('scripts/gis/run-source.mjs');
  assert.match(cli,/--execute/);
  assert.match(cli,/if\(!execute\)return 0/);
  assert.match(cli,/spawn\(command\[0\]/);
});
test('GIS generator edits do not select core or WASM compilation',()=>{
  const caps={core:true,gisTools:true,web:true};
  for(const path of ['tools/gis/build-hydro.mjs']){
    const plan=classifyPaths([path],caps);
    assert.equal(plan.gis,true,path);
    for(const flag of ['core','wasm','gisTools','ui'])
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
