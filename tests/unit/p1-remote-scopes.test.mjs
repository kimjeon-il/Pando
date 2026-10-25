import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyPaths, pinnedVersions } from '../../scripts/p1-plan-remote-checks.mjs';

const all = {core:true,gisTools:true,web:true};
const webOnly = {core:false,gisTools:false,web:true};
test('toolchain has one pinned source for Node, pnpm, Python and C++ compilers', () => {
  const versions = pinnedVersions();
  assert.equal(versions.node,'24');
  assert.equal(versions.pnpm,'11.19.0');
  assert.equal(Object.hasOwn(versions,'qt'),false);
  assert.equal(versions.emscripten,'4.0.20');
  assert.equal(versions.cmake,'3.31.6');
});
test('CSS edits do not start C++/WASM or GIS tools', () => {
  const p=classifyPaths(['shared/frontend/css/ui.css'],all);
  assert.equal(p.web,true);
  assert.equal(p.ui,true);
  for(const flag of ['core','wasm','gisTools','python','places']) assert.equal(p[flag],false,flag);
});
test('core source triggers standalone C++ and WASM only when the source exists', () => {
  const full=classifyPaths(['shared/core/src/document.cpp'],all);
  assert.equal(full.core,true); assert.equal(full.wasm,true);

  const legacy=classifyPaths(['shared/core/src/document.cpp'],webOnly);
  assert.equal(legacy.core,false);assert.equal(legacy.wasm,false);
});
test('WebView shell changes select the current Web app checks', () => {
  assert.equal(classifyPaths(['apps/editor/startup.js'],all).web,true);
});
test('GIS Python and city records stay in their own scopes', () => {
  const gis=classifyPaths(['tools/build-terrain-dem.py'],all);
  assert.equal(gis.python,true);assert.equal(gis.gis,false);
  assert.equal(gis.web,false, 'GIS Python-only change belongs to the independent Python workflow');
  const cities=classifyPaths(['assets/data/places/manifest.json'],all);
  assert.equal(cities.places,true);assert.equal(cities.python,false);assert.equal(cities.core,false);
});
test('P1 changes validate tools that exist; old Web-only branches are safe', () => {
  const path=['.github/workflows/remote-development-p1.yml'];
  const merged=classifyPaths(path,all);
  assert.equal(merged.core,true);
  assert.equal(merged.wasm,true);assert.equal(merged.gisTools,true);
  const old=classifyPaths(path,webOnly);
  assert.equal(old.web,true);assert.equal(old.core,false);
  assert.equal(old.wasm,false);assert.equal(old.gisTools,false);
});
test('reports-only push does not start heavyweight jobs', () => {
  const result=classifyPaths(['reports/development/testing/notes.md'],all);
  assert.equal(result.web,false);assert.equal(result.core,false);
  assert.equal(result.gisTools,false);
});
test('manual scope can explicitly opt into full diagnostics', () => {
  const result=classifyPaths([],all,'all');
  for(const key of ['web','core','wasm','gisTools','python'])assert.equal(result[key],true,key);
  assert.throws(()=>classifyPaths([],all,'gibberish'),/P1_INVALID_SCOPE/);
});



test('app and shared documentation do not start compilation', () => {
  const result=classifyPaths(['apps/editor/README.md','shared/README.md'],all);
  for(const key of ['web','core','wasm','gisTools'])assert.equal(result[key],false,key);
});
