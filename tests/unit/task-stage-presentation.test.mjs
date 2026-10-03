import assert from 'node:assert/strict';
import test from 'node:test';
/* global Event, EventTarget */
import { createTaskPresentation } from '../../assets/js/modules/app-task-presentation.js';
import { createTerritorialEntityStore } from '../../assets/js/modules/territorial-entity-store.js';
import { createToolBindings } from '../../assets/js/modules/app-tool-bindings.js';
import { MAP_INTERACTION_OWNER_PORTS, PROJECT_IO_OWNER_PORTS } from '../../assets/js/modules/app-capability-ports.js';
import { capabilityPortsForFixture } from './helpers/capability-port-fixture.mjs';


class FakeClassList {
  #values = new Set();
  add(...values) { for (const value of values) this.#values.add(value); }
  remove(...values) { for (const value of values) this.#values.delete(value); }
  contains(value) { return this.#values.has(value); }
  toggle(value, force) {
    const enabled = force === undefined ? !this.#values.has(value) : !!force;
    if (enabled) this.#values.add(value);
    else this.#values.delete(value);
    return enabled;
  }
}

class FakeElement extends EventTarget {
  constructor(ownerDocument = null) {
    super();
    this.ownerDocument = ownerDocument;
    this.classList = new FakeClassList();
    this.dataset = {};
    this.children = [];
    this.attributes = new Map();
    this.hidden = false;
    this.disabled = false;
    this.textContent = '';
  }
  append(...children) { this.children.push(...children); }
  insertAdjacentElement(_position, child) { this.children.push(child); return child; }
  replaceChildren(...children) {
    this.children = children.flatMap(child => child?.isFragment ? child.children : [child]);
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  toggleAttribute(name, force) {
    if (force) this.attributes.set(name, '');
    else this.attributes.delete(name);
  }
  querySelector() { return null; }
}

function createFakeDocument() {
  return {
    createElement() { return new FakeElement(this); },
    createDocumentFragment() {
      const fragment = new FakeElement(this);
      fragment.isFragment = true;
      return fragment;
    },
  };
}

function fixture(t, stateOverrides = {}, portOverrides = {}) {
  const priorFrame = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame');
  globalThis.requestAnimationFrame = () => 0;
  t.after(() => {
    if (priorFrame) Object.defineProperty(globalThis, 'requestAnimationFrame', priorFrame);
    else delete globalThis.requestAnimationFrame;
  });
  const document = createFakeDocument();
  const ids = [
    'modeEditingHud', 'modeTaskName', 'modeTaskStage', 'modeTaskStatus', 'modeTaskInstruction',
    'modeTaskObjects', 'modeTaskTargetsFocusBtn', 'modeTaskDisabledReason',
    'modePrimaryBtn', 'modeDraftActions', 'modeDraftDoneBtn', 'geometryPreviewSummary',
    'territorySelectionStack', 'territorySelectionStackSummary', 'territorySelectionStackList',
  ];
  const elements = Object.fromEntries(ids.map(id => [id, new FakeElement(document)]));
  const state = {
    tool: 'territorial-border',
    selected: null,
    territorySelectionSession: null,
    geometryPreview: { session: null },
    labelPlacementMode: false,
    boundaryEditPhase: 'selecting',
    boundaryEditEntityIds: [],
    boundaryPreparation: { status: 'ready', result: null },
    countryOverrides: {},
    territorialUnits: [],
    genericFeatures: [],
    modeProcessing: false,
    multiDraft: null,
    mergeTargetCountryIds: [],
    genericFeatureMergeTargetIds: [],
    territorialUnitMergeTargetIds: [],
    ...stateOverrides,
  };
  const focusCalls = [];
  const countrySourceFeature = portOverrides.countrySourceFeature || (id => id === 'COUNTRY'
    ? { type: 'Feature', id, properties: { name: 'Country' }, geometry: { type: 'Polygon', coordinates: [] } }
    : null);
  const entityRepository = portOverrides.entityRepository || {
    get(id) {
      const key = String(id || '');
      const unit = (state.territorialUnits || []).find(item => String(item?.id || '') === key);
      if (unit) return unit;
      const country = countrySourceFeature(key);
      return country ? {
        ...country,
        properties: { ...(country.properties || {}), unitType: 'country' },
      } : null;
    },
  };
  const presentation = createTaskPresentation();
  state.countriesData = { type: 'FeatureCollection', features: [countrySourceFeature('COUNTRY')].filter(Boolean) };
  const entityStore = createTerritorialEntityStore({ getState: () => state });
  presentation.connect(capabilityPortsForFixture(MAP_INTERACTION_OWNER_PORTS.taskPresentation, {
    state,
    $: id => elements[id] || null,
    describeTool: () => ({ name: '국경 조정', stage: '맞닿은 국가 선택' }),
    territorySelectionPresentation: () => null,
    editingDraftSnapshot: () => ({ coords: [], issues: [], strokeActive: false, dragging: false, inputPhase: 'draw', selectedVertexIndex: null, cutAssessment: null }),
    hydroToolConfig: () => null,
    draftMinimumPoints: () => 3,
    isGenericFeatureDraftTool: () => false,
    isSpecialTool: () => true,
    TERRITORIAL_UNIT_TYPES: { COUNTRY: 'country', SUBUNIT: 'subunit', REGION: 'region' },
    boundaryEditSelectionAnalysis: () => ({ valid: false, message: '접경 대상을 선택하세요.' }),
    countrySourceFeature,
    entityRepository,
    entityStore,
    territorialEntityName: feature => feature.properties.name,
    effectiveTerritorialFlagUrl: () => '',
    objectDisplayInfo: ref => ({ name: ref.id === 'SUB' ? 'Subunit' : 'Country', type: ref.type }),
    focusObjectRef: ref => focusCalls.push(['single', ref]),
    mapFeatureForObjectRef: ref => ({ type: 'Feature', id: ref.id, properties: {}, geometry: { type: 'Polygon', coordinates: [] } }),
    fitMapToFeature: (feature, options) => focusCalls.push(['multi', feature, options]),
    isMobile: () => false,
    setMapModeContextActive() {},
    editorWorkspacePresentation: { sync() {} },
    syncSelectionToolbarInteraction() {},
    projectUi: { syncHistory() {} },
    syncStatusBar() {},
    formatArea: area => `${area} km²`,
    ...portOverrides,
  }));
  return { presentation, elements, state, focusCalls };
}

test('operation errors use the common feedback slot and clear on a new normal banner', t => {
  const f = fixture(t, { tool: 'merge-territorial-unit', territorialUnitMergeSourceId: 'SUB', territorialUnitMergeTargetIds: ['OTHER'] });
  f.presentation.setModeBanner('선택한 하위단위들이 서로 연결되어야 합니다.', { feedback: true });
  f.presentation.updateModeButtons();
  assert.equal(f.elements.modeTaskDisabledReason.textContent, '선택한 하위단위들이 서로 연결되어야 합니다.');
  assert.equal(f.elements.modeTaskDisabledReason.classList.contains('hidden'), false);
  assert.equal(f.elements.modeTaskInstruction.classList.contains('hidden'), true);
  f.presentation.setModeBanner('합칠 인접 영역을 선택하세요.');
  f.presentation.updateModeButtons();
  assert.equal(f.elements.modeTaskDisabledReason.classList.contains('hidden'), true);
});

test('existing redraw preview keeps its real metrics and survives closing and reopening', t => {
  const preview = { validation: { blocking: false }, metrics: { finalAreaKm2: 123 } };
  const f = fixture(t, { tool: 'redraw-territorial-unit', geometryPreview: { session: preview } });
  f.presentation.updateModeButtons();
  const summary = f.elements.geometryPreviewSummary;
  assert.equal(summary.classList.contains('hidden'), false);
  assert.equal(summary.children[0].children[1].textContent, '123 km²');
  f.state.geometryPreview.session = null;
  f.presentation.updateModeButtons();
  assert.equal(summary.children.length, 0);
  f.state.geometryPreview.session = preview;
  f.presentation.updateModeButtons();
  assert.equal(summary.children[0].children[1].textContent, '123 km²');
});

test('territory list uses the authoritative union, pending state and stable part IDs', t => {
  const current = { kind: 'annex', taskLabel: '영토 편입', tool: 'annex-territory', stage: 'selection', activePhase: 'drawing', activeMethod: 'polygon',
    sourceCountryIds: [], parts: [{ id: 'first', geometry: { area: 10 } }, { id: 'middle', geometry: { area: 10 } }], archivedGeometry: { area: 15 } };
  const model = { current, step: 2, stageLabel: '영토 선택', selection: true, showMethods: true, primaryDisabled: false };
  const f = fixture(t, { tool: current.tool, territorySelectionSession: current }, {
    territorySelectionPresentation: () => model, sphericalGeometryAreaKm2: geometry => geometry?.area || 0,
  });
  f.presentation.updateModeButtons();
  const summary = f.elements.territorySelectionStackSummary;
  const list = f.elements.territorySelectionStackList;
  assert.equal(summary.textContent, '선택 영토 2개 · 15 km²', 'overlap must not be counted twice');
  assert.equal(list.children[1].children[2].dataset.itemId, 'middle');
  current.computationPending = true;
  f.presentation.updateModeButtons();
  assert.equal(summary.textContent, '선택 영토 2개 · 계산 중…');
  assert.equal(list.children[1].children[2].disabled, true);
  current.computationPending = false;
  current.parts.splice(0, 1);
  current.archivedGeometry = { area: 10 };
  f.presentation.updateModeButtons();
  assert.equal(summary.textContent, '선택 영토 1개 · 10 km²');
  assert.equal(list.children[0].children[0].textContent, '①');
  assert.equal(list.children[0].children[2].dataset.itemId, 'middle');
});

test('task sync derives role cards without duplicate type labels or focusing the map', t => {
  const f = fixture(t, {
    boundaryEditEntityIds: ['SUB', 'COUNTRY', 'SUB'],
    territorialUnits: [{ type: 'Feature', id: 'SUB', properties: { name: 'Subunit', unitType: 'subunit' }, geometry: { type: 'Polygon', coordinates: [] } }],
  });
  f.presentation.updateModeButtons();
  const cards = f.elements.modeTaskObjects.children.filter(item => item.className === 'workflow-object-card');
  assert.deepEqual(cards.map(item => item.children[0].textContent), ['기준 하위단위', '상대 하위단위']);
  assert.deepEqual(cards.map(item => item.children[1].children[0].textContent), ['Subunit', 'Country']);
  assert.equal(f.elements.modeTaskObjects.classList.contains('hidden'), false);
  assert.equal(f.elements.modeTaskTargetsFocusBtn.attributes.get('aria-label'), '선택한 2개 대상으로 이동');
  assert.deepEqual(f.focusCalls, []);
});

test('task target labels refresh from the repository while object refs stay stable', t => {
  let name = 'Before';
  const f = fixture(t, { boundaryEditEntityIds: ['COUNTRY'] }, {
    objectDisplayInfo: ref => ({ name, type: ref.type }),
  });
  f.presentation.updateModeButtons();
  assert.equal(f.elements.modeTaskObjects.children[0].children[1].children[0].textContent, 'Before');
  assert.equal(f.elements.modeTaskTargetsFocusBtn.attributes.get('aria-label'), '대상으로 이동');

  name = 'After';
  f.presentation.updateModeButtons();

  assert.equal(f.elements.modeTaskObjects.children[0].children[1].children[0].textContent, 'After');
});

test('new territory workflows never expose source or parent countries as a focus target', t => {
  for (const kind of ['new-country', 'subunit', 'region']) {
    const current = { kind, taskLabel: '추가', tool: kind, stage: 'setup',
      sourceCountryIds: ['COUNTRY'], sovereignId: 'COUNTRY', parentId: 'COUNTRY',
      candidates: [], parts: [] };
    const model = { current, step: 1, stageLabel: '기본 정보', setup: true };
    const f = fixture(t, { tool: current.tool, territorySelectionSession: current }, {
      territorySelectionPresentation: () => model,
      sphericalGeometryAreaKm2: () => 0,
    });
    for (const stage of ['setup', 'selection', 'review']) {
      current.stage = stage;
      model.setup = stage === 'setup';
      model.selection = stage === 'selection';
      model.review = stage === 'review';
      f.presentation.updateModeButtons();
      assert.equal(f.elements.modeTaskTargetsFocusBtn.classList.contains('hidden'), true, `${kind}: ${stage}`);
      assert.equal(f.elements.modeTaskTargetsFocusBtn.disabled, true, `${kind}: ${stage}`);
      assert.deepEqual(f.focusCalls, []);
    }
  }
});

test('task status explains pending and missing-target decisions without changing retry eligibility', async t => {
  const pending = fixture(t, {
    boundaryEditEntityIds: ['COUNTRY'],
    boundaryPreparation: { status: 'pending' },
  });
  pending.presentation.updateModeButtons();
  assert.equal(pending.elements.modeTaskStatus.dataset.taskState, 'preparing');
  assert.equal(pending.elements.modeTaskStatus.textContent, '준비 중');
  assert.equal(pending.elements.modePrimaryBtn.disabled, true);
  assert.equal(pending.elements.modeTaskDisabledReason.textContent, '경계를 준비하는 중입니다.');
  assert.equal(pending.elements.modeTaskDisabledReason.classList.contains('hidden'), false);
  assert.equal(pending.elements.modePrimaryBtn.attributes.get('aria-describedby'), 'modeTaskDisabledReason');

  const failed = fixture(t, {
    boundaryEditEntityIds: ['COUNTRY'],
    boundaryPreparation: { status: 'error', message: '경계 계산에 실패했습니다.', retry() {} },
  });
  failed.presentation.updateModeButtons();
  assert.equal(failed.elements.modeTaskStatus.dataset.taskState, 'invalid');
  assert.equal(failed.elements.modeTaskStatus.textContent, '확인 필요');
  assert.equal(failed.elements.modePrimaryBtn.disabled, false);
  assert.equal(failed.elements.modePrimaryBtn.textContent, '다시 시도');
  assert.equal(failed.elements.modeTaskDisabledReason.classList.contains('hidden'), false);
  assert.equal(failed.elements.modeTaskDisabledReason.textContent, '경계 계산에 실패했습니다.');

  const needsTarget = fixture(t, {
    tool: 'merge-country',
    mergeSourceCountryId: 'COUNTRY',
    mergeTargetCountryIds: [],
    boundaryEditPhase: '',
    boundaryPreparation: null,
  }, {
    describeTool: () => ({ name: '국가 합병', stage: '합칠 국가 선택' }),
  });
  needsTarget.presentation.updateModeButtons();
  assert.equal(needsTarget.elements.modeTaskStatus.dataset.taskState, 'needs-target');
  assert.equal(needsTarget.elements.modeTaskStatus.textContent, '대상 필요');
  assert.equal(needsTarget.elements.modePrimaryBtn.disabled, true);
  assert.equal(needsTarget.elements.modeTaskDisabledReason.textContent, '합칠 대상을 하나 이상 선택하세요.');
  assert.equal(needsTarget.elements.modeTaskDisabledReason.classList.contains('hidden'), true);
  assert.equal(needsTarget.elements.modeTaskStatus.classList.contains('hidden'), true);
  assert.equal(needsTarget.elements.modePrimaryBtn.attributes.get('aria-describedby'), 'modeTaskDisabledReason');
});

test('a disabled draft completion shows its authoritative validation reason in the shared task area', t => {
  const issue = { severity: 'error', message: '경로가 자기 자신과 교차합니다.' };
  const f = fixture(t, {
    tool: 'river',
    boundaryEditPhase: '',
    boundaryPreparation: null,
  }, {
    describeTool: () => ({ name: '강 추가', stage: '경로 그리기' }),
    editingDraftSnapshot: () => ({
      coords: [[0, 0], [1, 1]], issues: [issue], strokeActive: false, dragging: false,
      inputPhase: 'refine', selectedVertexIndex: null, cutAssessment: null,
    }),
    editingDomain: { draftInputActive: () => true },
    hydroToolConfig: () => ({ shape: 'line' }),
    isGenericFeatureDraftTool: () => true,
    draftMinimumPoints: () => 2,
  });

  f.presentation.updateModeButtons();

  assert.equal(f.elements.modePrimaryBtn.classList.contains('hidden'), true);
  assert.equal(f.elements.modeDraftDoneBtn.disabled, true);
  assert.equal(f.elements.modeTaskStatus.dataset.taskState, 'invalid');
  assert.equal(f.elements.modeTaskDisabledReason.textContent, issue.message);
  assert.equal(f.elements.modeDraftDoneBtn.attributes.get('aria-describedby'), 'modeTaskDisabledReason');
});

test('editable redraw with fewer than three vertices uses the precise redraw reason', t => {
  const f = fixture(t, {
    tool: 'redraw-territorial-unit',
    boundaryEditPhase: '',
    boundaryPreparation: null,
    territorialUnitRedrawSourceId: 'SUB',
    territorialUnits: [{ type: 'Feature', id: 'SUB', properties: { name: 'Subunit', unitType: 'subunit' }, geometry: { type: 'Polygon', coordinates: [] } }],
  }, {
    describeTool: () => ({ name: '영역 다시 지정', stage: '영역 그리기' }),
    editingDraftSnapshot: () => ({
      coords: [[0, 0], [1, 1]], issues: [], strokeActive: false, dragging: false,
      inputPhase: 'refine', selectedVertexIndex: null, cutAssessment: null,
    }),
    editingDomain: { draftInputActive: () => true },
    isGenericFeatureDraftTool: () => true,
    draftMinimumPoints: () => 3,
  });

  f.presentation.updateModeButtons();

  assert.equal(f.elements.modeDraftDoneBtn.disabled, true);
  assert.equal(f.elements.modeTaskDisabledReason.textContent, '영역을 만들 꼭짓점을 세 개 이상 지정하세요.');
});

test('explicit task focus delegates a single true object ref to the existing object focus command', t => {
  const f = fixture(t, {
    boundaryEditEntityIds: ['SUB'],
    territorialUnits: [{ type: 'Feature', id: 'SUB', properties: { name: 'Subunit', unitType: 'subunit' }, geometry: { type: 'Polygon', coordinates: [] } }],
  });

  assert.equal(typeof f.presentation.focusTaskTargets, 'function');
  assert.equal(f.presentation.focusTaskTargets(), true);
  assert.deepEqual(f.focusCalls, [['single', {
    domain: 'territorial', type: 'subunit', id: 'SUB', key: 'territorial:subunit:SUB',
  }]]);
});

test('explicit task focus fits multiple target features with the current layout max zoom', t => {
  const f = fixture(t, {
    boundaryEditEntityIds: ['SUB', 'COUNTRY'],
    territorialUnits: [{ type: 'Feature', id: 'SUB', properties: { name: 'Subunit', unitType: 'subunit' }, geometry: { type: 'Polygon', coordinates: [] } }],
  });

  assert.equal(typeof f.presentation.focusTaskTargets, 'function');
  assert.equal(f.presentation.focusTaskTargets(), true);
  assert.equal(f.focusCalls.length, 1);
  assert.equal(f.focusCalls[0][0], 'multi');
  assert.deepEqual(f.focusCalls[0][1], {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', id: 'SUB', properties: {}, geometry: { type: 'Polygon', coordinates: [] } },
      { type: 'Feature', id: 'COUNTRY', properties: {}, geometry: { type: 'Polygon', coordinates: [] } },
    ],
  });
  assert.deepEqual(f.focusCalls[0][2], { maxZoom: 10 });
});

test('the shared task focus button is explicitly bound to task target focus', () => {
  const focusButton = new FakeElement();
  const resetButton = new FakeElement();
  let calls = 0;
  const bindings = createToolBindings();
  bindings.connect(capabilityPortsForFixture(PROJECT_IO_OWNER_PORTS.toolBindings, {
    $: id => id === 'modeTaskTargetsFocusBtn' ? focusButton : id === 'resetViewBtn' ? resetButton : null,
    focusTaskTargets: () => { calls += 1; },
    resetView() {},
  }));

  bindings.bindToolUI();
  focusButton.dispatchEvent(new Event('click'));

  assert.equal(calls, 1);
});

test('hydro auxiliary commands run while idle and preserve their own busy guard', () => {
  const buttons = Object.fromEntries(['multiDrawnAddBtn', 'multiDrawnUndoBtn', 'resetViewBtn'].map(id => [id, new FakeElement()]));
  const state = { modeProcessing: false };
  const calls = [];
  const bindings = createToolBindings();
  bindings.connect(capabilityPortsForFixture(PROJECT_IO_OWNER_PORTS.toolBindings, {
    state, $: id => buttons[id] || null, resetView() {},
    addMultiDraftPart: () => { assert.equal(state.modeProcessing, false); calls.push('add'); },
    undoMultiDraftPart: () => { assert.equal(state.modeProcessing, false); calls.push('undo'); },
    runModePrimaryAction: action => { state.modeProcessing = true; action(); },
    reportOperationError: error => { throw error; },
  }));
  bindings.bindToolUI();
  buttons.multiDrawnAddBtn.dispatchEvent(new Event('click'));
  buttons.multiDrawnUndoBtn.dispatchEvent(new Event('click'));
  assert.deepEqual(calls, ['add', 'undo']);
  state.modeProcessing = true;
  buttons.multiDrawnAddBtn.dispatchEvent(new Event('click'));
  assert.equal(calls.length, 2);
});
