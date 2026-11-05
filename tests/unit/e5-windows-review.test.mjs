import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
const read=path=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');
const exists=path=>existsSync(new URL('../../'+path,import.meta.url));
test('E4 browser inspection remains read-only without the Windows executable',()=>{
  const html=read('apps/viewer/templates/index.html'),compose=read('apps/viewer/js/modules/viewer-composition.js');
  for(const control of ['reviewPanel','reviewEvidenceInput','reviewTabMap','reviewTabErrors'])
    assert.ok(html.includes('id="'+control+'"'),control);
  assert.match(compose,/createDocumentSession\(\{productMode,readOnly:true/);
  assert.match(compose,/createMapOwners\(\{productMode,readOnly:true/);
  assert.match(compose,/inspectParams\.get\('inspect'\)/);
  const controller=read('apps/viewer/js/modules/viewer-inspector-controller.js');
  assert.match(compose,/createViewerInspectorController\(\{/);
  assert.match(compose,/await import\('\.\/viewer-review-panel\.js'\)/);
  assert.match(controller,/inspectRequested&&!nativeReview/);
  assert.match(controller,/requestRevision/);
  assert.doesNotMatch(compose,/let reviewPanel=null,reviewPanelLoading=null/);
  assert.equal(exists('apps/editor/src-tauri/src/lib.rs'),false);
  assert.equal(exists('apps/editor/native-producer.mjs'),false);
});
