import assert from 'node:assert/strict';
import test from 'node:test';

import { createTerritorySelectionWorkflow } from '../../assets/js/modules/app-territory-selection-workflow.js';

const geometry = id => ({ type: 'MultiPolygon', coordinates: [[[[id, 0], [id + 1, 0], [id + 1, 1], [id, 0]]]] });

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
  const calls = { prepare: [], preview: [], apply: 0, refresh: [] };
  let draft = [];
  let uid = 0;
  let releaseApply;
  let holdApply = false;
  const workflow = createTerritorySelectionWorkflow();
  const validate = current => !!current.name.trim();
  const prepare = current => {
    calls.prepare.push([current.kind, current.method]);
    current.baseSourceGeometry = geometry(0);
    current.workingSourceGeometry = geometry(0);
    current.remainingGeometry = geometry(0);
    current.componentFeatures = [{ id: 'B', geometry: geometry(0) }];
    if (current.method !== 'components') draft = [];
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
    territoryComponentItems: () => [],
    selectedTerritoryComponentGeometry: () => null,
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
      clearDraft: () => { draft = []; },
      draftInputActive: () => draft.length > 0,
    },
    setModeBanner() {},
    setActionStatus() {},
    reportOperationError: error => { throw error; },
    renderingDomain: {
      invalidateEditingOverlays: reason => calls.refresh.push(reason),
      invalidateCountryPatch: reason => calls.refresh.push(reason),
    },
    updateModeButtons() {},
  });
  workflow.initializeTerritorySelectionWorkflow();

  return {
    state, calls, workflow,
    setDraft: coordinates => { draft = coordinates; },
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

test('all four operations use the same setup, method, selection, and back transitions', async t => {
  const h = harness(t);
  for (const [kind, options] of starts) {
    const current = h.workflow.start(kind, options);
    assert.equal(current.stage, 'setup');
    assert.equal(h.workflow.presentation().step, 1);
    assert.equal(await h.workflow.advance(), true);
    assert.equal(current.stage, 'method');
    assert.equal(h.workflow.selectMethod('polygon'), true);
    assert.equal(h.calls.prepare.length, starts.indexOf(starts.find(item => item[0] === kind)), 'method choice must not prepare geometry');
    assert.equal(await h.workflow.advance(), true);
    assert.equal(current.stage, 'selection');
    assert.equal(current.selectionPhase, 'polygon');
    assert.equal(h.workflow.presentation().stageLabel, '영역 선택');
    current.currentGeometry = geometry(10);
    current.combinedGeometry = current.currentGeometry;
    current.selectionPhase = 'side';
    assert.equal(h.workflow.back(), true);
    assert.equal(current.stage, 'method');
    assert.equal(await h.workflow.advance(), true);
    assert.equal(current.stage, 'selection');
    assert.equal(current.selectionPhase, 'side');
    assert.equal(current.currentGeometry.type, 'MultiPolygon');
    h.workflow.clear();
  }
  assert.equal(h.calls.prepare.length, 4);
});

test('changing a method discards the prior selection instead of synchronizing parallel state', async t => {
  const h = harness(t);
  const current = h.workflow.start('annex', starts[0][1]);
  await h.workflow.advance();
  h.workflow.selectMethod('polygon');
  await h.workflow.advance();
  h.workflow.setCurrentCandidates([{ geometry: geometry(10) }], 0, 'side');
  h.workflow.back();
  h.workflow.selectMethod('line');
  assert.equal(current.currentGeometry, null);
  assert.deepEqual(current.parts, []);
  assert.equal(current.method, null);
  assert.equal(current.pendingMethod, 'line');
});

test('one multi-area implementation adds, redraws, and undoes pieces', async t => {
  const h = harness(t);
  const current = h.workflow.start('region', { name: '새 지방' });
  await h.workflow.advance();
  h.workflow.selectMethod('polygon');
  await h.workflow.advance();
  h.workflow.setCurrentCandidates([{ geometry: geometry(10) }], 0, 'side');
  assert.equal(h.workflow.partCount(), 1);
  assert.equal(h.workflow.addPart(), true);
  assert.equal(current.parts.length, 1);
  h.workflow.setCurrentCandidates([{ geometry: geometry(20) }], 0, 'side');
  assert.equal(h.workflow.partCount(), 2);
  assert.equal(h.workflow.redraw(), true);
  assert.equal(h.workflow.partCount(), 1);
  assert.equal(h.workflow.undoPart(), true);
  assert.equal(h.workflow.partCount(), 0);
});

test('presentation reads prepared geometry without repeating union work', async t => {
  const h = harness(t);
  h.workflow.start('region', { name: '새 지방' });
  await h.workflow.advance();
  h.workflow.selectMethod('polygon');
  await h.workflow.advance();
  let unions = 0;
  const union = globalThis.window.polygonClipping.union;
  globalThis.window.polygonClipping.union = (...args) => {
    unions += 1;
    return union(...args);
  };
  h.workflow.setCurrentCandidates([{ geometry: geometry(10) }], 0, 'side');
  const preparedUnions = unions;
  for (let index = 0; index < 20; index += 1) h.workflow.presentation();
  assert.equal(unions, preparedUnions);
});

test('the shared scheduler keeps only the latest preview and applies once', async t => {
  const h = harness(t);
  h.workflow.start('new-country', starts[1][1]);
  await h.workflow.advance();
  h.workflow.selectMethod('polygon');
  await h.workflow.advance();
  h.workflow.setCurrentCandidates([{ geometry: geometry(10) }], 0, 'side');
  h.workflow.setCurrentCandidates([{ geometry: geometry(20) }], 0, 'side');
  t.mock.timers.tick(300);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(h.calls.preview.length, 1);
  assert.deepEqual(h.calls.preview[0][2].coordinates, geometry(20).coordinates);
  assert.equal(h.workflow.previewReady(), true);

  h.holdApply();
  const applying = h.workflow.apply();
  assert.equal(await h.workflow.apply(), false);
  assert.equal(h.calls.apply, 1);
  h.releaseApply(true);
  assert.equal(await applying, true);
  assert.equal(h.state.territorySelectionSession, null);
});

test('shared sessions do not expose removed operation-specific state fields', t => {
  const h = harness(t);
  const session = h.workflow.start('annex', starts[0][1]);
  assert.equal(Object.keys(session).some(key => /^(annex|newCountry|territorialCreate)/.test(key)), false);
});
