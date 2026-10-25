import {applicationModuleUrl} from '../../scripts/lib/application-source.mjs';
import { createMapVisualFrame } from "../../shared/frontend/js/modules/map-visual-frame.js";
import { readApplicationOwners } from '../../scripts/lib/application-source.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createProjectDomain } from "../../shared/frontend/js/modules/project-domain.js";
import { createNodeSelection } from '../helpers/core-selection.mjs';
import { createNodeCoreProject } from '../helpers/core-project.mjs';
import { createRenderingDomain } from "../../shared/frontend/js/modules/rendering-domain.js";
import { createGisDomain } from "../../apps/editor/frontend/js/modules/gis-domain.js";
import { createTestEditingDomain as createEditingDomain } from '../helpers/editing-domain.mjs';
import { MAP_RENDER_DIRTY, MAP_RENDER_MASKS } from "../../shared/frontend/js/modules/map-render-coordinator.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('ordinary pointer hover does not starve real GPU uploads while dragging retains the quiet window', async t => {
  const windowTarget = new globalThis.EventTarget(), documentTarget = new globalThis.EventTarget();
  const previousGlobals = ['window', 'document'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  Object.assign(globalThis, { window: windowTarget, document: documentTarget });
  t.after(() => { for (const [key, descriptor] of previousGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  } });
  let time = 0, scheduler, calls = 0;
  const frames = [];
  t.mock.method(performance, 'now', () => time);
  const owner = createRenderingDomain({ requestFrame: callback => (frames.push(callback), frames.length),
    gpuMapRenderer: { setUploadScheduler(value) { scheduler = value; } } });
  t.after(() => {
    scheduler.noteInput(false); time += 501;
    frames.splice(0).forEach(callback => callback());
    owner.dispose();
  });
  const tick = milliseconds => { time += milliseconds; frames.shift()?.(); };
  const upload = scheduler.enqueueUpload({ key: 'terrain', step: () => { calls++; return { done: true }; } });
  for (let index = 0; index < 10; index++) { documentTarget.dispatchEvent(new globalThis.Event('pointermove')); tick(100); }
  assert.equal(calls, 1, 'hover alone must not keep postponing terrain');
  await upload;
  documentTarget.dispatchEvent(new globalThis.Event('pointerdown'));
  const dragUpload = scheduler.enqueueUpload({ key: 'drag-terrain', step: () => { calls++; return { done: true }; } });
  documentTarget.dispatchEvent(new globalThis.Event('pointermove')); tick(1000);
  assert.equal(calls, 1, 'dragging still holds background uploads');
  documentTarget.dispatchEvent(new globalThis.Event('pointerup')); tick(499);
  assert.equal(calls, 1);
  tick(1); await dragUpload;
  assert.equal(calls, 2);
});

