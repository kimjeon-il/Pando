import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
const source=file=>readFileSync(new URL(`../../native/${file}`,import.meta.url),'utf8').replace(/\r\n/g,'\n');

// Native GUI execution is explicitly prohibited. These current-contract guards
// supplement the shared Core reducer's pure typed-selection behavior checks.
test('native selection retains data-backed type identity and the shared key encoder',()=>{
  const code=source('app/editorselection.cpp');
  assert.match(code,/SelectionRef> EditorController::selectionRefFor/);
  assert.match(code,/SelectionRef> EditorController::existingSelectionRef/);
  assert.match(code,/selectionRefKey\(ref\)/);
  assert.match(code,/document\(\)\.labels\.at\([^\n]+\.kind/);
  assert.match(code,/document\(\)\.hydro\.at\([^\n]+\.kind/);
  assert.match(code,/ref->domain=="territorial"&&requested!="entity"/);
  assert.match(code,/ref->type=requested\.toStdString\(\)/);
  assert.match(code,/project_\.hasActiveObject\(ref\)/);
  assert.match(code,/ref->domain=="placeBuiltin"\|\|ref->domain=="hydroBuiltin"/);
  assert.doesNotMatch(code,/"type","(?:placeBuiltin|hydroBuiltin)"/);
});
test('Core owns native hover and rendering receives explicit document references',()=>{
  const header=source('app/editorcontroller.h'),selection=source('app/editorselection.cpp');
  assert.doesNotMatch(header,/\bhover_|\bhoverSource_|\bhoverRevision_/);
  assert.match(header,/hoverRevision\(\) const \{ return selection_\.hoverRevision\(\); \}/);
  assert.match(selection,/coreSession_\.selection\(\)\.setHover\(/);
  assert.match(header,/const pandoeditor::SelectionState& selection_/);
  assert.match(source('app/editorcontroller.cpp'),/interaction\.selected=selectedObjectRefs\(\)/);
  assert.match(source('app/editorcontroller.cpp'),/interaction\.primary=primaryObjectRef\(\)/);
  for(const file of ['ContentPanel.qml','EditorPanel.qml','ObjectMetadataField.qml','ObjectPropertyPanel.qml'])
    assert.doesNotMatch(source('ui/common/'+file),/primaryObject\.type\s*[!=]==?\s*"general"/);
  assert.match(source('ui/common/ObjectSearch.qml'),/domain==="territorial"\?row\.modelData\.kind/);
});
test('native probe and fixtures use the typed contract without retired domain aliases',()=>{
  const probe=source('tests/selection_probe.cpp');
  assert.match(probe,/SelectionRef readRef/);
  assert.match(probe,/return \{domain\.toStdString\(\),type\.toStdString\(\),id\.toStdString\(\)\}/);
  assert.doesNotMatch(probe,/domain=="distribution"|std::vector<ObjectRef>/);
  assert.match(source('tests/selection_editor_tests.cpp'),/emptySelectionProjectResetRetainsCurrentWebAnchor/);
  assert.match(source('tests/place_controller_tests.cpp'),/"type","capital"/);
});
test('changed native Undo and Redo invoke the shared selection history boundary',()=>{
  const controller=source('app/editorcontroller.cpp');
  assert.doesNotMatch(controller,/historySelection\.documentHistoryApplied\(/);
  assert.doesNotMatch(controller,/if\(clearBoundarySelection\)clearSelection\(\)/);
  for(const action of ['undo','redo'])
    assert.match(controller,new RegExp(`coreSession_\\.${action}\\(coreEpoch\\(\\)\\)`));
});
