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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('domain factories expose isolated public contracts', () => {
  const projectState = { countries: [{ id: 'DEU' }] };
  const project = createProjectDomain({ getSnapshot: () => projectState });
  const selectionController = {
    snapshot: () => ({ primaryKey: 'a', keys: ['a'], items: [{ id: 'a' }] }),
    replace: () => {},
    toggle: () => {},
    clear: () => {},
    items: () => [{ id: 'a' }],
  };
  const selection = createSelectionDomain({ selectionController });
  const rendering = createRenderingDomain();
  const gis = createGisDomain();
  const editing = createEditingDomain();
  for (const [domain, methods] of [
    [project, ['snapshot', 'buildProject', 'buildAutosave', 'countriesFromAutosaveDelta', 'dispatch', 'load', 'createEmpty', 'undo', 'redo', 'save', 'dispose']],
    [selection, ['snapshot', 'select', 'toggle', 'clear', 'setHover', 'selectObjectRef', 'createPacket', 'dispose']],
    [rendering, ['setScene', 'invalidate', 'renderPass', 'renderDraft', 'renderGpuInteraction', 'renderVertices', 'renderSnap', 'renderBoundaryEdit', 'renderGeometryPreview', 'renderSelection', 'renderHover', 'renderHoverOverlay', 'invalidateSelectionOverlay', 'syncSelectionEmphasis', 'getSelectionRenderStats', 'recordSelectionRenderError', 'renderValidation', 'invalidateEditedGeometryPatch', 'renderCountryLabels', 'renderUserLabels', 'renderCountryLabelPositions', 'renderUserLabelPositions', 'renderCountries', 'renderHydro', 'renderHydroEdits', 'renderTerritorialUnits', 'renderGenericFeatures', 'renderDistributions', 'getDistributionRenderRows', 'renderTerritorialInternalBoundaries', 'renderBase', 'renderProjectedOverlays', 'getTerritorialBoundaryStats', 'dispose']],
    [gis, ['normalizeGeometry', 'validateGeometry', 'resolveCountryIdentity', 'planRiverPartition', 'loadRiverPartitionFeatures', 'computeRiverPartition', 'executeWorker', 'dispose']],
    [editing, ['setTool', 'beginTool', 'updatePointer', 'finishTool', 'cancelTool', 'applyGeometryPatch', 'commit', 'draftInputActive', 'commitDraftCoords', 'appendDraftCoordinate', 'performDraftUndo', 'performDraftRedo', 'removeLastDraftPoint', 'deleteSelectedDraftPoint', 'insertDraftPoint', 'moveSelectedDraftPointByPixels', 'beginDraftStroke', 'appendDraftStroke', 'finishDraftStroke', 'cancelDraftStroke', 'redrawDraft', 'syncDraftAfterMutation', 'clearDraft', 'importProject', 'mergeCountries', 'importTerritorial', 'importGeneric', 'importDistribution', 'commitImport', 'reconcileCoast', 'dispose']],
  ]) {
    for (const method of methods) assert.equal(typeof domain[method], 'function', `${method} is public`);
    assert.equal(Object.isFrozen(domain), true);
  }
  const snapshot = project.snapshot();
  snapshot.countries[0].id = 'FRA';
  assert.equal(project.snapshot().countries[0].id, 'DEU', 'project snapshot is detached');
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
  let coords = [];
  const edit = { selectedVertexIndex: null };
  const snapshots = [];
  const editing = createEditingDomain({
    renderPackets: {
      draft: {
        isActive: () => true,
        getCoords: () => coords,
        setCoords: value => { coords = value; },
        getEdit: () => edit,
        setSelectedVertex: value => { edit.selectedVertexIndex = value; },
        setInputPhase: () => {},
        isStrokeActive: () => false,
        recordSnapshot: (_state, value, selected) => snapshots.push({ coords: value.map(point => point.slice()), selected }),
        syncAfterMutation: () => {},
        coordNear: (a, b, tolerance) => Math.abs(a[0] - b[0]) <= tolerance && Math.abs(a[1] - b[1]) <= tolerance,
        undoSnapshot: () => null,
        redoSnapshot: () => null,
      },
    },
  });
  assert.equal(editing.appendDraftCoordinate([1, 2]), true);
  assert.deepEqual(coords, [[1, 2]]);
  assert.equal(editing.appendDraftCoordinate([1, 2], { dedupe: true }), false);
  assert.equal(snapshots.length, 1);
});

