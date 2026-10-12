import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../../native/app/', import.meta.url);
const source = file => readFileSync(new URL(file, root), 'utf8');
const writers = readdirSync(root).filter(file => /^editor.*\.cpp$/.test(file) || file === 'worldbootstrap.cpp');

// Qt execution is prohibited for this task. These guards validate the actual
// frontend ownership/wiring; typed effects and history run in tiny Core tests.
test('Native has one Core session and readonly document and selection projections', () => {
  const header = source('editorcontroller.h');
  assert.match(header, /pandoeditor::DocumentSession coreSession_/);
  assert.match(header, /const pandoeditor::Project& project_/);
  assert.match(header, /const pandoeditor::SelectionState& selection_/);
  assert.doesNotMatch(header, /pandoeditor::Project project_|pandoeditor::SelectionState selection_/);
  assert.match(source('editorcontroller.cpp'), /DocumentSessionProfile::Native/);
  assert.match(source('editorcontroller.cpp'), /NativeDocumentPorts[\s\S]*placeRuntime_\.recordById[\s\S]*hydroRuntime_\.recordById/);
  for (const file of writers) {
    const code = source(file);
    assert.doesNotMatch(code, /(?:CommandProcessor|PresentationCommandProcessor)::(?:confirm|apply)\(project_/, file);
    assert.doesNotMatch(code, /project_\.(?:replace|undo|redo|markSaved|setTimelineCursor)\(|project_\s*=\s*std::move/, file);
    assert.doesNotMatch(code, /selection_\.(?:setMany|setHover|resetProject|prune|documentHistoryApplied)\(|selection_\s*=\s*std::move/, file);
  }
});

test('Prepared Native scenes and commands use epoch-guarded Core adoption', () => {
  const commands = source('editorcommands.cpp');
  assert.match(commands, /adoptPreparedCommand\(std::move\(prepared\),expectedEpoch\)/);
  assert.match(commands, /confirmCandidate\(retained\.candidateId,expectedEpoch\)/);
  assert.match(source('worldbootstrap.cpp'), /adoptPreparedProject\(std::move\(\*prepared\.project\)\)/);
  assert.match(source('worldbootstrap.cpp'), /sceneBuilder_\.adoptPreparation\(project_\.snapshotForView\(\)/);
  assert.match(source('editorwebimport.cpp'), /adoptPreparedProject\(std::move\(ready->project\)\)/);
  assert.match(source('editorcontroller.cpp'), /coreSession_\.setTimelineCursor\(month\.toStdString\(\),coreEpoch\(\)\)/);
});

test('Native overlap commands reuse current DTO readers and Core control policies', () => {
  const commands = source('editorcommands.cpp');
  assert.match(commands, /readWebMetadataCommand/);
  assert.match(commands, /readWebContentCommand/);
  assert.match(commands, /readWebTerritorialCommand/);
  assert.match(commands, /payload\.object\["refs"\]=std::move\(refs\);return readWebObjectRemoval\(snapshot,payload\)/);
  assert.doesNotMatch(commands, /operation="territorial\.remove"/);
  const structure=source('editorstructure.cpp');
  assert.match(structure,/const auto checked=prepareCoreRequest\(coreTerritorialRequest\(intent\)\)/);
  assert.match(structure,/plan\.requiresConfirmation=true/);
  assert.match(commands, /projectcodec::webContentValue/);
  assert.match(commands, /readNativeContentEdit\(snapshot,edit\.target,row,edit\.create\)/);
  assert.match(source('editorgeometry.cpp'), /readWebTerritorialCommand\(project_\.snapshot\(\),"territorial.geometry"/);
  assert.match(source('editorterritoryselection.cpp'), /prepareCoreTerritorialReceipt\(std::move\(result\)\)/);
  assert.doesNotMatch(source('editorgeometry.cpp'), /GeometryRef ref=previous|"content:"\+edit\.target\.domain/);
  const presentation = source('editorpresentation.cpp');
  assert.match(presentation, /WebControlVisibility/);
  assert.match(presentation, /WebControlGroupPresentation/);
  assert.match(presentation, /WebControlDistributionPresentation/);
  assert.doesNotMatch(presentation, /setDistributionDisplay|PatchGroupPresentation|SetPresentationVisibility/);
  const controls = readFileSync(new URL('../../native/ui/common/MapDisplayControls.qml', import.meta.url), 'utf8');
  for (const method of ['setDistributionRenderMode', 'setDistributionActiveLayer', 'setDistributionBoundaryVisible'])
    assert.match(controls, new RegExp(`editor\\.${method}\\(`));
  assert.doesNotMatch(controls, /setDistributionDisplay/);
});

test('Native current fixtures use bool visibility while wire observations remain hidden lists', () => {
  const tests = new URL('../../native/tests/', import.meta.url);
  for (const file of readdirSync(tests).filter(file => /\.(?:cpp|h)$/.test(file))) {
    const code = readFileSync(new URL(file, tests), 'utf8');
    assert.doesNotMatch(code, /\.hiddenItems\b|eraseHiddenItem\(/, file);
    assert.doesNotMatch(code, /\.itemVisibility\[[^\]\n]+\]\.insert\(/, file);
  }
  for (const file of ['m973_split_controller_probe.cpp', 'm974_boundary_probe.cpp']) {
    const code = readFileSync(new URL(file, tests), 'utf8');
    assert.match(code, /\[id,visible\]:items\)if\(!visible\)hidden\.append/);
    assert.match(code, /"hiddenItems",hidden/);
  }
});
