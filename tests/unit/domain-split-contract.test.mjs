import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createProjectDomain } from '../../assets/js/modules/project-domain.js';
import { createSelectionDomain } from '../../assets/js/modules/selection-domain.js';
import { createRenderingDomain } from '../../assets/js/modules/rendering-domain.js';
import { createGisDomain } from '../../assets/js/modules/gis-domain.js';
import { createEditingDomain } from '../../assets/js/modules/editing-domain.js';
import { MAP_RENDER_DIRTY, MAP_RENDER_MASKS } from '../../assets/js/modules/map-render-coordinator.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('domain factories expose isolated public contracts', () => {
  const projectState = { countries: [{ id: 'DEU' }] };
  const project = createProjectDomain({ getSnapshot: () => projectState });
  const selection = createSelectionDomain();
  const rendering = createRenderingDomain();
  const gis = createGisDomain();
  const editing = createEditingDomain();
  for (const [domain, methods] of [
    [project, ['snapshot', 'buildProject', 'buildAutosave', 'countriesFromAutosaveDelta', 'dispatch', 'load', 'createEmpty', 'undo', 'redo', 'save', 'dispose']],
    [selection, ['snapshot', 'replace', 'toggle', 'selectRange', 'setMany', 'remove', 'prune', 'clear', 'resetProject', 'setHover', 'has', 'primary', 'size', 'createPacket', 'dispose']],
    [rendering, ['requestRender', 'invalidateView', 'invalidateViewSettle', 'invalidateViewport', 'invalidateProjection', 'invalidateProject', 'invalidateSelection', 'invalidateSelectionStyle', 'invalidateGpuFrame', 'invalidateGpuInteraction', 'invalidateEditingOverlays', 'invalidateGpuContext', 'invalidateQuality', 'invalidateBaseScene', 'beginInteraction', 'endInteraction', 'renderGpuInteraction', 'renderBoundaryEdit', 'renderGeometryPreview', 'renderSelection', 'renderHoverOverlay', 'invalidateSelectionOverlay', 'syncSelectionEmphasis', 'getSelectionRenderStats', 'recordSelectionRenderError', 'renderValidation', 'invalidateEditedGeometryPatch', 'renderCountryLabels', 'renderUserLabels', 'renderCountryLabelPositions', 'renderUserLabelPositions', 'renderCountries', 'renderHydro', 'renderHydroEdits', 'renderTerritorialUnits', 'renderGenericFeatures', 'renderDistributions', 'getDistributionRenderRows', 'renderBase', 'renderProjectedOverlays', 'getTerritorialBoundaryStats', 'dispose']],
    [gis, ['normalizeGeometry', 'validateGeometry', 'resolveCountryIdentity', 'planImport', 'planRiverPartition', 'loadRiverPartitionFeatures', 'computeRiverPartition', 'executeWorker', 'dispose']],
    [editing, ['setTool', 'beginTool', 'updatePointer', 'finishTool', 'cancelTool', 'handleInteraction', 'createRenderPacket', 'startDraft', 'replaceDraftCoordinates', 'setDraftHover', 'clearDraftHover', 'selectDraftVertex', 'cancelActiveGesture', 'resetProject', 'applyGeometryPatch', 'commit', 'draftInputActive', 'commitDraftCoords', 'appendDraftCoordinate', 'appendDraftScreenPoint', 'performDraftUndo', 'performDraftRedo', 'removeLastDraftPoint', 'deleteSelectedDraftPoint', 'insertDraftPoint', 'moveSelectedDraftPointByPixels', 'beginDraftStroke', 'appendDraftStroke', 'finishDraftStroke', 'cancelDraftStroke', 'redrawDraft', 'syncDraftAfterMutation', 'clearDraft', 'commitImport', 'reconcileCoast', 'dispose']],
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
  ]) assert.equal(rendering[method], undefined, `${method} is not a public rendering facade`);
  const snapshot = project.snapshot();
  snapshot.countries[0].id = 'FRA';
  assert.equal(project.snapshot().countries[0].id, 'DEU', 'project snapshot is detached');
});

