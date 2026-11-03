import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import test from 'node:test';
import {loadRepository,planApplicationChecks,retiredEditorBrowserReason} from '../../scripts/plan-application-checks.mjs';
const root=new URL('../../',import.meta.url),repo=loadRepository(root);
const ledger=JSON.parse(readFileSync(new URL('../../docs/development/r4e3-retired-tests.json',import.meta.url),'utf8'));
test('R4-E3 physically removes all 170 retired graphical-editor tests',()=>{
 assert.equal(repo.owners.size,repo.tests.length);
 assert.equal(repo.retiredTests.size,0);
 assert.equal(ledger.retired.length,170);
 for(const path of ledger.retired)assert.equal(existsSync(new URL('../../'+path,import.meta.url)),false,path);
});
test('Viewer, Windows and canonical GIS tests remain selectable',()=>{
 for(const file of ['tests/browser/button-consistency.spec.mjs','tests/browser/viewer-review-e4.spec.mjs',
  'tests/browser/windows-review-e5.spec.mjs','tests/browser/module-cache-version.spec.mjs',
  'tests/browser/korean-boundaries.spec.mjs','tests/unit/core-document-draft-wasm.test.mjs',
  'tests/unit/gis-math-contract.test.mjs'])
  assert.ok(repo.owners.has(file)&&repo.owners.get(file)?.mode!=='retired',file);
 const plan=planApplicationChecks({repository:repo,changedFiles:['tests/browser/button-consistency.spec.mjs']});
 assert.ok(plan.browserSpecs.includes('tests/browser/button-consistency.spec.mjs'));
});
test('a new editor browser entry is still detected, not silently routed to Viewer',()=>{
 assert.equal(retiredEditorBrowserReason('tests/browser/viewer-review-e4.spec.mjs',
  '// editor wording alone does not create an import'),null);
 assert.ok(retiredEditorBrowserReason('tests/browser/snapshot.spec.mjs',
  "import {gotoEditor} from './helpers/editor-entry.mjs';"));
});
test('obsolete editor diagnostic and manual boundary-capture CI modes are absent',()=>{
 const workflow=readFileSync(new URL('../../.github/workflows/application-architecture.yml',import.meta.url),'utf8');
 for(const id of ['editor-diagnostics','boundary-capture-comparison','boundary-native-capture','boundary-revision-comparison'])
  assert.equal(workflow.includes(id),false,id);
 assert.equal(Object.hasOwn(repo.catalog.manualScopes,'editor-diagnostics'),false);
 assert.deepEqual(repo.catalog.manualScopes['map-rendering'],['tests/browser/viewer-canvas.spec.mjs','tests/browser/viewer-gpu-backend-cross.spec.mjs']);
});
