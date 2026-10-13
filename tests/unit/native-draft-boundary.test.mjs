import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const native=file=>readFileSync(new URL(`../../native/${file}`,import.meta.url),'utf8');

// Actual draft behavior is checked by the Core-only frozen Web23-step target.
// GUI execution is prohibited; these guards check the current native wiring.
test('native editing uses the single shared GeometryDraft owner',()=>{
  assert.match(native('engine/include/pandoeditor/map/editgeometry.h'),/#include <pandoeditor\/geometrydraft.h>/);
  assert.doesNotMatch(native('engine/include/pandoeditor/map/editgeometry.h'),/struct GeometryDraft|class GeometryDraft/);
  assert.doesNotMatch(native('engine/src/editgeometry.cpp'),/GeometryDraft::/);
  const session=native('app/editorcontroller.h');
  assert.doesNotMatch(session,/GeometryEditSession : pandoeditor::GeometryDraft/);
  assert.match(session,/session\.installNativeDraft\(std::move\(geometry\),epoch\)/);
  assert.doesNotMatch(session,/\blineDraft\b|\blineUndo\b|\blineRedo\b/);
  for(const file of ['editorgeometry.cpp','editorterritoryselection.cpp','editorsnapping.cpp','editorriverselection.cpp','sharedboundarycontroller.cpp'])
    assert.doesNotMatch(native('app/'+file),/\blineDraft\b|\blineUndo\b|\blineRedo\b|checkpointDraft|recordVertexMove|geometry\(\)\s*=/,file);
});
test('native draft actions reach Core while map algorithms retain their engine owner',()=>{
  const code=native('app/editorgeometry.cpp');
  for(const action of ['append','moveSelected','beginDrag','cancelDrag','finishDrag','insertAt','deleteSelected','replaceCoordinates'])
    assert.match(code,new RegExp(`coreSession_\\.draft\\(\\)\\.${action}\\(`),action);
  for(const algorithm of ['nearestEditVertex','nearestEditSegment','translateEditGeometry','validateEditGeometry'])
    assert.match(code,new RegExp(`map::${algorithm}\\(`),algorithm);
  assert.match(code,/boundaryNode=map::nearestMovableBoundaryNode/);
  assert.match(native('app/editorterritoryselection.cpp'),/resetGeometry\(\{edit\.territorySelection->state\(\)\.activeMethod==TerritorySelectionMethod::Line\?"LineString":"Polygon"/);
});
