import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import test from 'node:test';

const root=new URL('../../',import.meta.url);
const source=path=>readFileSync(new URL(path,root),'utf8');
const exists=path=>existsSync(new URL(path,root));

test('P7 ships only the Viewer, not the Windows editor shell or staging build',()=>{
  assert.equal(exists('apps/editor'),false);
  for(const path of [
    'design/brand/windows.svg','design/brand/windows-small.svg',
    'tests/browser/windows-review-e5.spec.mjs',
    'tests/unit/e5-windows-review.test.mjs',
    '.github/workflows/r4-editor-pruning-validation.yml',
    '.github/workflows/integration-r4-e4-e5.yml',
  ])assert.equal(exists(path),false,path);
  const pkg=JSON.parse(source('package.json'));
  assert.equal(Object.hasOwn(pkg.scripts,'dev:editor'),false);
  const checks=JSON.parse(source('scripts/contracts/application-checks.json'));
  assert.ok(checks.groups.every(group=>!group.id.startsWith('app-small-')&&!group.id.startsWith('app-world-')));
  assert.ok(checks.groups.every(group=>(group.inputs||[]).every(input=>!input.startsWith('apps/editor/'))));
});

test('P7 Viewer startup and inspector contain no native review activation or mutation bridge',()=>{
  for(const path of ['apps/viewer/js/viewer.js',
    'apps/viewer/js/modules/viewer-composition.js',
    'apps/viewer/js/modules/viewer-inspector-controller.js'])
    assert.doesNotMatch(source(path),/PANDOLAB_NATIVE_REVIEW|PANDOLAB_SHELL_VERIFICATION|nativeReview/);
  const inspector=source('apps/viewer/js/modules/viewer-inspector-controller.js');
  assert.match(inspector,/readOnly!==true/);
  assert.match(inspector,/inspectRequested/);
  assert.match(inspector,/requestRevision/);
  assert.match(source('apps/viewer/js/modules/viewer-composition.js'),/await import\('\.\/viewer-review-panel\.js'\)/);
});