test('domain factories expose isolated public contracts', async t => {
  const owner=await createNodeSelection();t.after(() => owner.dispose());
  const project = owner.project;
  const selection = owner.domain;
  const rendering = createRenderingDomain();
  const gis = createGisDomain();
  const editing = createEditingDomain();
  t.after(() => { rendering.dispose();gis.dispose();editing.dispose(); });
  for (const [domain, methods] of [
    [project, ['snapshot', 'buildFileSnapshot', 'buildAutosave', 'prepareImport', 'executeCommand', 'admit', 'load', 'dispose']],
    [selection, ['snapshot', 'replace', 'toggle', 'selectRange', 'setMany', 'remove', 'prune', 'clear', 'resetProject', 'setHover', 'has', 'primary', 'size', 'createPacket', 'dispose']],
    [rendering, ['requestRender', 'invalidateView', 'invalidateViewport', 'invalidateProjection', 'invalidateProject', 'invalidateSelection', 'invalidateSelectionStyle', 'invalidateGpuFrame', 'invalidateGpuInteraction', 'invalidateEditingOverlays', 'invalidateGpuContext', 'invalidateQuality', 'invalidateBaseScene', 'beginInteraction', 'endInteraction', 'invalidateSelectionOverlay', 'syncSelectionEmphasis', 'getSelectionRenderStats', 'recordSelectionRenderError', 'invalidateEditedGeometryPatch', 'getDistributionRenderRows', 'getTerritorialBoundaryStats', 'dispose']],
    [gis, ['planImport', 'loadRiverPartitionFeatures', 'computeRiverPartition', 'dispose']],
    [editing, ['setTool', 'handleInteraction', 'createRenderPacket', 'startDraft', 'replaceDraftCoordinates', 'clearDraftHover', 'cancelActiveGesture', 'resetProject', 'draftInputActive', 'appendDraftScreenPoint', 'performDraftUndo', 'performDraftRedo', 'removeLastDraftPoint', 'deleteSelectedDraftPoint', 'moveSelectedDraftPointByPixels', 'redrawDraft', 'clearDraft', 'commitImport', 'snapshot', 'dispose']],
  ]) {
    for (const method of methods) assert.equal(typeof domain[method], 'function', `${method} is public`);
    assert.equal(Object.isFrozen(domain), true);
  }
  for (const method of [
    'refreshRenderResources',
    'getRenderResourceSnapshot',
    'setScene',
    'renderHover',
    'renderRiverPartitionEmphasis',
    'renderTerritorialInternalBoundaries',
    'handleContextLost',
    'handleContextRestored',
    'invalidate',
    'scheduleView',
    'invalidateProjectRender',
    'renderPass',
    'renderDraft',
    'renderDraftInsertionHandle',
    'renderVertices',
    'renderSnap',
    'beginFrame',
    'invalidateViewSettle',
    'renderGpuInteraction',
    'renderBoundaryEdit',
    'renderGeometryPreview',
    'renderSelection',
    'renderHoverOverlay',
    'renderTerritorialLabels',
    'renderUserLabels',
    'renderTerritorialLabelPositions',
    'renderUserLabelPositions',
    'renderHydroEdits',
    'renderCountries', 'renderHydro', 'renderTerritorialUnits', 'renderGenericFeatures', 'renderValidation',
    'renderDistributions',
    'renderBase',
    'renderProjectedOverlays',
  ]) assert.equal(rendering[method], undefined, `${method} is not a public rendering facade`);
  for (const method of ['createProject', 'undo', 'redo', 'save']) assert.equal(typeof project[method], 'function');
  for (const method of [
    'normalizeGeometry', 'validateGeometry', 'resolveCountryIdentity', 'planCountryImport',
    'planTerritorialImport', 'planCoastReconciliation', 'planRiverPartition', 'executeWorker', 'cancelWorker',
  ]) assert.equal(gis[method], undefined);
  for (const method of [
    'beginTool', 'updatePointer', 'finishTool', 'cancelTool', 'beginBoundaryEdit',
    'beginObjectVertexEdit', 'beginBoundaryVertexEdit', 'setDraftHover', 'selectDraftVertex',
    'applyGeometryPatch', 'executeTerritorialTransaction', 'commit', 'cancel', 'commitDraftCoords',
    'appendDraftCoordinate', 'insertDraftPoint', 'beginDraftStroke', 'appendDraftStroke',
    'finishDraftStroke', 'cancelDraftStroke', 'syncDraftAfterMutation', 'reconcileCoast',
  ]) assert.equal(editing[method], undefined);
  const snapshot = project.snapshot();
  assert.throws(() => { snapshot.territorialEntities[0].id = 'FRA'; },TypeError);
  assert.equal(project.snapshot().territorialEntities[0].id, 'A', 'the accepted projection is immutable');
  for(const retired of ['dispatch','entitiesFromAutosaveDelta','recordHistory','commitHistorySnapshot'])assert.equal(project[retired],undefined);
});

test('rendering domain commits label positions synchronously in the coordinator frame', () => {
  const frames = [];
  const rendering = createRenderingDomain({
    requestFrame: callback => { frames.push(callback); return frames.length; },
    prepareView: ({ frameId }) => testFrame(frameId, 1),
  });
  rendering.invalidateView('label-position-contract');
  frames.shift()();

  const stats = rendering.getStats();
  assert.equal(stats.labelPositionRequestCount, 1);
  assert.equal(stats.labelPositionMergedCount, 0);
  assert.equal(stats.labelPositionCommitCount, 1);
  assert.equal(stats.labelPositionLastFrameRevision, 1);
  rendering.dispose();
});

test('non-rendering domains have no direct platform ownership', () => {
  const modules = ['project-domain.js', 'selection-domain.js', 'gis-domain.js', 'editing-domain.js'];
  for (const name of modules) {
    const source = fs.readFileSync(applicationModuleUrl(name), 'utf8');
    for (const token of ['document.', 'window.', 'getContext(', 'createElement(']) {
      assert.equal(source.includes(token), false, `${name} does not use ${token}`);
    }
  }
});

