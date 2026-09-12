import assert from 'node:assert/strict';
import test from 'node:test';

import { createTerritorySelectionWorkflow } from '../../assets/js/modules/app-territory-selection-workflow.js';

const geometry = id => ({ type: 'MultiPolygon', coordinates: [[[[id, 0], [id + 1, 0], [id + 1, 1], [id, 0]]]] });

async function settle(t) {
  t.mock.timers.tick(300);
  await Promise.resolve();
  await Promise.resolve();
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
  const calls = { prepare: [], preview: [], apply: 0, refresh: [], errors: [] };
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
  workflow.connect({
    state,
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
  });
  workflow.initializeTerritorySelectionWorkflow();
  return {
    state, calls, workflow,
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

test('all four operations use setup, method, selection and back without duplicated phase state', async t => {
  const h = harness(t);
  for (const [kind, options] of starts) {
    const current = h.workflow.start(kind, options);
    assert.equal(await h.workflow.advance(), true);
    assert.equal(current.stage, 'method');
    h.workflow.selectMethod('polygon');
    assert.equal(await h.workflow.advance(), true);
    assert.equal(current.activeMethod, 'polygon');
    assert.equal(current.activePhase, 'drawing');
    current.currentGeometry = geometry(10);
    current.activePhase = 'candidate';
    h.workflow.refreshCombinedGeometry();
    assert.equal(h.workflow.back(), true);
    assert.equal(current.stage, 'method');
    assert.equal(await h.workflow.advance(), true);
    assert.equal(current.activePhase, 'candidate');
    assert.equal(Object.hasOwn(current, 'selectionPhase'), false);
    h.workflow.clear();
  }
});

test('a mixed line, line, polygon session keeps archived units and previews their union once', async t => {
  const h = harness(t);
  const current = h.workflow.start('annex', starts[0][1]);
  await h.workflow.advance();
  h.workflow.selectMethod('line');
  await h.workflow.advance();
  h.workflow.setCurrentCandidates([{ geometry: geometry(10) }]);
  await settle(t);
  assert.equal(h.workflow.addPart(), true);
  assert.equal(current.activePhase, 'method-choice');
  assert.equal(current.parts.length, 1);

  assert.equal(await h.workflow.startAdditionalMethod('line'), true);
  h.workflow.setCurrentCandidates([{ geometry: geometry(20) }]);
  await settle(t);
  assert.equal(h.workflow.addPart(), true);
  assert.equal(current.parts.length, 2);

  assert.equal(await h.workflow.startAdditionalMethod('polygon'), true);
  h.workflow.setCurrentCandidates([{ geometry: geometry(30) }]);
  await settle(t);
  assert.equal(h.workflow.partCount(), 3);
  assert.equal(h.workflow.presentation().primaryLabel, '편입 (3)');
  assert.equal(h.calls.preview.at(-1)[2].coordinates.length, 3);
});

test('component units archive and undo one item at a time', async t => {
  const h = harness(t);
  const current = h.workflow.start('new-country', starts[1][1]);
  await h.workflow.advance();
  h.workflow.selectMethod('components');
  await h.workflow.advance();
  h.workflow.toggleComponent('first');
  h.workflow.toggleComponent('second');
  await settle(t);
  assert.equal(h.workflow.partCount(), 2);
  assert.equal(h.workflow.addPart(), true);
  assert.equal(current.parts.length, 2);
  assert.equal(current.activePhase, 'method-choice');
  assert.equal(h.workflow.undoPart(), true);
  assert.equal(current.parts.length, 1);
  assert.equal(h.workflow.partCount(), 1);
});

test('method changes preserve archived items and ask before discarding the current item', async t => {
  const h = harness(t);
  const current = h.workflow.start('annex', starts[0][1]);
  await h.workflow.advance();
  h.workflow.selectMethod('polygon');
  await h.workflow.advance();
  h.workflow.setCurrentCandidates([{ geometry: geometry(10) }]);
  await settle(t);
  h.workflow.addPart();
  await h.workflow.startAdditionalMethod('polygon');
  h.workflow.setCurrentCandidates([{ geometry: geometry(20) }]);
  assert.equal(h.workflow.back(), true);
  h.workflow.selectMethod('line');
  assert.equal(await h.workflow.advance(), false);
  assert.equal(h.workflow.presentation().showMethodChangeConfirmation, true);
  assert.equal(current.parts.length, 1);
  assert.ok(current.currentGeometry);
  h.workflow.cancelMethodChange();
  assert.equal(await h.workflow.advance(), true);
  assert.equal(current.activeMethod, 'polygon');
  assert.ok(current.currentGeometry);
  h.workflow.back();
  h.workflow.selectMethod('line');
  await h.workflow.advance();
  assert.equal(await h.workflow.confirmMethodChange(), true);
  assert.equal(current.activeMethod, 'line');
  assert.equal(current.currentGeometry, null);
  assert.equal(current.parts.length, 1);
});

test('region can add a reference country only when a later line or component method needs it', async t => {
  const h = harness(t);
  const current = h.workflow.start('region', starts[3][1]);
  await h.workflow.advance();
  h.workflow.selectMethod('polygon');
  await h.workflow.advance();
  h.workflow.setCurrentCandidates([{ geometry: geometry(10) }]);
  await settle(t);
  h.workflow.addPart();
  assert.equal(await h.workflow.startAdditionalMethod('components'), false);
  assert.equal(current.activePhase, 'source');
  assert.equal(h.workflow.countryPickingActive(), true);
  h.workflow.toggleSourceCountry('B');
  assert.equal(await h.workflow.startAdditionalMethod(), true);
  assert.equal(current.activePhase, 'components');
  assert.equal(current.parts.length, 1);
});

test('the common scheduler only keeps the latest aggregate preview and applies once', async t => {
  const h = harness(t);
  h.workflow.start('new-country', starts[1][1]);
  await h.workflow.advance();
  h.workflow.selectMethod('polygon');
  await h.workflow.advance();
  h.workflow.setCurrentCandidates([{ geometry: geometry(10) }]);
  h.workflow.setCurrentCandidates([{ geometry: geometry(20) }]);
  await settle(t);
  assert.equal(h.calls.preview.length, 1);
  assert.deepEqual(h.calls.preview[0][2].coordinates, geometry(20).coordinates);
  h.holdApply();
  const applying = h.workflow.apply();
  assert.equal(await h.workflow.apply(), false);
  assert.equal(h.calls.apply, 1);
  h.releaseApply(true);
  assert.equal(await applying, true);
  assert.equal(h.state.territorySelectionSession, null);
});
