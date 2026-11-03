import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import test from 'node:test';
import {loadRepository,planApplicationChecks,retiredEditorBrowserReason} from '../../scripts/plan-application-checks.mjs';

const root=new URL('../../',import.meta.url);
const repo=loadRepository(root);
test('R4-E3 archived graphical-editor test entries stay absent instead of remaining registered',()=>{
 assert.equal(repo.owners.size,repo.tests.length);
 assert.equal(repo.retiredTests.size,0);
 for(const path of [
  'tests/browser/editor-workspace.spec.mjs',
  'tests/browser/mobile-native-selection.spec.mjs',
  'tests/browser/feedback-accessibility.spec.mjs',
  'tests/unit/application-composition.test.mjs',
  'tests/unit/capability-ports-contract.test.mjs',
  'tests/unit/territorial-gis-export.test.mjs',
 ])assert.equal(existsSync(new URL('../../'+path,import.meta.url)),false,path);
});
test('R4-E3 still selects current Viewer, Windows and canonical GIS regressions',()=>{
 for(const file of ['tests/browser/button-consistency.spec.mjs',
  'tests/browser/viewer-review-e4.spec.mjs','tests/browser/windows-review-e5.spec.mjs',
  'tests/browser/module-cache-version.spec.mjs','tests/browser/korean-boundaries.spec.mjs'])
  assert.equal(repo.retiredTests.has(file),false,file);
 const viewer=planApplicationChecks({repository:repo,changedFiles:['tests/browser/button-consistency.spec.mjs']});
 assert.ok(viewer.browserSpecs.includes('tests/browser/button-consistency.spec.mjs'));
});
test('archived editor reintroduction can still be detected without runtime snapshots',()=>{
 assert.equal(retiredEditorBrowserReason('tests/browser/viewer-review-e4.spec.mjs',
  '// editor test removed'),null);
 assert.ok(retiredEditorBrowserReason('tests/browser/snapshot.spec.mjs',
  "import {gotoEditor} from './helpers/editor-entry.mjs';"));
});
test('manual CI excludes deleted editor diagnostics while preserving Viewer scopes',()=>{
 const workflow=readFileSync(new URL('../../.github/workflows/application-architecture.yml',import.meta.url),'utf8');
 assert.doesNotMatch(workflow,/- editor-diagnostics|boundary-capture-comparison:|boundary-revision-comparison:/);
 assert.equal(Object.hasOwn(repo.catalog.manualScopes,'editor-diagnostics'),false);
 assert.deepEqual(repo.catalog.manualScopes['map-rendering'],[
  'tests/browser/viewer-canvas.spec.mjs','tests/browser/viewer-gpu-backend-cross.spec.mjs']);
});