test('editing domain owns draft stroke lifecycle and delegates only platform adapters', () => {
  const events = [];
  let active = false;
  const samples = [];
  const editing = createEditingDomain({
    draftInput: {
      getToolConfig: () => ({ profile: 'freehand', shape: 'line' }),
      getInputPhase: () => 'draw',
      isSpacePanActive: () => false,
      screenSample: point => ({ screen: point.slice(), coordinate: point.slice() }),
      clearHover: () => {},
      clearInsertTarget: () => {},
      beginStroke: input => { active = true; samples.push(input.sample); return true; },
      appendSamples: next => { samples.push(...next); return next.length > 0; },
      isStrokeActive: () => active,
      acceptingSamples: () => true,
      queueRender: () => {},
      projectCoordinate: value => value,
      firstStrokeCoordinate: () => samples[0]?.coordinate,
      finalizeStroke: () => { active = false; return { coords: samples.map(sample => sample.coordinate) }; },
      cancelQueuedRender: () => {},
      setStrokeActiveClass: () => {},
      minimumPoints: () => 2,
      render: () => {},
      updateControls: () => {},
      updateHistoryControls: () => {},
      onFinished: () => {},
    },
    renderPackets: {
      draft: {
        isActive: () => true,
        getCoords: () => [],
        setCoords: () => {},
        getEdit: () => ({ selectedVertexIndex: null }),
        setInputPhase: () => {},
        setSelectedVertex: () => {},
        recordSnapshot: () => {},
        syncAfterMutation: () => {},
        coordNear: () => false,
      },
    },
    onEditingStateChanged: snapshot => events.push(snapshot.reason),
  });
  assert.equal(editing.beginDraftStroke([1, 2], { pointerId: 1 }), true);
  assert.equal(editing.appendDraftStroke([[2, 3]]), true);
  assert.equal(editing.finishDraftStroke([3, 4]), true);
  assert.deepEqual(events, ['draft-stroke-begin', 'draft-stroke-update', 'draft-stroke-update', 'draft-stroke-finish']);
});

test('app bootstrap wires every domain factory', () => {
  const source = fs.readFileSync(path.join(root, 'assets/js/app.js'), 'utf8');
  for (const factory of ['createProjectDomain', 'createSelectionDomain', 'createRenderingDomain', 'createGisDomain', 'createEditingDomain']) {
    assert.match(source, new RegExp(`${factory}\\(`));
  }
  assert.match(source, /window\.PANDOLAB_DOMAINS\s*=\s*Object\.freeze/);
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
  assert.match(source, /renderingDomain\?\.renderDraft\?\./);
  assert.match(source, /renderingDomain\?\.renderGpuInteraction\?\./);
  assert.match(source, /renderingDomain\?\.renderValidation\?\./);
});

test('selection domain coalesces no-op changes and exposes an independent style revision', () => {
  let renderRequests = 0;
  let state = { primaryKey: null, keys: [], items: [] };
  const selection = createSelectionDomain({
    selectionController: {
      snapshot: () => state,
      replace: () => {},
      toggle: () => {},
      clear: () => {},
    },
    requestRender: () => { renderRequests += 1; },
  });
  const initial = selection.snapshot();
  assert.equal(selection.clear().revision, initial.revision);
  assert.equal(renderRequests, 0);
  state = { primaryKey: 'country:DEU', keys: ['country:DEU'], items: [{ key: 'country:DEU' }] };
  assert.equal(selection.select({ key: 'country:DEU' }).revision, initial.revision + 1);
  assert.equal(renderRequests, 1);
  const beforeStyle = selection.snapshot();
  assert.equal(selection.updateStyle().styleRevision, beforeStyle.styleRevision + 1);
  assert.equal(selection.snapshot().revision, beforeStyle.revision + 1);
  assert.equal(renderRequests, 2);
});

test('rendering domain owns domain-specific invalidation masks', () => {
  const masks = [];
  const rendering = createRenderingDomain({ coordinator: { invalidate: (mask) => { masks.push(mask); return true; } } });
  rendering.invalidateSelection('selection');
  rendering.invalidateView('view');
  rendering.invalidateCountryPatch('country');
  assert.equal(masks.length, 3);
  assert.equal((masks[0] & (1 << 17)) === 0, true);
  assert.equal((masks[1] & (1 << 0)) !== 0, true);
  assert.equal((masks[2] & (1 << 17)) !== 0, true);
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

test('selection object routing is owned by the selection domain', () => {
  const calls = [];
  const selection = createSelectionDomain({
    normalizeRef: value => value,
    refExists: value => value?.id === 'DEU',
    countryType: 'country',
    selectHandlers: { country: (id, refreshOnly) => calls.push([id, refreshOnly]) },
    withSelectionGuard: callback => callback(),
  });
  assert.equal(selection.selectObjectRef({ domain: 'territorial', type: 'country', id: 'DEU' }, { refreshOnly: true }), true);
  assert.deepEqual(calls, [['DEU', true]]);
  assert.equal(selection.selectObjectRef({ domain: 'territorial', type: 'country', id: 'FRA' }), false);
});

test('rendering domain dispatches all visual passes through one owner', () => {
  const calls = [];
  const rendering = createRenderingDomain({ renderers: { base: value => { calls.push(value); return 'ok'; } } });
  assert.equal(rendering.renderPass('base', 'frame'), 'ok');
  assert.deepEqual(calls, ['frame']);
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
