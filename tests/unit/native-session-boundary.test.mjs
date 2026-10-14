import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../../native/app/', import.meta.url);
const source = file => readFileSync(new URL(file, root), 'utf8');
const writers = readdirSync(root).filter(file => /^editor.*\.cpp$/.test(file) || file === 'worldbootstrap.cpp');

// These source guards check Native ownership and public operation boundaries.
// Epoch rejection, effects and history are exercised by shared/tests/document-session-tests.cpp.
test('Native has one Core session and readonly document and selection projections', () => {
  const header = source('editorcontroller.h');
  const sessionFields = [...header.matchAll(/\bpandoeditor\s*::\s*DocumentSession\s+(\w+)\s*;/g)];
  assert.equal(sessionFields.length, 1, 'Native must have one document session owner');
  const projection = type => {
    const fields = [...header.matchAll(new RegExp(`\\b(const\\s+)?pandoeditor\\s*::\\s*${type}\\s*(&)?\\s*(\\w+)\\s*;`, 'g'))];
    assert.equal(fields.length, 1, type);
    assert.ok(fields[0][1] && fields[0][2], `${type} must be a const reference to its owner`);
    return fields[0][3];
  };
  const project = projection('Project'), selection = projection('SelectionState');
  assert.match(source('editorcontroller.cpp'), /DocumentSessionProfile\s*::\s*Native/);
  assert.match(source('editorcontroller.cpp'), /NativeDocumentPorts\b/);
  for (const file of writers) {
    const code = source(file);
    assert.doesNotMatch(code, new RegExp(`(?:CommandProcessor|PresentationCommandProcessor)\\s*::\\s*(?:confirm|apply)\\s*\\(\\s*${project}\\b`), file);
    assert.doesNotMatch(code, new RegExp(`\\b${project}\\s*(?:\\.\\s*(?:replace|undo|redo|markSaved|setTimelineCursor)\\s*\\(|=\\s*std\\s*::\\s*move)`), file);
    assert.doesNotMatch(code, new RegExp(`\\b${selection}\\s*(?:\\.\\s*(?:setMany|setHover|resetProject|prune|documentHistoryApplied)\\s*\\(|=\\s*std\\s*::\\s*move)`), file);
  }
});

test('Prepared Native scenes and commands use epoch-guarded Core adoption', () => {
  const commands = source('editorcommands.cpp');
  // Public Core methods require an epoch in their C++ signatures. Argument
  // spelling and local variable names are not frontend architecture contracts.
  for (const operation of ['adoptPreparedCommand', 'confirmCandidate'])
    assert.match(commands, new RegExp(`\\.\\s*${operation}\\s*\\(`));
  for (const file of ['worldbootstrap.cpp', 'editorwebimport.cpp'])
    assert.match(source(file), /\.\s*adoptPreparedProject\s*\(/);
  assert.match(source('editorcontroller.cpp'), /\.\s*setTimelineCursor\s*\(/);
});

test('Native overlap commands reuse current DTO readers and Core control policies', () => {
  const commands = source('editorcommands.cpp');
  assert.match(commands, /readWebMetadataCommand/);
  assert.match(commands, /readWebContentCommand/);
  assert.match(commands, /readWebTerritorialCommand/);
  assert.match(commands, /readWebObjectRemoval\s*\(/);
  assert.doesNotMatch(commands, /operation="territorial\.remove"/);
  const structure=source('editorstructure.cpp');
  assert.match(structure,/prepareCoreRequest\s*\(/);
  assert.match(structure,/\.\s*requiresConfirmation\s*=\s*true/);
  assert.match(commands, /projectcodec::webContentValue/);
  assert.match(commands, /readNativeContentEdit\s*\(/);
  assert.match(source('editorgeometry.cpp'), /readWebTerritorialCommand\s*\(/);
  assert.match(source('editorterritoryselection.cpp'), /prepareCoreTerritorialReceipt\s*\(/);
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
    assert.match(code, /"hiddenItems"\s*,/);
  }
});
