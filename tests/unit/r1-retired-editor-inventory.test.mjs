import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {loadRepository,planApplicationChecks,retiredEditorBrowserReason} from '../../scripts/plan-application-checks.mjs';

const repo=loadRepository(new URL('../../',import.meta.url));
test('R1 reports archived editor browser and unit tests without dropping their catalog owner',()=>{
  assert.equal(repo.owners.size,repo.tests.length);
  const obsolete=[
    'tests/browser/feedback-accessibility.spec.mjs',
    'tests/browser/editor-workspace.spec.mjs',
    'tests/browser/mobile-native-selection.spec.mjs',
    'tests/browser/phone-landscape-editor.spec.mjs',
    'tests/browser/product-pruning.spec.mjs',
    'tests/browser/gis-math-contract.spec.mjs',
    'tests/unit/application-composition.test.mjs',
    'tests/unit/capability-ports-contract.test.mjs',
    'tests/unit/territorial-gis-export.test.mjs',
  ];
  for(const file of obsolete) {
    assert.ok(repo.retiredTests.has(file),file);
    assert.equal(repo.owners.get(file)?.mode,'retired',file);
    assert.ok(repo.owners.get(file)?.reason,file);
  }
});
test('R1 still selects current Viewer, actual Windows review and source-bound GIS regressions',()=>{
  for(const file of ['tests/browser/button-consistency.spec.mjs',
    'tests/browser/viewer-review-e4.spec.mjs',
    'tests/browser/windows-review-e5.spec.mjs',
    'tests/browser/module-cache-version.spec.mjs',
    'tests/browser/korean-boundaries.spec.mjs'])
    assert.equal(repo.retiredTests.has(file),false,file);
  const plan=planApplicationChecks({repository:repo,changedFiles:['tests/browser/feedback-accessibility.spec.mjs']});
  assert.ok(!plan.browserSpecs.includes('tests/browser/feedback-accessibility.spec.mjs'));
  const viewer=planApplicationChecks({repository:repo,changedFiles:['tests/browser/button-consistency.spec.mjs']});
  assert.ok(viewer.browserSpecs.includes('tests/browser/button-consistency.spec.mjs'));
});
test('R1 cannot archive ordinary browser tests solely for mentioning editor in comments',()=>{
  assert.equal(retiredEditorBrowserReason('tests/browser/viewer-review-e4.spec.mjs',
    '// The editor must never ship.\\nimport {test} from "@playwright/test";'),null);
  assert.ok(retiredEditorBrowserReason('tests/browser/snapshot.spec.mjs',
    "import {gotoEditor} from './helpers/editor-entry.mjs';"));
});
test('manual CI no longer offers an impossible editor-diagnostics product',()=>{
  const workflow=readFileSync(new URL('../../.github/workflows/application-architecture.yml',import.meta.url),'utf8');
  assert.doesNotMatch(workflow,/- editor-diagnostics/);
  assert.equal(Object.hasOwn(repo.catalog.manualScopes,'editor-diagnostics'),false);
});
