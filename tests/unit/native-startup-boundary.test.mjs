import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = path => readFileSync(new URL(`../../native/${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// Static guards supplement the small non-GUI tests: the user explicitly
// prohibits launching the app (including offscreen) to reproduce its freeze.
test('canonical completion installs prepared state rather than rebuilding it on GUI thread', () => {
  const code = source('app/worldbootstrap.cpp');
  const completion = code.slice(code.indexOf('void EditorController::startCanonicalWorld('),
    code.indexOf('void EditorController::startCanonicalWorldMesh('));
  const gui = completion.slice(0, completion.indexOf('watcher->setFuture'));
  assert.doesNotMatch(gui, /candidate\.replace|nextProjection\.rebuild|candidate\.setTimelineCursor/);
  assert.match(gui, /initial\.matches\(project_\)/);
  assert.match(gui, /requestedMonth.*project_\.timelineCursor\(\)/);
  assert.match(gui, /view\.mode.*sceneBridge_\.viewState\(\)\.mode/);
  assert.match(gui, /result->world/);
  assert.match(gui, /sceneBuilder_\.adoptPreparation/);
  assert.match(completion.slice(completion.indexOf('watcher->setFuture')), /builder\.build\(result->world\.project->snapshotForView/);
});

test('canonical completion terminates the current bootstrap when the project changed', () => {
  const code = source('app/worldbootstrap.cpp');
  const completion = code.slice(code.indexOf('void EditorController::startCanonicalWorld('),
    code.indexOf('void EditorController::startCanonicalWorldMesh('));
  const gui = completion.slice(0, completion.indexOf('watcher->setFuture'));
  assert.match(gui, /if\(generation!=worldGeneration_\)return;/);
  assert.doesNotMatch(gui, /if\([^\n]*!initial\.matches\(project_\)[^\n]*\)return;/);
  const operation = gui.slice(gui.indexOf('try {'));
  assert.match(operation, /if\(!initial\.matches\(project_\)\)\s*throw std::runtime_error/);
  assert.match(operation, /catch\(const std::exception& error\)[\s\S]*cancelWorldBootstrap\(\)[\s\S]*worldStatus_=QStringLiteral\("unavailable"\)/);
});

test('autosave recovery retains the prepared scene while protecting the recovered document', () => {
  const code = source('app/worldbootstrap.cpp');
  const recovery = code.slice(code.indexOf('void EditorController::startAutosaveRecovery('),
    code.indexOf('void EditorController::startWorldBootstrap('));
  const gui = recovery.slice(0, recovery.indexOf('watcher->setFuture'));
  assert.doesNotMatch(gui, /projection_\.rebuild|\.replace\(/);
  assert.match(gui, /generation!=worldGeneration_/);
  assert.match(gui, /initial\.matches\(project_\)/);
  assert.match(gui, /sceneBridge_\.publishScene\(result->scene\)/);
  assert.match(gui, /sceneBuilder_\.adoptPreparation/);
  assert.ok(gui.indexOf('autosaveRevision_=project_.revision()') < gui.indexOf('startupBusy_=false;\n        publish'));
});

test('initial hydro source hashing, promotion and index preparation run on worker', () => {
  const code = source('app/editorpresentation.cpp');
  const sync = code.slice(code.indexOf('void EditorController::syncHydroData('),
    code.indexOf('bool EditorController::setDistributionDisplay('));
  const gui = sync.slice(0, sync.indexOf('watcher->setFuture'));
  assert.doesNotMatch(gui, /inspectHydroData|promotePhysicalAsset|hydroRuntime_\.open|readAll\(/);
  assert.match(gui, /hydroOpenCancelled_->store\(true\)/);
  assert.match(gui, /generation!=hydroOpenGeneration_/);
  assert.match(gui, /initial\.matches\(project_\)/);
  assert.match(gui, /month!=project_\.timelineCursor\(\)/);
  assert.match(gui, /mode!=sceneBridge_\.viewState\(\)\.mode/);
  assert.match(gui, /hydroRuntime_\.install/);
  assert.match(sync.slice(sync.indexOf('watcher->setFuture')), /HydroRuntimeProvider::prepareOpen/);
  const status = code.slice(code.indexOf('QVariantMap EditorController::hydroDataStatus()'),
    code.indexOf('QVariantMap EditorController::terrainDataStatus()'));
  assert.doesNotMatch(status, /inspectHydroData|readHydroAsset|prepareOpen/);
});

test('stale hydro completion restarts a still wanted source before publishing its result', () => {
  const code = source('app/editorpresentation.cpp');
  const sync = code.slice(code.indexOf('void EditorController::syncHydroData('),
    code.indexOf('bool EditorController::setDistributionDisplay('));
  const completion = sync.slice(sync.indexOf('[this,watcher,generation,initial,month,mode]'),
    sync.indexOf('watcher->setFuture'));
  assert.match(completion, /if\(generation!=hydroOpenGeneration_\)return;/);
  assert.match(completion, /if\(!initial\.matches\(project_\)\|\|month!=project_\.timelineCursor\(\)\|\|mode!=sceneBridge_\.viewState\(\)\.mode\)\s*\{\s*syncHydroData\(\);return;/);
  assert.ok(completion.indexOf('syncHydroData();return;') < completion.indexOf('watcher->result()'));
  assert.ok(completion.indexOf('if(hydroRuntime_.isOpen())return;') < completion.indexOf('hydroRuntime_.install'));
});

test('future local builds record and enforce source provenance before launching', () => {
  const cmake = source('cmake/BuildProvenance.cmake');
  assert.match(cmake, /dirtySourceHash/);
  assert.match(cmake, /file\(SHA256/);
  assert.match(cmake, /PANDO_PROVENANCE_CHECK/);
  assert.match(cmake, /executableSha256/);
  const app = source('app/CMakeLists.txt');
  assert.match(app, /add_custom_command\(TARGET pandoeditor POST_BUILD/);
  assert.match(app, /PANDO_PROVENANCE_EXECUTABLE=\$<TARGET_FILE:pandoeditor>/);
  assert.match(app, /PANDO_PROVENANCE_FINALIZE=ON/);
  const bat = source('Pandoeditor-local.bat');
  const run = bat.slice(bat.indexOf(':run\n'), bat.indexOf(':smoke\n'));
  assert.ok(run.indexOf('call :check_provenance') < run.indexOf('start ""'));
  assert.match(bat, /PANDO_PROVENANCE_EXECUTABLE=%APP_EXE%/);
  assert.match(bat, /--parallel 1/);
});

test('physical network completion hands verification and installation to a worker', () => {
  const code = source('app/physicaldatastore.cpp');
  const start = code.slice(code.indexOf('void PhysicalDataStore::start('),
    code.indexOf('void PhysicalDataStore::finish('));
  const gui = start.slice(0, start.indexOf('watcher->setFuture'));
  assert.doesNotMatch(gui, /digest\(data\)|file\.write|installBytes\(/);
  assert.match(start.slice(start.indexOf('watcher->setFuture')), /installBytes\(root,asset,data\)/);
  const controller = source('app/editorcontroller.cpp');
  assert.doesNotMatch(controller, /physicalStore_->cleanupVersions\(/);
  assert.match(controller, /QtConcurrent::run\(physicalStore_->cleanupVersionsJob/);
});

test('cold hydro viewport admission never hashes files on the GUI thread', () => {
  const controller = source('app/editorcontroller.cpp');
  const admission = controller.slice(controller.indexOf('bool EditorController::physicalAssetReady('),
    controller.indexOf('void EditorController::requestPhysicalAsset('));
  assert.match(admission, /physicalStore_->candidatePath/);
  assert.match(admission, /physicalStore_->hasVerifiedExisting/);
  assert.doesNotMatch(admission, /resolveExisting|verifiedPhysicalAssetPath|readAll|verified\(/);
  const store = source('app/physicaldatastore.cpp');
  const known = store.slice(store.indexOf('bool PhysicalDataStore::hasVerifiedExisting('),
    store.indexOf('std::function<QString(const PhysicalAssetSpec&)> PhysicalDataStore::verifiedResolver('));
  assert.match(known, /verifiedfile::hasReceipt/);
  assert.doesNotMatch(known, /readAll|\.read\(|digest\(|verified\(/);
  const shard = source('app/hydroshardreader.cpp');
  assert.match(shard, /verifyHydroAsset\(asset_,error\)/,
    'candidate admission is not an integrity receipt; the cold decoder must verify');
});