test('editing domain owns draft coordinate history operations', async () => {
  const editing = createEditingDomain({
    draftServices: {
      getToolConfig: () => ({ profile: 'freehand', shape: 'line', minimumPoints: 2 }),
      screenToCoordinate: value => value,
    },
  });
  assert.equal(await editing.appendDraftScreenPoint([1, 2]), true);
  assert.deepEqual(editing.snapshot().draft.coords, [[1, 2]]);
  assert.equal(await editing.appendDraftScreenPoint([1, 2], 'mouse', { dedupe: true }), false);
  assert.equal(editing.snapshot().draft.historyCount, 1);
});

test('editing domain publishes Core draft coordinates while its platform adapter owns stroke samples', async () => {
  const events = [];
  const editing = createEditingDomain({
    draftServices: {
      getToolConfig: () => ({ profile: 'freehand', shape: 'line' }),
      isSpacePanActive: () => false,
      screenSample: point => ({ screen: point.slice(), coordinate: point.slice() }),
      projectCoordinate: value => value,
      minimumPoints: () => 2,
    },
    onEditingStateChanged: snapshot => events.push(snapshot.reason),
  });
  const interact = async (type, detail) => {
    const packet = editing.createRenderPacket();
    return await editing.handleInteraction({
      type,
      projectGeneration: packet.projectGeneration,
      packetRevision: packet.revision,
      ...detail,
    });
  };
  assert.equal(await interact('draft-stroke-start', { screenPoint: [1, 2], pointerId: 1 }), true);
  assert.equal(await interact('draft-stroke-move', { screenPoints: [[30, 30]] }), true);
  assert.equal(await interact('draft-stroke-end', { screenPoint: [60, 60] }), true);
  assert.deepEqual(events, ['draft-stroke-begin', 'draft-stroke-update', 'draft-stroke-update', 'draft-stroke-finish']);
});

test('app bootstrap wires every domain factory', () => {
  const source = readApplicationOwners('domain-assembly', 'map-audit');
  for (const factory of ['createProjectDomain', 'createSelectionDomain', 'createRenderingDomain', 'createGisDomain', 'createEditingDomain']) {
    assert.match(source, new RegExp(`${factory}\\(`));
  }
  assert.doesNotMatch(source, /window\.PANDOLAB_(?:DOMAINS|DOMAIN_CONTEXT)\s*=/);
});

test('app delegates interaction rendering to rendering domain', () => {
  const source = readApplicationOwners('domain-assembly', 'map-audit');
  for (const name of [
    'renderDraft',
    'renderGeometryPreview',
    'renderGpuInteractionFrame',
    'renderHoverOverlay',
    'renderValidationOverlay',
    'renderSnapIndicator',
    'renderEditedGeometryPatch',
    'renderViewFrame',
  ]) {
    assert.doesNotMatch(source, new RegExp(`function ${name}\\b`), `${name} remains app-owned`);
  }
  assert.match(source, /getEditingRenderPacket:\s*\(\)\s*=>\s*editingDomain\?\.createRenderPacket/);
  assert.doesNotMatch(source, /renderingDomain\?\.render(?:Draft|DraftInsertionHandle|Vertices|Snap)\?\./);
  assert.match(source, /renderingDomain\?\.invalidateEditingOverlays\(/);
  assert.doesNotMatch(source, /mapRenderCoordinator|MAP_RENDER_DIRTY/);
  const renderingSource = fs.readFileSync(path.join(root, 'shared/frontend/js/modules/rendering-domain.js'), 'utf8');
  assert.match(renderingSource, /gpuInteraction:\s*renderGpuInteraction/);
});

test('selection domain projects Core selection and hover revisions without serialized change detection', async t => {
  let renderRequests = 0;
  const changes = [];
  const country = id => ({ domain: 'territorial', type: 'entity', id });
  const owner = await createNodeSelection({ territorialIds: ['DEU','FRA'],genericIds: [],labelIds: [],distributionIds: [],
    onSelectionChanged: (snapshot, reason) => changes.push(['selection', snapshot.revision, reason]),
    onHoverChanged: snapshot => changes.push(['hover', snapshot.hoverRevision]),
    requestRender: () => { renderRequests += 1; },
  });
  t.after(() => owner.dispose());const selection=owner.domain;
  const initial = selection.snapshot();
  assert.strictEqual(await selection.clear(), initial);
  assert.equal(renderRequests, 0);
  const selected = await selection.replace(country('DEU'));
  assert.equal(selected.revision, initial.revision + 1);
  assert.equal(renderRequests, 1);
  assert.strictEqual(await selection.replace(country('DEU')), selected);
  assert.equal(renderRequests, 1);
  const hovered = await selection.setHover(country('FRA'));
  assert.equal(hovered.revision, selected.revision);
  assert.equal(hovered.hoverRevision, initial.hoverRevision + 1);
  assert.equal(renderRequests, 2);
  assert.strictEqual(await selection.setHover({ ...country('FRA') }), hovered);
  assert.strictEqual(await selection.setHover({ domain: 'invalid', type: 'country', id: 'FRA' }), hovered);
  assert.equal(renderRequests, 2);
  assert.deepEqual(changes.map(change => change[0]), ['selection', 'hover']);
  assert.deepEqual(selection.stats(), {
    selectionRevision: 1,
    selectionHoverRevision: 1,
    selectionMutationCount: 2,
    selectionNoOpCount: 4,
    selectionRenderInvalidationCount: 2,
  });
  assert.equal(Object.isFrozen(hovered.selection.items), true);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'shared/frontend/js/modules/selection-domain.js'), 'utf8'), /JSON\.stringify/);
});

