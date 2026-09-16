import assert from 'node:assert/strict';
import test from 'node:test';

import { createTerritorySelectionWorkflow } from '../../assets/js/modules/app-territory-selection-workflow.js';
import { OBJECT_EDITING_OWNER_PORTS } from '../../assets/js/modules/app-capability-ports.js';
import { capabilityPortsForFixture } from './helpers/capability-port-fixture.mjs';

const geometry = id => ({ type: 'MultiPolygon', coordinates: [[[[id, 0], [id + 1, 0], [id + 1, 1], [id, 0]]]] });

async function settle(t) {
  t.mock.timers.tick(0);
  for (let i = 0; i < 20; i++) await Promise.resolve();
  t.mock.timers.tick(300);
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

function harness(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const priorWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  globalThis.window = {
    polygonClipping: {
      union: (...coordinates) => coordinates,
      difference: coordinates => coordinates,
    },
  };
  t.after(() => {
    if (priorWindow) Object.defineProperty(globalThis, 'window', priorWindow);
    else delete globalThis.window;
  });

  const countries = new Map(['A', 'B', 'C'].map((id, index) => [id, { id, geometry: geometry(index * 3) }]));
  const state = { territorySelectionSession: null, geometryPreview: { session: null } };
  const calls = { prepare: [], preview: [], apply: 0, refresh: [], errors: [], worker: [], stopped: 0 };
  const union = values => {
    const pieces = values.filter(Boolean);
    return pieces.length ? { type: 'MultiPolygon', coordinates: pieces.flatMap(value => value.coordinates) } : null;
  };
  const worker = {
    stop() { calls.stopped += 1; },
    async execute(operation, { payload }) {
      calls.worker.push(operation);
      if (operation === 'territory-components') return { result: {
        items: [], componentFeatures: payload.features, baseSourceGeometry: payload.baseGeometry,
        workingSourceGeometry: payload.baseGeometry, archivedGeometry: union(payload.parts),
      } };
      const currentGeometry = payload.components ? union(payload.selected) : payload.currentGeometry;
      return { result: { currentGeometry, combinedGeometry: union([payload.archivedGeometry, currentGeometry]), remainingGeometry: payload.workingSourceGeometry } };
    },
  };
  let draft = [];
  let uid = 0;
  let releaseApply;
  let holdApply = false;
  const componentItems = () => {
    const selected = new Set(state.territorySelectionSession?.selectedComponentKeys || []);
    return ['first', 'second'].map((key, index) => ({
      key, countryId: 'B', polygonIndex: index, sourcePolygonIndex: index, componentKey: `B:${index}`,
      geometry: geometry(30 + index * 3), selected: selected.has(key), usesRiverBoundary: false,
    }));
  };
  const workflow = createTerritorySelectionWorkflow();
  const validate = current => !!current.name.trim();
  const prepare = current => {
    calls.prepare.push([current.kind, current.activeMethod]);
    if (!current.baseSourceGeometry) {
      current.baseSourceGeometry = geometry(0);
      current.workingSourceGeometry = geometry(0);
      current.remainingGeometry = geometry(0);
      current.componentFeatures = [{ id: 'B', geometry: geometry(0) }];
      current.sourceRevision += 1;
    }
    return true;
  };
  const preview = async (current, key) => {
    calls.preview.push([current.kind, key, current.combinedGeometry]);
    state.geometryPreview.session = { validation: { blocking: false } };
    return true;
  };
  workflow.connect(capabilityPortsForFixture(OBJECT_EDITING_OWNER_PORTS.territorySelectionWorkflow, {
    state,
    mapEditClient: worker,
    installComponentIndex(current, result, key) { current.componentIndex = { key, items: result.items, byKey: new Map(componentItems().map(item => [item.key, item])) }; },
    uid: prefix => `${prefix}-${++uid}`,
    projectDomain: { getGeneration: () => 7 },
    countryFeatureById: id => countries.get(String(id)),
    validateAnnexSelectionSetup: current => !!current.targetCountryId && current.sourceCountryIds.length > 0,
    validateNewCountrySelectionSetup: current => validate(current) && current.sourceCountryIds.length > 0,
    territorialCreateSetupValid: validate,
    prepareAnnexSelection: prepare,
    prepareNewCountrySelection: prepare,
    prepareTerritorialCreateSelection: prepare,
    finishAnnexSelectionDraft: () => false,
    finishNewCountrySelectionDraft: () => false,
    finishTerritorialUnitDirectDraft: () => false,
    prepareAnnexSelectionPreview: preview,
    prepareNewCountrySelectionPreview: preview,
    prepareTerritorialSelectionPreview: preview,
    geometryMultiCoordinates: value => value?.coordinates || [],
    normalizeClippedLandGeometry: coordinates => coordinates?.length ? { type: 'MultiPolygon', coordinates } : null,
    territoryComponentItems: componentItems,
    selectedTerritoryComponentGeometry: () => {
      const selected = componentItems().filter(item => item.selected);
      return selected.length ? { type: 'MultiPolygon', coordinates: selected.flatMap(item => item.geometry.coordinates) } : null;
    },
    updateTerritoryComponentSelectionFeedback() {},
    prepareRiverPartitionCandidates: async () => true,
    resetRiverPartitionState() {},
    defaultDraftInstruction: () => '그리기',
    discardActiveGeometryPreview: () => { state.geometryPreview.session = null; },
    applyActiveGeometryPreview: () => {
      calls.apply += 1;
      if (!holdApply) return true;
      return new Promise(resolve => { releaseApply = resolve; });
    },
    editingDraftCoordinates: () => draft,
    editingDomain: {
      setTool() { return true; },
      startDraft: ({ coords }) => { draft = [...coords]; },
      replaceDraftCoordinates: coords => { draft = [...coords]; },
      clearDraft: () => { draft = []; },
      draftInputActive: () => draft.length > 0,
      refreshTerritorySelection: ({ tool, reason }) => { calls.refresh.push(`packet:${tool}:${reason}`); return true; },
    },
    setModeBanner() {}, setActionStatus() {},
    reportOperationError: (error, _message, code) => calls.errors.push({ error, code }),
    renderingDomain: {
      invalidateEditingOverlays: reason => calls.refresh.push(reason),
      invalidateCountryPatch: reason => calls.refresh.push(reason),
    },
    updateModeButtons() {},
  }));
  workflow.initializeTerritorySelectionWorkflow();
  return {
    state, calls, workflow, worker,
    holdApply: () => { holdApply = true; },
    releaseApply: value => releaseApply(value),
  };
}

const starts = Object.freeze([
  ['annex', { targetCountryId: 'A', sourceCountryIds: ['B'] }],
  ['new-country', { name: '새 국가', sourceCountryIds: ['B'] }],
  ['subunit', { name: '새 하위단위', sovereignId: 'A', parentId: 'A', sourceKey: 'unassigned' }],
  ['region', { name: '새 지방' }],
]);

test('all four operations use setup, selection, review and preserve a selection through back navigation', async t => {
  const h = harness(t);
  for (const [kind, options] of starts) {
    const current = h.workflow.start(kind, options);
    assert.equal(await h.workflow.advance(), true);
    assert.equal(current.stage, 'selection');
    assert.equal(await h.workflow.selectMethod('polygon'), true);
    assert.equal(current.activeMethod, 'polygon');
    assert.equal(current.activePhase, 'drawing');
    h.workflow.setCurrentCandidates([{ geometry: geometry(10) }]);
    await settle(t);
    assert.equal(await h.workflow.advance(), true);
    assert.equal(current.stage, 'review');
    assert.equal(h.workflow.presentation().showReviewSummary, kind !== 'annex');
    assert.equal(h.workflow.presentation().reviewName, current.name.trim());
    assert.equal(h.workflow.back(), true);
    assert.equal(current.stage, 'selection');
    assert.equal(current.activePhase, 'candidate');
    assert.equal(h.workflow.back(), true);
    assert.equal(current.stage, 'setup');
    assert.equal(await h.workflow.advance(), true);
    assert.equal(current.activePhase, 'candidate');
    assert.equal(Object.hasOwn(current, 'requestedMethod'), true);
    h.workflow.clear();
  }
});

test('a mixed line, line, polygon session keeps archived units and previews their union once', async t => {
  const h = harness(t);
  const current = h.workflow.start('annex', starts[0][1]);
  await h.workflow.advance();
  await h.workflow.selectMethod('line');
  h.workflow.setCurrentCandidates([{ geometry: geometry(10) }]);
  await settle(t);
  assert.equal(h.workflow.addPart(), true);
  assert.equal(current.activePhase, null);
  assert.equal(current.parts.length, 1);

  assert.equal(await h.workflow.selectMethod('line'), true);
  h.workflow.setCurrentCandidates([{ geometry: geometry(20) }]);
  await settle(t);
  assert.equal(h.workflow.addPart(), true);
  assert.equal(current.parts.length, 2);

  assert.equal(await h.workflow.selectMethod('polygon'), true);
  h.workflow.setCurrentCandidates([{ geometry: geometry(30) }]);
  await settle(t);
  assert.equal(h.workflow.partCount(), 3);
  assert.equal(h.workflow.presentation().primaryLabel, '다음');
  assert.equal(await h.workflow.advance(), true);
  assert.equal(h.workflow.presentation().primaryLabel, '편입 (3)');
  assert.equal(h.calls.preview.at(-1)[2].coordinates.length, 3);
});

test('component units archive and undo one item at a time', async t => {
  const h = harness(t);
  const current = h.workflow.start('new-country', starts[1][1]);
  await h.workflow.advance();
  await h.workflow.selectMethod('components');
  h.workflow.toggleComponent('first');
  h.workflow.toggleComponent('second');
  await settle(t);
  assert.equal(h.workflow.partCount(), 2);
  assert.equal(h.workflow.addPart(), true);
  assert.equal(current.parts.length, 2);
  assert.equal(current.activePhase, null);
  assert.equal(h.workflow.undoPart(), true);
  assert.equal(current.parts.length, 1);
  assert.equal(h.workflow.partCount(), 1);
});

test('method changes preserve archived items and ask before discarding the current item', async t => {
  const h = harness(t);
  const current = h.workflow.start('annex', starts[0][1]);
  await h.workflow.advance();
  await h.workflow.selectMethod('polygon');
  h.workflow.setCurrentCandidates([{ geometry: geometry(10) }]);
  await settle(t);
  h.workflow.addPart();
  await h.workflow.selectMethod('polygon');
  h.workflow.setCurrentCandidates([{ geometry: geometry(20) }]);
  assert.equal(await h.workflow.selectMethod('line'), false);
  assert.equal(h.workflow.presentation().showMethodChangeConfirmation, true);
  assert.equal(current.parts.length, 1);
  assert.ok(current.currentGeometry);
  h.workflow.cancelMethodChange();
  assert.equal(current.activeMethod, 'polygon');
  assert.ok(current.currentGeometry);
  assert.equal(await h.workflow.selectMethod('line'), false);
  assert.equal(await h.workflow.confirmMethodChange(), true);
  assert.equal(current.activeMethod, 'line');
  assert.equal(current.currentGeometry, null);
  assert.equal(current.parts.length, 1);
});

test('region can add a reference country only when a later line or component method needs it', async t => {
  const h = harness(t);
  const current = h.workflow.start('region', starts[3][1]);
  await h.workflow.advance();
  await h.workflow.selectMethod('polygon');
  h.workflow.setCurrentCandidates([{ geometry: geometry(10) }]);
  await settle(t);
  h.workflow.addPart();
  assert.equal(await h.workflow.selectMethod('components'), false);
  assert.equal(current.activePhase, 'source');
  assert.equal(h.workflow.countryPickingActive(), true);
  h.workflow.toggleSourceCountry('B');
  assert.equal(await h.workflow.startReferenceMethod(), true);
  assert.equal(current.activePhase, 'components');
  assert.equal(current.parts.length, 1);
});

test('the common scheduler only keeps the latest aggregate preview and applies once', async t => {
  const h = harness(t);
  h.workflow.start('new-country', starts[1][1]);
  await h.workflow.advance();
  await h.workflow.selectMethod('polygon');
  h.workflow.setCurrentCandidates([{ geometry: geometry(10) }]);
  h.workflow.setCurrentCandidates([{ geometry: geometry(20) }]);
  await settle(t);
  assert.equal(h.calls.preview.length, 1);
  assert.deepEqual(h.calls.preview[0][2].coordinates, geometry(20).coordinates);
  h.holdApply();
  assert.equal(await h.workflow.apply(), false);
  assert.equal(await h.workflow.advance(), true);
  const applying = h.workflow.apply();
  assert.equal(await h.workflow.apply(), false);
  assert.equal(h.calls.apply, 1);
  h.releaseApply(true);
  assert.equal(await applying, true);
  assert.equal(h.state.territorySelectionSession, null);
});


test('late selection result cannot restore cleared geometry and cancel stops the worker', async t => {
  const h = harness(t);
  const current = h.workflow.start('subunit', starts[2][1]);
  await h.workflow.advance();
  await h.workflow.selectMethod('components');
  const normalExecute = h.worker.execute;
  let release;
  h.worker.execute = (operation, request) => operation === 'territory-selection'
    ? new Promise(resolve => { release = resolve; }) : normalExecute(operation, request);
  h.workflow.toggleComponent('first');
  t.mock.timers.tick(0);
  for (let i = 0; i < 20; i++) await Promise.resolve();
  assert.equal(current.computationPending, true);
  assert.equal(h.workflow.presentation().primaryDisabled, true);
  h.workflow.clear();
  assert.equal(h.calls.stopped, 1);
  release({ result: { currentGeometry: geometry(30), combinedGeometry: geometry(30), remainingGeometry: geometry(0) } });
  await settle(t);
  assert.equal(h.state.territorySelectionSession, null);
  assert.equal(h.calls.preview.length, 0);
});

test('selection coalesces clicks without rebuilding source and supports worker error retry', async t => {
  const h = harness(t);
  const current = h.workflow.start('new-country', starts[1][1]);
  await h.workflow.advance();
  await h.workflow.selectMethod('components');
  const normalExecute = h.worker.execute;
  let failed = false;
  h.worker.execute = async (operation, request) => {
    if (operation === 'territory-selection' && !failed) { failed = true; throw new Error('worker timeout'); }
    return normalExecute(operation, request);
  };
  h.workflow.toggleComponent('first');
  h.workflow.toggleComponent('second');
  await settle(t);
  assert.equal(current.computationError, true);
  assert.deepEqual(current.selectedComponentKeys, ['first', 'second']);
  assert.equal(current.combinedGeometry, null);
  await h.workflow.selectMethod('components');
  await settle(t);
  assert.equal(current.computationError, false);
  assert.equal(h.calls.worker.filter(name => name === 'territory-components').length, 1);
  assert.equal(h.calls.worker.filter(name => name === 'territory-selection').length, 1);
  assert.equal(h.workflow.previewReady(), true);
});