test('rendering domain coalesces label positions behind a 30Hz cadence', () => {
  let clock = 0;
  const frames = [];
  const timers = [];
  const rendering = createRenderingDomain({
    labelPositionCadence: {
      maxHz: 30,
      now: () => clock,
      requestFrame: callback => { frames.push(callback); return frames.length; },
      cancelFrame: () => {},
      setTimer: (callback, delay) => { timers.push({ callback, delay }); return timers.length; },
      clearTimer: () => {},
    },
  });

  rendering.renderCountryLabelPositions({ revision: 1 });
  rendering.renderUserLabelPositions({ revision: 1 });
  assert.equal(frames.length, 1);
  assert.equal(timers.length, 0);
  frames.shift()();
  assert.equal(rendering.getStats().labelPositionCommitCount, 1);

  clock = 10;
  rendering.renderCountryLabelPositions({ revision: 2 });
  rendering.renderUserLabelPositions({ revision: 2 });
  assert.equal(timers.length, 1);
  assert.ok(timers[0].delay >= 23 && timers[0].delay <= 24);
  clock = 34;
  timers.shift().callback();
  assert.equal(frames.length, 1);
  frames.shift()();

  const stats = rendering.getStats();
  assert.equal(stats.labelPositionRequestCount, 4);
  assert.equal(stats.labelPositionMergedCount, 2);
  assert.equal(stats.labelPositionCommitCount, 2);
  assert.equal(stats.labelPositionLastFrameRevision, 2);
  rendering.dispose();
});

test('non-rendering domains have no direct platform ownership', () => {
  const modules = ['project-domain.js', 'selection-domain.js', 'gis-domain.js', 'editing-domain.js'];
  for (const name of modules) {
    const source = fs.readFileSync(path.join(root, 'assets/js/modules', name), 'utf8');
    for (const token of ['document.', 'window.', 'getContext(', 'createElement(']) {
      assert.equal(source.includes(token), false, `${name} does not use ${token}`);
    }
  }
});

test('editing domain owns draft coordinate history operations', () => {
  const editing = createEditingDomain({
    draftServices: { getToolConfig: () => ({ profile: 'freehand', shape: 'line', minimumPoints: 2 }) },
  });
  assert.equal(editing.appendDraftCoordinate([1, 2]), true);
  assert.deepEqual(editing.snapshot().draft.coords, [[1, 2]]);
  assert.equal(editing.appendDraftCoordinate([1, 2], { dedupe: true }), false);
  assert.equal(editing.snapshot().draft.historyCount, 1);
});

test('editing domain owns draft stroke lifecycle and delegates only platform adapters', () => {
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
  assert.equal(editing.beginDraftStroke([1, 2], { pointerId: 1 }), true);
  assert.equal(editing.appendDraftStroke([[30, 30]]), true);
  assert.equal(editing.finishDraftStroke([60, 60]), true);
  assert.deepEqual(events, ['draft-stroke-begin', 'draft-stroke-update', 'draft-stroke-update', 'draft-stroke-finish']);
});

test('app bootstrap wires every domain factory', () => {
  const source = fs.readFileSync(path.join(root, 'assets/js/app.js'), 'utf8');
  for (const factory of ['createProjectDomain', 'createSelectionDomain', 'createRenderingDomain', 'createGisDomain', 'createEditingDomain']) {
    assert.match(source, new RegExp(`${factory}\\(`));
  }
  assert.doesNotMatch(source, /window\.PANDOLAB_(?:DOMAINS|DOMAIN_CONTEXT)\s*=/);
});

test('app delegates interaction rendering to rendering domain', () => {
  const source = fs.readFileSync(path.join(root, 'assets/js/app.js'), 'utf8');
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
  assert.match(source, /renderingDomain\?\.renderValidation\?\./);
  assert.doesNotMatch(source, /mapRenderCoordinator|MAP_RENDER_DIRTY/);
  const renderingSource = fs.readFileSync(path.join(root, 'assets/js/modules/rendering-domain.js'), 'utf8');
  assert.match(renderingSource, /gpuInteraction:\s*renderGpuInteraction/);
});