test('rendering domain owns domain-specific invalidation masks', () => {
  const frames = [];
  const rendering = createRenderingDomain({
    requestFrame: callback => frames.push(callback),
    prepareView: () => testFrame(),
  });
  rendering.invalidateSelection('selection');
  frames.shift()();
  assert.equal(rendering.getStats().lastRequestedMask, MAP_RENDER_DIRTY.SELECTION_DATA | MAP_RENDER_DIRTY.GPU_INTERACTION);
  rendering.invalidateView('view');
  frames.shift()();
  assert.equal(rendering.getStats().lastRequestedMask, MAP_RENDER_MASKS.VIEW);
  rendering.invalidateCountryPatch('country');
  frames.shift()();
  assert.equal((rendering.getStats().lastRequestedMask & MAP_RENDER_DIRTY.COUNTRY_PATCH) !== 0, true);
  assert.equal((rendering.getStats().lastRequestedMask & MAP_RENDER_DIRTY.SELECTION_VIEW) === 0, true);
});

test('view-only selection rendering reprojects only existing SVG fallbacks without another GPU frame', () => {
  const frames = [];
  let gpuInteractionRenders = 0;
  let projectedPaths = 0;
  const pathSelection = features => ({
    attr(name, callback) {
      assert.equal(name, 'd');
      for (const feature of features) callback(feature);
      return this;
    },
  });
  const layer = features => ({
    selectAll: selector => {
      assert.match(selector, /^path\.map-(selection|hover)-shape$/);
      return pathSelection(features);
    },
  });
  const rendering = createRenderingDomain({
    requestFrame: callback => { frames.push(callback); return frames.length; },
    prepareView: ({ frameId }) => testFrame(frameId, 8, () => { projectedPaths += 1; return 'M0,0L1,1'; }),
    gpuMapRenderer: {
      getRuntimeState(){return {renderer:'svg',projectRenderBlocked:false};},
      renderInteraction() {
        gpuInteractionRenders += 1;
        return { succeeded: true };
      },
    },
    selectionResources: {
      selectionLayer: layer([{ type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } }]),
      hoverLayer: layer([]),
      publishMetrics: () => {},
    },
  });
  rendering.invalidateView('sparse-selection-fallback');
  frames.shift()();
  assert.equal(projectedPaths, 1);
  assert.equal(gpuInteractionRenders, 0);
});

test('view-only selection rendering is a no-op when no SVG fallback exists', () => {
  const frames = [];
  let gpuInteractionRenders = 0;
  const emptyLayer = {
    selectAll: () => ({ attr: () => {} }),
  };
  const rendering = createRenderingDomain({
    requestFrame: callback => { frames.push(callback); return frames.length; },
    prepareView: ({ frameId }) => testFrame(frameId, 9),
    gpuMapRenderer: {
      getRuntimeState(){return {renderer:'svg',projectRenderBlocked:false};},
      renderInteraction() {
        gpuInteractionRenders += 1;
        return { succeeded: true };
      },
    },
    selectionResources: {
      selectionLayer: emptyLayer,
      hoverLayer: emptyLayer,
      path: () => { throw new Error('no fallback path should be projected'); },
    },
  });
  rendering.invalidateView('empty-selection-fallback');
  frames.shift()();
  assert.equal(gpuInteractionRenders, 0);
});

