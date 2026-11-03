import assert from 'node:assert/strict';
import {readFileSync,existsSync,readdirSync} from 'node:fs';
import test from 'node:test';
import {loadRepository} from '../../scripts/plan-application-checks.mjs';

const root=new URL('../../',import.meta.url);
const read=p=>readFileSync(new URL(p,root),'utf8');
const exists=p=>existsSync(new URL(p,root));
const manifest=JSON.parse(read('docs/development/r4e3-retired-test-manifest.json'));
const history=JSON.parse(read('docs/development/r4-source-pruning.json'));

test('R4-E3 removes 170 archived editor tests plus three obsolete comparison-only tests',()=>{
 assert.equal(manifest.retireTests.length,170);
 assert.equal(manifest.additionalRetiredUnitTests.length,3);
 for(const p of [...manifest.retireTests,...manifest.additionalRetiredUnitTests])
   assert.equal(exists(p),false,p);
 const repo=loadRepository(root);
 assert.equal(repo.retiredTests.size,0);
 assert.equal(repo.owners.size,repo.tests.length);
 assert.equal(repo.tests.length,877);
 assert.equal(history.removedSourceCount,50);
 assert.equal(history.remainingSourceCount,103);
 assert.equal(history.removedTestCount,183);
});

test('R4-E3 removes obsolete workflows and keeps Viewer, GIS and Core acceptance',()=>{
 assert.equal(manifest.retireWorkflows.length,38);
 for(const p of manifest.retireWorkflows)assert.equal(exists(p),false,p);
 for(const p of manifest.migrateWorkflows.filter(p=>!manifest.retireWorkflows.includes(p)))
   assert.equal(exists(p),true,p);
 for(const name of [
  'tests/browser/viewer-review-e4.spec.mjs',
  'tests/browser/temporal-map-presentation.spec.mjs',
  'tests/browser/viewer-boundary-p4-5.spec.mjs',
  'tests/browser/viewer-gpu-backend-cross.spec.mjs',
  'tests/unit/library-shared-border-precision.test.mjs',
  'tests/unit/gis-math-contract.test.mjs',
  'tests/unit/core-direct-object-writers-wasm.test.mjs',
  'tests/unit/core-gpkg-file-boundary.test.mjs',
 ])assert.equal(exists(name),true,name);
 const staleReferences=[];
 for(const name of readdirSync(new URL('../../.github/workflows/',import.meta.url)).filter(n=>n.endsWith('.yml'))){
  const source=read('.github/workflows/'+name);
  for(const stale of [...manifest.retireTests,...manifest.additionalRetiredUnitTests])
   if(source.includes(stale))staleReferences.push(name+' -> '+stale);
 }
 assert.deepEqual(staleReferences,[],'Surviving CI must not reference retired editor tests');
});

test('R4-E3 retires editor-only fixture code but preserves read-only comparison oracles',()=>{
 for(const p of manifest.retireFixtures)assert.equal(exists(p),false,p);
 for(const p of [
  'tests/fixtures/geopackage/compat/worker/gis-adapters.source.txt',
  'tests/fixtures/geopackage/compat/worker/gis-gpkg-worker.source.txt',
  'tests/fixtures/retired-browser-oracles/country-map-substrate.source.txt',
  'tests/fixtures/retired-browser-oracles/interaction-unification.source.txt',
  'tests/fixtures/retired-browser-oracles/edit-preview-handoff.source.txt',
 ])assert.equal(exists(p),true,p);
 const mapDiagnostics=read('tests/unit/map-diagnostics.test.mjs');
 assert.doesNotMatch(mapDiagnostics,/new URL\(['"]\.\.\/browser\/(?:country-map-substrate|interaction-unification|edit-preview-handoff)\.spec\.mjs/);
});

test('R4-E3 catalog selects only supported Viewer browser suites and retains Core helpers',()=>{
 const repo=loadRepository(root);
 for(const group of repo.catalog.groups)assert.notEqual(group.mode,'retired');
 assert.deepEqual(repo.catalog.manualScopes['map-rendering'],[
  'tests/browser/viewer-canvas.spec.mjs','tests/browser/viewer-gpu-backend-cross.spec.mjs'
 ]);
 for(const p of ['tests/helpers/core-gis-compat/gis-import-transaction.mjs',
  'tests/helpers/core-command-services/territorial-service.mjs',
  'tools/gis/gis-geometry-worker.js'])assert.equal(exists(p),true,p);
});