test('selection domain owns selection and hover revisions without serialized change detection', () => {
  let renderRequests = 0;
  const changes = [];
  const country = id => ({ domain: 'territorial', type: 'country', id });
  const selection = createSelectionDomain({
    onSelectionChanged: (snapshot, reason) => changes.push(['selection', snapshot.revision, reason]),
    onHoverChanged: snapshot => changes.push(['hover', snapshot.hoverRevision]),
    requestRender: () => { renderRequests += 1; },
  });
  const initial = selection.snapshot();
  assert.strictEqual(selection.clear(), initial);
  assert.equal(renderRequests, 0);
  const selected = selection.replace(country('DEU'));
  assert.equal(selected.revision, initial.revision + 1);
  assert.equal(renderRequests, 1);
  assert.strictEqual(selection.replace(country('DEU')), selected);
  assert.equal(renderRequests, 1);
  const hovered = selection.setHover(country('FRA'));
  assert.equal(hovered.revision, selected.revision);
  assert.equal(hovered.hoverRevision, initial.hoverRevision + 1);
  assert.equal(renderRequests, 2);
  assert.strictEqual(selection.setHover({ ...country('FRA') }), hovered);
  assert.strictEqual(selection.setHover({ domain: 'invalid', type: 'country', id: 'FRA' }), hovered);
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
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'assets/js/modules/selection-domain.js'), 'utf8'), /JSON\.stringify/);
});

test('rendering domain owns domain-specific invalidation masks', () => {
  const frames = [];
  const rendering = createRenderingDomain({
    requestFrame: callback => frames.push(callback),
    prepareView: () => ({ revision: 1 }),
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
    gpuMapRenderer: {
      renderInteraction() {
        gpuInteractionRenders += 1;
        return { succeeded: true };
      },
    },
    selectionResources: {
      selectionLayer: layer([{ type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } }]),
      hoverLayer: layer([]),
      path: () => { projectedPaths += 1; return 'M0,0L1,1'; },
      publishMetrics: () => {},
    },
  });
  const result = rendering.renderSelection(
    { revision: 8 },
    null,
    { viewOnly: true, updateData: false, gpuFrameResult: { succeeded: true, selection: { succeeded: true } } },
  );
  assert.equal(result, true);
  assert.equal(projectedPaths, 1);
  assert.equal(gpuInteractionRenders, 0);
});