test('project domain uses the Core codec for detached file output and asynchronous autosave receipts', async t => {
  const seed=JSON.parse(fs.readFileSync(path.join(root,'tests/fixtures/portability/web-document-seed.json'),'utf8'));
  const owner=await createNodeCoreProject(seed,{ appVersion: 'fixture' });t.after(() => owner.dispose());
  const project=owner.project,before=project.snapshot(),state=owner.client.state();
  const body=(await project.buildFileSnapshot()).project,receipt=await project.buildAutosave();
  assert.equal(body.format,'pandolab-project-state');assert.equal(body.version,'fixture');
  assert.equal(receipt.project.format,'pandolab-autosave-full');assert.equal(receipt.checkpoint.projectGeneration,0);
  assert.equal(receipt.checkpoint.epoch,state.epoch);assert.equal(Object.hasOwn(receipt.project,'checkpoint'),false);
  body.territorialEntities[0].properties.name='Detached file mutation';
  assert.equal(project.snapshot(),before);assert.deepEqual(owner.client.state(),state);
});

test('project replacement advances generation once before the canonical swap', async t => {
  const resets = [];
  let replaceOptions = null;
  const seed=JSON.parse(fs.readFileSync(path.join(root,'tests/fixtures/portability/web-document-seed.json'),'utf8'));
  const owner=await createNodeCoreProject(seed,{
    replaceSnapshot: async (_value, options) => { replaceOptions = options; return true; },
    onProjectReset: event => resets.push(event),
  });
  t.after(() => owner.dispose());const project=owner.project;
  await project.load(seed);
  assert.equal(project.getGeneration(), 1);
  assert.deepEqual(replaceOptions, { reason: 'load', generation: 1, skipRenderReset: true });
  assert.equal(resets.length, 1);
});

test('project domain executes typed Core commands and emits only accepted changes', async t => {
  const changed = [];
  const seed=JSON.parse(fs.readFileSync(path.join(root,'tests/fixtures/portability/web-document-seed.json'),'utf8'));
  const owner=await createNodeCoreProject(seed,{
    onProjectChanged: event => changed.push(event),
  });
  t.after(() => owner.dispose());const project=owner.project;
  const command={ commandId: 'territorial.metadata',targets: [{ domain: 'territorial',id: 'A' }],payload: { id: 'A',field: 'name',valuePresent: true,value: 'Updated name' } };
  const first = await project.executeCommand(command);
  assert.equal(first.ok, true);
  assert.equal((await project.executeCommand(command)).changed,false);
  const rejected=await project.executeCommand({ ...command,targets: [{ domain: 'territorial',id: 'missing' }],payload: { ...command.payload,id: 'missing' } });
  assert.equal(rejected.ok,false);assert.equal(rejected.changed,false);
  assert.equal(changed.length, 1);
  assert.equal(changed[0].reason, 'territorial.metadata');
});

test('project command boundary rejects a missing Core owner and malformed command identifiers explicitly', async t => {
  const withoutOwner = createProjectDomain({ productMode:'editor' });
  await assert.rejects(withoutOwner.executeCommand({ commandId: 'generic.create' }),TypeError);
  const seed=JSON.parse(fs.readFileSync(path.join(root,'tests/fixtures/portability/web-document-seed.json'),'utf8'));
  const owner=await createNodeCoreProject(seed);t.after(() => owner.dispose());
  await assert.rejects(owner.project.executeCommand({ type: 'legacy-command',targets: [],payload: {} }),{ code: 'CORE_COMMAND_ID' });
});

