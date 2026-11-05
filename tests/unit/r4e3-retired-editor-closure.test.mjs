import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {loadRepository} from '../../scripts/plan-application-checks.mjs';
const root=new URL('../../',import.meta.url);
const read=path=>readFileSync(new URL(path,root),'utf8');
const exists=path=>existsSync(new URL(path,root));
const ledger=JSON.parse(read('docs/development/r4e3-retired-tests.json'));
const repo=loadRepository(root);
test('R4-E3 retirement closure removes all 170 classified browser and unit editor suites',()=>{
 assert.equal(ledger.schema,'pandolab-r4e3-retired-test-removals-v1');
 assert.equal(ledger.retired.length,170);
 assert.equal(ledger.retired.filter(p=>p.startsWith('tests/unit/')).length,29);
 assert.equal(ledger.retired.filter(p=>p.startsWith('tests/browser/')).length,141);
 assert.equal(new Set(ledger.retired).size,170);
 for(const file of [...ledger.retired,...ledger.additionalRemovedTests,...ledger.removedBrowserHelpers,
  ...ledger.alreadyRemovedUnitHelpers]) assert.equal(exists(file),false,'Obsolete editor test/fixture reappeared: '+file);
 assert.equal(repo.retiredTests.size,0);
 assert.ok(repo.tests.length>600,'Core/GIS/Viewer tests must be preserved');
});
test('R4-E3 preserves actual C++/WASM, GIS, GeoPackage and Viewer acceptance oracles',()=>{
 for(const file of ledger.preserved)assert.equal(exists(file),true,file);
 for(const file of ['tests/unit/territorial-entity-store.test.mjs','tests/unit/river-territory-partition-serbia.test.mjs',
  'tests/unit/land-relations-presentation.test.mjs','tests/unit/map-hover-topology.test.mjs',
  'tests/browser/viewer-review-e4.spec.mjs','tests/browser/viewer-inspector.spec.mjs',
  'tests/browser/viewer-boundary-p4-5.spec.mjs'])
  assert.equal(exists(file),true,file);
 assert.equal(exists(['apps/editor','frontend','js','modules','editing-domain.js'].join('/')),false,
  'R4-E5 retires the archived editor facade while preserving the actual Core contract');
});
test('R4-E3 catalogs only active and manual tests with no dead editor entries',()=>{
 const manifest=JSON.parse(read('scripts/contracts/application-checks.json'));
 assert.equal(manifest.groups.some(g=>g.mode==='retired'),false);
 assert.equal(repo.tests.length,repo.owners.size);
 assert.equal(repo.tests.some(p=>ledger.retired.includes(p)),false);
 for(const helper of ['tests/browser/helpers/editor-entry.mjs',
  'tests/browser/helpers/mobile-vertex-ui.mjs','tests/unit/helpers/editor-dom-fixture.mjs',
  'tests/helpers/editing-domain.mjs'])assert.equal(exists(helper),false);
 assert.equal(exists('tests/unit/helpers/dom-node-fixture.mjs'),true);
});
test('retired manual boundary CI cannot accidentally dispatch the deleted editor spec',()=>{
 const workflow=read('.github/workflows/application-architecture.yml');
 for(const needle of ['boundary-capture-comparison:','boundary-native-capture:',
  'boundary-revision-comparison:','tests/browser/boundary-cut-snapping.spec.mjs'])
  assert.equal(workflow.includes(needle),false,needle);
 assert.equal(exists('.github/workflows/r4-editor-pruning-validation.yml'),false);
});