test('view-only selection rendering is a no-op when no SVG fallback exists', () => {
  let gpuInteractionRenders = 0;
  const emptyLayer = {
    selectAll: () => ({ attr: () => {} }),
  };
  const rendering = createRenderingDomain({
    gpuMapRenderer: {
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
  assert.equal(rendering.renderSelection(
    { revision: 9 },
    null,
    { viewOnly: true, updateData: false, gpuFrameResult: { succeeded: true, selection: { succeeded: true } } },
  ), false);
  assert.equal(gpuInteractionRenders, 0);
});

test('project domain owns serializer snapshots and autosave data', () => {
  const project = createProjectDomain({
    serializer: {
      buildProject: () => ({ countriesData: { features: [{ id: 'DEU' }] } }),
      buildAutosave: () => ({ format: 'pandolab-autosave-delta', countries: [{ id: 'DEU' }] }),
    },
  });
  assert.deepEqual(project.buildProject(), { countriesData: { features: [{ id: 'DEU' }] } });
  assert.deepEqual(project.snapshot(), project.buildProject());
  assert.deepEqual(project.buildAutosave(), { format: 'pandolab-autosave-delta', countries: [{ id: 'DEU' }] });
});

test('project replacement advances generation once before the canonical swap', async () => {
  const resets = [];
  let replaceOptions = null;
  const project = createProjectDomain({
    replaceSnapshot: async (_value, options) => { replaceOptions = options; return true; },
    onProjectReset: event => resets.push(event),
  });
  await project.load({ countriesData: { features: [] } });
  assert.equal(project.getGeneration(), 1);
  assert.deepEqual(replaceOptions, { reason: 'load', generation: 1, skipRenderReset: true });
  assert.equal(resets.length, 1);
});

test('project domain dispatch delegates to execute and emits only successful changes', async () => {
  const calls = [];
  const changed = [];
  const results = [
    { ok: true, changed: true, value: 1 },
    { ok: true, changed: false, value: 1 },
    { ok: false, changed: false, error: new Error('rejected') },
  ];
  const project = createProjectDomain({
    commandPipeline: {
      execute(id, context, payload) {
        calls.push({ id, context, payload });
        return results.shift();
      },
    },
    onProjectChanged: event => changed.push(event),
  });
  const first = await project.dispatch({ id: 'generic.update', context: { source: 'test' }, payload: { id: 'g-1' } });
  assert.equal(first.ok, true);
  await project.dispatch({ id: 'generic.noop' });
  await project.dispatch({ id: 'generic.reject' });
  assert.deepEqual(calls, [
    { id: 'generic.update', context: { source: 'test' }, payload: { id: 'g-1' } },
    { id: 'generic.noop', context: {}, payload: undefined },
    { id: 'generic.reject', context: {}, payload: undefined },
  ]);
  assert.equal(changed.length, 1);
  assert.equal(changed[0].reason, 'generic.update');
});

test('project domain dispatch rejects missing ids and missing pipelines explicitly', async () => {
  const withoutPipeline = createProjectDomain();
  await assert.rejects(withoutPipeline.dispatch({ id: 'generic.update' }), /commandPipeline with execute/);
  const withPipeline = createProjectDomain({ commandPipeline: { execute: () => ({ ok: true, changed: true }) } });
  await assert.rejects(withPipeline.dispatch({ type: 'legacy-command' }), /requires a command id/);
});

test('selection controller storage and packet revisions are owned by the selection domain', () => {
  const packets = [];
  const selection = createSelectionDomain({
    refExists: value => value?.id === 'DEU',
    selectionPacketFactory: value => { packets.push(value); return value; },
  });
  selection.replace({ domain: 'territorial', type: 'country', id: 'DEU' });
  selection.setHover({ domain: 'territorial', type: 'country', id: 'DEU' });
  const packet = selection.createPacket({ geometryRevision: 'geometry-1' });
  assert.equal(packet.revision, selection.snapshot().revision);
  assert.equal(packet.hoverRevision, selection.snapshot().hoverRevision);
  assert.equal(packet.geometryRevision, 'geometry-1');
  assert.equal(packets.length, 1);
  const before = selection.snapshot();
  selection.replace({ domain: 'territorial', type: 'country', id: 'FRA' });
  assert.strictEqual(selection.snapshot(), before, 'invalid refs are no-ops');
});

test('selection domain keeps large multi-selection snapshots cached and resets atomically', () => {
  let renderRequests = 0;
  const selection = createSelectionDomain({ requestRender: () => { renderRequests += 1; } });
  const refs = Array.from({ length: 1000 }, (_, index) => ({
    domain: 'generic', type: 'feature', id: `feature-${index}`,
  }));
  const selected = selection.setMany(refs, { primary: refs.at(-1), scope: 'map' });
  assert.equal(selected.selection.items.length, 1000);
  assert.strictEqual(selection.snapshot(), selected);
  assert.equal(renderRequests, 1);
  const same = selection.setMany(refs.map(ref => ({ ...ref })), { primary: { ...refs.at(-1) }, scope: 'map' });
  assert.strictEqual(same, selected);
  assert.equal(renderRequests, 1);
  selection.setHover(refs[0]);
  const beforeReset = selection.snapshot();
  const reset = selection.resetProject(9);
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
  });
  assert.equal(rendering.resetProjectGeneration(12), 12);
  assert.deepEqual(rendering.getTerritorialBoundaryStats(), {
    rebuildCount: 0,
    revision: '',
    inputSignature: '',
    batchSignature: '',
    segmentCount: 0,
    groupCount: 0,
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