test('Core selection admission owns existence while packet revisions reflect accepted immutable projections', async t => {
  const owner=await createNodeSelection({ territorialIds: ['DEU'],genericIds: [],labelIds: [],distributionIds: [] });
  t.after(() => owner.dispose());const selection=owner.domain;
  await selection.replace({ domain: 'territorial', type: 'entity', id: 'DEU' });
  await selection.setHover({ domain: 'territorial', type: 'entity', id: 'DEU' });
  const packet = selection.createPacket({ geometryRevision: 'geometry-1' });
  assert.equal(packet.revision, selection.snapshot().revision);
  assert.equal(packet.hoverRevision, selection.snapshot().hoverRevision);
  assert.equal(packet.geometryRevision, 'geometry-1');
  const before = selection.snapshot();
  await selection.replace({ domain: 'territorial', type: 'entity', id: 'FRA' });
  assert.strictEqual(selection.snapshot(), before, 'invalid refs are no-ops');
});

test('selection domain keeps large multi-selection snapshots cached and resets atomically', async t => {
  let renderRequests = 0;
  const refs = Array.from({ length: 1000 }, (_, index) => ({
    domain: 'territorial', type: 'entity', id: `feature-${index}`,
  }));
  const owner=await createNodeSelection({ territorialIds: refs.map(ref => ref.id),genericIds: [],labelIds: [],distributionIds: [],requestRender: () => { renderRequests += 1; } });
  t.after(() => owner.dispose());const selection=owner.domain;
  const selected = await selection.setMany(refs, { primary: refs.at(-1), scope: 'map' });
  assert.equal(selected.selection.items.length, 1000);
  assert.strictEqual(selection.snapshot(), selected);
  assert.equal(renderRequests, 1);
  const same = await selection.setMany(refs.map(ref => ({ ...ref })), { primary: { ...refs.at(-1) }, scope: 'map' });
  assert.strictEqual(same, selected);
  assert.equal(renderRequests, 1);
  await selection.setHover(refs[0]);
  const beforeReset = selection.snapshot();
  owner.setGeneration(9);
  const reset = await selection.resetProject(9);
  assert.equal(reset.projectGeneration, 9);
  assert.equal(reset.selection.items.length, 0);
  assert.equal(reset.hover, null);
  assert.equal(reset.revision, beforeReset.revision + 1);
  assert.equal(reset.hoverRevision, beforeReset.hoverRevision + 1);
  assert.equal(renderRequests, 3, 'selection, hover, and atomic reset each invalidate once');
  assert.equal(selection.stats().selectionMutationCount, 3);
});

test('rendering domain owns territorial boundary cache state and resets it per project generation', () => {
  const rendering = createRenderingDomain();
  assert.deepEqual(rendering.getTerritorialBoundaryStats(), {
    rebuildCount: 0,
    revision: '',
    inputSignature: '',
    batchSignature: '',
    segmentCount: 0,
    groupCount: 0,
    pendingInputSignature: '',
    pendingStatus: 'idle',
  });
  assert.equal(rendering.resetProjectGeneration(12), 12);
  assert.deepEqual(rendering.getTerritorialBoundaryStats(), {
    rebuildCount: 0,
    revision: '',
    inputSignature: '',
    batchSignature: '',
    segmentCount: 0,
    groupCount: 0,
    pendingInputSignature: '',
    pendingStatus: 'idle',
  });
  assert.equal(rendering.getStats().territorialBoundaryTopologyRebuildCount, 0);
  assert.equal(rendering.getStats().territorialBoundaryRevision, '');
  rendering.dispose();
});

test('GIS domain owns river source orchestration without mutating donors', async () => {
  const donor = { id: 'DEU', geometry: { type: 'Polygon', coordinates: [] } };
  let queried = 0;
  const gis = createGisDomain({
    riverPartitionSource: {
      ensureReady: async () => true,
      queryBounds: () => [{ minX: 0, minY: 0, maxX: 1, maxY: 1 }],
      queryLogicalFeatures: async () => { queried += 1; return ['r1']; },
      loadLogicalFeature: async id => ({ id, properties: { category: 'river' }, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } }),
      getEditRivers: () => [],
      featureKey: feature => String(feature.id),
    },
  });
  const before = structuredClone(donor);
  const result = await gis.loadRiverPartitionFeatures([donor]);
  assert.equal(queried, 1);
  assert.equal(result.features.length, 1);
  assert.deepEqual(donor, before);
  gis.dispose();
});

const testFrame = (frameId = 1, viewRevision = 1, projectPath = () => 'M0,0L1,1') => createMapVisualFrame({
  frameId, viewRevision, projectionRevision: 1,
  viewState: { projection: 'flat', size: { width: 800, height: 600 }, translate: [400, 300], scale: 100, dpr: 1 }, projectPath });
