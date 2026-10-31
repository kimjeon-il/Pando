import { createTerritorialFeature } from "../../shared/frontend/js/modules/territorial-units.js";
import { testCoreProject, initializeTestTerritorialState } from '../helpers/timeline-project.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
/* global Event, EventTarget */
import { createTaskPresentation } from "../../apps/editor/frontend/js/modules/app-task-presentation.js";
import { shouldShowTaskInputInstruction } from "../../apps/editor/frontend/js/modules/app-task-stage-model.js";
import { createTerritorialEntityStore } from "../../shared/frontend/js/modules/territorial-entity-store.js";
import { createToolBindings } from "../../apps/editor/frontend/js/modules/app-tool-bindings.js";
import { MAP_INTERACTION_OWNER_PORTS, PROJECT_IO_OWNER_PORTS } from "../../apps/editor/frontend/js/modules/app-capability-ports.js";
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

async function fixture(t, stateOverrides = {}, portOverrides = {}) {
  const priorFrame = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame');
  globalThis.requestAnimationFrame = () => 0;
  t.after(() => {
    if (priorFrame) Object.defineProperty(globalThis, 'requestAnimationFrame', priorFrame);
    else delete globalThis.requestAnimationFrame;
  });
  const document = createFakeDocument();
  const ids = [
    'modeEditingHud', 'modeEditingContext', 'modeTaskWindowContent', 'modeTaskName', 'modeTaskStage', 'modeTaskStep',
    'modeTaskStatus', 'modeTaskInstruction', 'modeTaskInput', 'modeTaskTargetSummary', 'modeTaskEditingStage',
    'modeMapSummary', 'editorSurface', 'modeTaskObjects', 'modeTaskResults', 'modeTaskResultsList',
    'modeTaskResultsSummary', 'modeTaskDisabledReason', 'modeTaskViewTime',
    'modeTaskAffectedSummary', 'modeTaskAffectedList',
    'modePrimaryBtn', 'modeDraftActions', 'modeDraftDoneBtn', 'geometryPreviewSummary',
    'territorySelectionStack', 'territorySelectionStackSummary', 'territorySelectionStackList',
  ];
  const elements = Object.fromEntries(ids.map(id => [id, new FakeElement(document)]));
  elements.modeTaskTargetSummary.parentElement = new FakeElement(document);
  elements.modeTaskViewTime.parentElement = new FakeElement(document);
  elements.modeTaskAffectedSummary.parentElement = new FakeElement(document);
  const state = {
    tool: 'territorial-border',
    selected: null,
    territorySelectionSession: null,
    geometryPreview: { session: null },
    labelPlacementMode: false,
    boundaryEditPhase: 'selecting',
    boundaryEditEntityIds: [],
    boundaryPreparation: { status: 'ready', result: null },
    territorialEntities: [],
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
    ? { type: 'Feature', id, properties: { name: 'Country' }, geometry: { type: 'Polygon', coordinates: [[[0,0],[1,0],[1,1],[0,0]]] } }
    : null);
  const entityRepository = portOverrides.entityRepository || {
    get(id) {
      const key = String(id || '');
      const unit = (state.territorialEntities || []).find(item => String(item?.id || '') === key);
      if (unit) return unit;
      const country = countrySourceFeature(key);
      return country ? {
        ...country,
        properties: { ...(country.properties || {}), entityKind: 'general' },
      } : null;
    },
  };
  const presentation = createTaskPresentation();
  state.territorialEntities = [...state.territorialEntities, ...[countrySourceFeature('COUNTRY')].filter(Boolean).map(feature => ({ ...feature, properties: { ...feature.properties, entityKind: 'general' } }))];
  state.territorialEntities = state.territorialEntities.map(feature => createTerritorialFeature({ id: feature.id, entityKind: feature.properties.entityKind, name: feature.properties.name, parentId: feature.properties.parentId, geometry: feature.geometry.coordinates.length ? feature.geometry : countrySourceFeature('COUNTRY').geometry }));
  await initializeTestTerritorialState(state);
const entityStore = createTerritorialEntityStore({ documentModel:testCoreProject(state).documentModel,commandOwner:testCoreProject(state).client });
  presentation.connect(capabilityPortsForFixture(MAP_INTERACTION_OWNER_PORTS.taskPresentation, {
    state,
    projectDomain: testCoreProject(state).project,
    $: id => elements[id] || null,
    describeTool: () => ({ name: '국경 조정', stage: '맞닿은 국가 선택' }),
    territorySelectionPresentation: () => null,
    editingDraftSnapshot: () => ({ coords: [], issues: [], strokeActive: false, dragging: false, inputPhase: 'draw', selectedVertexIndex: null, cutAssessment: null }),
    hydroToolConfig: () => null,
    draftMinimumPoints: () => 3,
    isGenericFeatureDraftTool: () => false,
    isSpecialTool: () => true,
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
    syncTerritorialEditorInteraction() {},
    projectUi: { syncHistory() {} },
    syncStatusBar() {},
    formatArea: area => `${area} km²`,
    ...portOverrides,
    editingDomain:{snapshot:()=>({}),draftInputActive:()=>false,...portOverrides.editingDomain},
  }));
  return { presentation, elements, state, focusCalls };
}

test('operation errors use the common feedback slot and clear on a new normal banner', async t => {
  const f = await fixture(t, { tool: 'merge-territorial-unit', territorialUnitMergeSourceId: 'SUB', territorialUnitMergeTargetIds: ['OTHER'] });
  f.presentation.setModeBanner('선택한 하위단위들이 서로 연결되어야 합니다.', { feedback: true });
  f.presentation.updateModeButtons();
  assert.equal(f.elements.modeTaskDisabledReason.textContent, '선택한 하위단위들이 서로 연결되어야 합니다.');
  assert.equal(f.elements.modeTaskDisabledReason.classList.contains('hidden'), false);
  assert.equal(f.elements.modeTaskInstruction.classList.contains('hidden'), true);
  f.presentation.setModeBanner('합칠 인접 영역을 선택하세요.');
  f.presentation.updateModeButtons();
  assert.equal(f.elements.modeTaskDisabledReason.classList.contains('hidden'), false);
});

test('existing redraw preview keeps its real metrics and survives closing and reopening', async t => {
  const preview = { validation: { blocking: false }, metrics: { finalAreaKm2: 123 } };
  const f = await fixture(t, { tool: 'redraw-territorial-unit', geometryPreview: { session: preview } });
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

test('territory list uses the authoritative union, pending state and stable part IDs', async t => {
  const current = { kind: 'annex', taskLabel: '영토 편입', tool: 'annex-territory', stage: 'selection', activePhase: 'drawing', activeMethod: 'polygon',
    sourceCountryIds: [], parts: [{ id: 'first', geometry: { area: 10 } }, { id: 'middle', geometry: { area: 10 } }], archivedGeometry: { area: 15 } };
  const model = { current, step: 2, stageLabel: '영토 선택', selection: true, showMethods: true, primaryDisabled: false };
  const f = await fixture(t, { tool: current.tool, territorySelectionSession: current }, {
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

test('task sync derives role cards without duplicate type labels or focusing the map', async t => {
  const f = await fixture(t, {
    boundaryEditEntityIds: ['SUB', 'COUNTRY', 'SUB'],
    territorialEntities: [{ type: 'Feature', id: 'SUB', properties: { name: 'Subunit', entityKind: 'general', parentId: 'COUNTRY' }, geometry: { type: 'Polygon', coordinates: [] } }],
  });
  f.presentation.updateModeButtons();
  const cards = f.elements.modeTaskObjects.children.filter(item => item.className === 'workflow-object-card');
  assert.deepEqual(cards.map(item => item.children[0].textContent), ['기준 객체', '상대 객체']);
  assert.deepEqual(cards.map(item => item.children[1].children[0].textContent), ['Subunit', 'Country']);
  assert.equal(f.elements.modeTaskObjects.classList.contains('hidden'), false);
  assert.equal('focusTaskTargets' in f.presentation, false);
  assert.deepEqual(f.focusCalls, []);
});

test('task target labels refresh from the repository while object refs stay stable', async t => {
  let name = 'Before';
  const f = await fixture(t, { boundaryEditEntityIds: ['COUNTRY'] }, {
    objectDisplayInfo: ref => ({ name, type: ref.type }),
  });
  f.presentation.updateModeButtons();
  assert.equal(f.elements.modeTaskObjects.children[0].children[1].children[0].textContent, 'Before');

  name = 'After';
  f.presentation.updateModeButtons();

  assert.equal(f.elements.modeTaskObjects.children[0].children[1].children[0].textContent, 'After');
});

test('new territory workflows never expose source or parent countries as a focus target', async t => {
  for (const [entityKind, parentId] of [['general', ''], ['general', 'COUNTRY'], ['regional', '']]) {
    const kind = 'entity';
    const current = { kind, entityKind, taskLabel: '객체 추가', tool: 'draw-territorial-unit', stage: 'setup',
      sourceCountryIds: ['COUNTRY'], parentId,
      candidates: [], parts: [] };
    const model = { current, step: 1, stageLabel: '기본 정보', setup: true };
    const f = await fixture(t, { tool: current.tool, territorySelectionSession: current }, {
      territorySelectionPresentation: () => model,
      sphericalGeometryAreaKm2: () => 0,
    });
    for (const stage of ['setup', 'selection', 'review']) {
      current.stage = stage;
      model.setup = stage === 'setup';
      model.selection = stage === 'selection';
      model.review = stage === 'review';
      f.presentation.updateModeButtons();
      assert.equal('focusTaskTargets' in f.presentation, false, `${kind}: ${stage}`);
      assert.deepEqual(f.focusCalls, []);
    }
  }
});

test('task status explains pending and missing-target decisions without changing retry eligibility', async t => {
  const pending = await fixture(t, {
    boundaryEditEntityIds: ['COUNTRY'],
    boundaryPreparation: { status: 'pending' },
  });
  pending.presentation.updateModeButtons();
  assert.equal(pending.elements.modeTaskStatus.dataset.taskState, 'preparing');
  assert.equal(pending.elements.modeTaskStatus.textContent, '준비 중');
  assert.equal(pending.elements.modeTaskStatus.classList.contains('hidden'), false);
  assert.equal(pending.elements.modePrimaryBtn.disabled, true);
  assert.equal(pending.elements.modeTaskDisabledReason.textContent, '경계를 준비하는 중입니다.');
  assert.equal(pending.elements.modeTaskDisabledReason.classList.contains('hidden'), false);
  assert.equal(pending.elements.modePrimaryBtn.attributes.get('aria-describedby'), 'modeTaskDisabledReason');

  const failed = await fixture(t, {
    boundaryEditEntityIds: ['COUNTRY'],
    boundaryPreparation: { status: 'error', message: '경계 계산에 실패했습니다.', retry() {} },
  });
  failed.presentation.updateModeButtons();
  assert.equal(failed.elements.modeTaskStatus.dataset.taskState, 'invalid');
  assert.equal(failed.elements.modeTaskStatus.textContent, '확인 필요');
  assert.equal(failed.elements.modeTaskStatus.classList.contains('hidden'), false);
  assert.equal(failed.elements.modePrimaryBtn.disabled, false);
  assert.equal(failed.elements.modePrimaryBtn.textContent, '다시 시도');
  assert.equal(failed.elements.modeTaskDisabledReason.classList.contains('hidden'), false);
  assert.equal(failed.elements.modeTaskDisabledReason.textContent, '경계 계산에 실패했습니다.');

  const needsTarget = await fixture(t, {
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
  assert.equal(needsTarget.elements.modeTaskDisabledReason.classList.contains('hidden'), false);
  assert.equal(needsTarget.elements.modeTaskStatus.classList.contains('hidden'), true);
  assert.equal(needsTarget.elements.modePrimaryBtn.attributes.get('aria-describedby'), 'modeTaskDisabledReason');
});

test('a disabled draft completion shows its authoritative validation reason in the shared task area', async t => {
  const issue = { severity: 'error', message: '경로가 자기 자신과 교차합니다.' };
  const f = await fixture(t, {
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

test('editable redraw with fewer than three vertices uses the precise redraw reason', async t => {
  const f = await fixture(t, {
    tool: 'redraw-territorial-unit',
    boundaryEditPhase: '',
    boundaryPreparation: null,
    territorialUnitRedrawSourceId: 'SUB',
    territorialEntities: [{ type: 'Feature', id: 'SUB', properties: { name: 'Subunit', entityKind: 'general' }, geometry: { type: 'Polygon', coordinates: [] } }],
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

test('tool bindings do not query the removed task focus button', () => {
  const resetButton = new FakeElement();
  const bindings = createToolBindings();
  bindings.connect(capabilityPortsForFixture(PROJECT_IO_OWNER_PORTS.toolBindings, {
    $: id => {
      assert.notEqual(id, 'modeTaskTargetsFocusBtn');
      return ['resetViewBtn', 'addEntityBtn', 'territorialCreateRegionalInput'].includes(id) ? resetButton : null;
    },
    resetView() {},
  }));

  bindings.bindToolUI();
});

test('hydro auxiliary commands run while idle and preserve their own busy guard', () => {
  const buttons = Object.fromEntries(['multiDrawnAddBtn', 'multiDrawnUndoBtn', 'resetViewBtn', 'addEntityBtn', 'territorialCreateRegionalInput'].map(id => [id, new FakeElement()]));
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

test('editing context can render before the Core project state is ready', async t => {
  const f = await fixture(t, {}, {projectDomain:{state:()=>null}});
  f.presentation.syncEditingContext();
  assert.equal(f.elements.modeTaskViewTime.textContent, '보기: 시점 확인 중');
});

test('routine task guidance is suppressed without hiding active edit or recovery instructions', () => {
  const cases = [
    ['desktop selection', { state: { tool: 'merge-country' } }, false],
    ['mobile country merge', { state: { tool: 'merge-country' }, mobile: true }, false],
    ['mobile annex setup', { state: { tool: 'annex-territory', territorySelectionSession: { stage: 'setup' } }, mobile: true }, false],
    ['mobile annex drawing', { state: { tool: 'annex-territory', territorySelectionSession: { stage: 'selection', activePhase: 'drawing' } }, mobile: true }, true],
    ['mobile annex components', { state: { tool: 'annex-territory', territorySelectionSession: { stage: 'selection', activePhase: 'components' } }, mobile: true }, false],
    ['mobile annex review', { state: { tool: 'annex-territory', territorySelectionSession: { stage: 'review' } }, mobile: true }, false],
    ['mobile border selection', { state: { tool: 'territorial-border', boundaryEditPhase: 'selecting' }, mobile: true }, false],
    ['mobile border editing', { state: { tool: 'territorial-border', boundaryEditPhase: 'editing' }, mobile: true }, true],
    ['mobile coast editing', { state: { tool: 'country-coast' }, mobile: true }, true],
    ['mobile hydro drawing', { state: { tool: 'river' }, mobile: true, draftActive: true }, true],
    ['desktop routine drawing', { state: { tool: 'river' }, draftActive: true }, false],
    ['desktop insert mode', { state: { tool: 'river' }, draft: { vertexInsertMode: true } }, true],
    ['desktop map panning', { state: { tool: 'merge-country', spacePanActive: true } }, true],
    ['desktop vertex placement', { state: { tool: 'country-coast' }, editing: { vertexPlacement: true } }, true],
    ['mobile selected vertex', { state: { tool: 'river' }, mobile: true, editing: { selectedVertex: { vertexKey: 'v0' } } }, true],
    ['review preview', { state: { tool: 'country-coast', geometryPreview: { session: { status: 'ready' } } }, mobile: true }, false],
    ['applying preview', { state: { tool: 'country-coast', geometryPreview: { session: { status: 'applying' } } } }, true],
    ['applying selection', { state: { tool: 'annex-territory', territorySelectionSession: { stage: 'review', applying: true } } }, true],
  ];
  for (const [name, options, visible] of cases) {
    assert.equal(shouldShowTaskInputInstruction(options), visible, name);
  }
});

test('routine instructions retain text but are visually hidden in the normal editor', async t => {
  const f = await fixture(t, { tool: 'merge-country', mergeSourceCountryId: 'COUNTRY', boundaryEditPhase: '', boundaryPreparation: null });
  f.presentation.syncEditingContext();
  assert.ok(f.elements.modeTaskInput.textContent.length > 0);
  assert.equal(f.elements.modeTaskInput.classList.contains('hidden'), true);
  f.state.spacePanActive = true;
  f.presentation.syncEditingContext();
  assert.equal(f.elements.modeTaskInput.classList.contains('hidden'), false);
});

test('mobile coast editing retains touch instructions', async t => {
  const f = await fixture(t, { tool: 'country-coast', boundaryEditPhase: 'editing' }, { isMobile: () => true });
  f.presentation.syncEditingContext();
  assert.equal(f.elements.modeTaskInput.classList.contains('hidden'), false);
});

test('expanded role cards own the target and stage; minimized task preserves the compact context', async t => {
  const f = await fixture(t, { tool: 'merge-country', mergeSourceCountryId: 'COUNTRY', mergeTargetCountryIds: [], boundaryEditPhase: '', boundaryPreparation: null });
  f.presentation.updateModeButtons();
  const compact = f.elements.modeTaskTargetSummary.parentElement;
  assert.equal(f.elements.modeTaskObjects.classList.contains('hidden'), false);
  assert.equal(compact.classList.contains('hidden'), true);
  assert.equal(f.elements.modeTaskEditingStage.classList.contains('hidden'), true);
  assert.equal(f.elements.modeTaskStage.attributes.get('aria-live'), 'polite');
  assert.equal(f.elements.modeTaskStatus.classList.contains('hidden'), true);
  f.state.modeTaskMinimized = true;
  f.presentation.syncMapContextSurfaces();
  assert.equal(compact.classList.contains('hidden'), false);
  assert.equal(f.elements.modeTaskEditingStage.classList.contains('hidden'), false);
  assert.equal(f.elements.modeTaskEditingStage.attributes.get('aria-live'), 'polite');
  assert.equal(f.elements.modeTaskStage.attributes.get('aria-live'), 'off');
  assert.equal(f.elements.modeTaskWindowContent.hidden, true);
  f.state.modeTaskMinimized = false;
  f.presentation.syncMapContextSurfaces();
  assert.equal(compact.classList.contains('hidden'), true);
});

test('editor-open map summary is hidden and restored when the editor closes', async t => {
  const f = await fixture(t, { tool: 'merge-country', mergeSourceCountryId: 'COUNTRY', boundaryEditPhase: '', boundaryPreparation: null });
  f.elements.editorSurface.classList.add('surface-open');
  f.presentation.updateModeButtons();
  assert.equal(f.elements.modeMapSummary.classList.contains('hidden'), true);
  f.elements.editorSurface.classList.remove('surface-open');
  f.presentation.syncMapContextSurfaces();
  assert.equal(f.elements.modeMapSummary.classList.contains('hidden'), false);
});

test('target summary stays when no role cards or valid review summary can replace it', async t => {
  const f = await fixture(t, { tool: 'river', boundaryEditPhase: '', boundaryPreparation: null }, {
    describeTool: () => ({ name: '강 추가', stage: '경로 그리기' }),
    hydroToolConfig: () => ({ shape: 'line' }),
  });
  f.presentation.updateModeButtons();
  assert.equal(f.elements.modeTaskObjects.classList.contains('hidden'), true);
  assert.equal(f.elements.geometryPreviewSummary.classList.contains('hidden'), true);
  assert.equal(f.elements.modeTaskTargetSummary.parentElement.classList.contains('hidden'), false);
});

test('preview summary replaces the redundant target row without changing its result details', async t => {
  const f = await fixture(t, { tool: 'redraw-territorial-unit', boundaryEditPhase: '', boundaryPreparation: null,
    geometryPreview: { session: { validation: { blocking: false }, metrics: { finalAreaKm2: 42 } } } });
  f.presentation.updateModeButtons();
  assert.equal(f.elements.geometryPreviewSummary.classList.contains('hidden'), false);
  assert.equal(f.elements.modeTaskTargetSummary.parentElement.classList.contains('hidden'), true);
  assert.equal(f.elements.geometryPreviewSummary.children[0].children[1].textContent, '42 km²');
});

test('annex donor setup shows role cards without duplicate metadata or routine reminders', async t => {
  const current = {
    kind: 'annex', tool: 'annex-territory', taskLabel: '영토 편입', stage: 'setup',
    targetCountryId: 'COUNTRY', sourceCountryIds: [],
  };
  const model = {
    current, setup: true, step: 1, stageLabel: '가져올 국가',
    primaryDisabled: true, primaryLabel: '다음', primaryIcon: '#icon-check',
  };
  const f = await fixture(t, {
    tool: 'annex-territory', territorySelectionSession: current,
    boundaryEditPhase: '', boundaryPreparation: null,
  }, { territorySelectionPresentation: () => model });

  f.presentation.updateModeButtons();
  assert.equal(f.elements.modeTaskObjects.classList.contains('hidden'), false);
  assert.equal(f.elements.modeTaskObjects.children.length, 3, 'receiver, arrow, donor');
  assert.equal(f.elements.modeTaskViewTime.parentElement.classList.contains('hidden'), true);
  assert.equal(f.elements.modeTaskDisabledReason.textContent, '대상을 선택하고 필요한 설정을 완료하세요.');
  assert.equal(f.elements.modeTaskDisabledReason.classList.contains('hidden'), true);
  assert.equal(f.elements.modePrimaryBtn.disabled, true);
  assert.equal(f.elements.modePrimaryBtn.attributes.get('aria-describedby'), 'modeTaskDisabledReason');

  f.presentation.setModeBanner('선택 국가를 준비하지 못했습니다.', { feedback: true });
  f.presentation.updateModeButtons();
  assert.equal(f.elements.modeTaskDisabledReason.textContent, '선택 국가를 준비하지 못했습니다.');
  assert.equal(f.elements.modeTaskDisabledReason.classList.contains('hidden'), false);
  f.presentation.setModeBanner('');

  current.sourceCountryIds = ['COUNTRY-2'];
  current.stage = 'selection';
  f.presentation.syncEditingContext();
  assert.equal(f.elements.modeTaskViewTime.parentElement.classList.contains('hidden'), true);
  current.stage = 'review';
  f.presentation.syncEditingContext();
  assert.equal(f.elements.modeTaskViewTime.parentElement.classList.contains('hidden'), false);
});

test('annex selection omits empty results but keeps real parts, progress and errors', async t => {
  const current = {
    kind: 'annex', tool: 'annex-territory', taskLabel: '영토 편입',
    stage: 'selection', targetCountryId: 'COUNTRY', sourceCountryIds: [],
    activeMethod: null, requestedMethod: null, activePhase: null,
    parts: [], archivedGeometry: null, candidates: [], selectedCandidateIds: [],
  };
  const model = {
    current, step: 2, stageLabel: '영토 선택', selection: true,
    showMethods: true, primaryDisabled: true, primaryLabel: '다음', primaryIcon: '#icon-chevron-right',
  };
  const f = await fixture(t, { tool: current.tool, territorySelectionSession: current,
    boundaryEditPhase: '', boundaryPreparation: null }, {
    territorySelectionPresentation: () => model, sphericalGeometryAreaKm2: geometry => geometry?.area || 0,
  });
  f.presentation.updateModeButtons();
  const section = f.elements.territorySelectionStack;
  assert.equal(section.classList.contains('hidden'), true);
  assert.equal(f.elements.territorySelectionStackSummary.textContent, '선택 영토 0개 · 0 km²');
  assert.equal(f.elements.modeTaskViewTime.parentElement.classList.contains('hidden'), true);
  assert.equal(f.elements.modeTaskDisabledReason.classList.contains('hidden'), true);
  assert.equal(f.elements.modePrimaryBtn.disabled, true);
  assert.equal(f.elements.modePrimaryBtn.attributes.get('aria-describedby'), 'modeTaskDisabledReason');

  current.activeMethod = 'polygon';
  current.activePhase = 'drawing';
  f.presentation.updateModeButtons();
  assert.equal(section.classList.contains('hidden'), true);

  current.parts.push({ id: 'first', geometry: { area: 12 } });
  current.archivedGeometry = { area: 12 };
  f.presentation.updateModeButtons();
  assert.equal(section.classList.contains('hidden'), false);
  assert.equal(f.elements.territorySelectionStackList.children.length, 1);
  assert.equal(f.elements.territorySelectionStackSummary.textContent, '선택 영토 1개 · 12 km²');

  current.parts = [];
  current.archivedGeometry = null;
  current.computationPending = true;
  f.presentation.updateModeButtons();
  assert.equal(section.classList.contains('hidden'), false);
  assert.equal(f.elements.territorySelectionStackSummary.textContent, '선택 영토 0개 · 계산 중…');

  current.computationPending = false;
  current.computationError = true;
  f.presentation.updateModeButtons();
  assert.equal(section.classList.contains('hidden'), false);
  assert.equal(f.elements.territorySelectionStackSummary.textContent, '선택 영토 0개 · 계산 실패');

  current.computationError = false;
  f.presentation.updateModeButtons();
  assert.equal(section.classList.contains('hidden'), true);
  current.stage = 'review';
  f.presentation.syncEditingContext();
  assert.equal(f.elements.modeTaskViewTime.parentElement.classList.contains('hidden'), false);
});

test('annex review removes only duplicate affected countries and retains safety details', async t => {
  const country = id => ({ type: 'Feature', id, properties: { name: id, entityKind: 'general' },
    geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } });
  const selection = {
    kind: 'annex', tool: 'annex-territory', stage: 'review',
    targetCountryId: 'COUNTRY', sourceCountryIds: ['DONOR'],
  };
  const preview = { validation: { blocking: false }, affectedIds: ['COUNTRY', 'DONOR'],
    temporalImpact: [{ from: '1950-01', until: '1951-01' }], metrics: { transferredAreaKm2: 12 } };
  const f = await fixture(t, { tool: 'annex-territory', territorySelectionSession: selection,
    geometryPreview: { session: preview }, boundaryEditPhase: '', boundaryPreparation: null }, {
    countrySourceFeature: id => ['COUNTRY', 'DONOR'].includes(id) ? country(id) : null,
  });
  const summary = f.elements.modeTaskAffectedSummary;
  const list = f.elements.modeTaskAffectedList;

  f.presentation.syncEditingContext();
  assert.equal(summary.textContent, '영향 대상 2개');
  assert.equal(list.textContent, 'COUNTRY, DONOR');
  assert.equal(summary.parentElement.hidden, true, 'direct receiver and donors repeat the review summary');

  preview.affectedIds = ['COUNTRY', 'DONOR', 'DEPENDENCY'];
  f.presentation.syncEditingContext();
  assert.equal(summary.textContent, '영향 대상 3개');
  assert.equal(list.textContent, 'COUNTRY, DONOR, DEPENDENCY');
  assert.equal(summary.parentElement.hidden, false, 'additional affected entity must remain visible');

  preview.affectedIds = ['COUNTRY', 'DONOR'];
  preview.validation.blocking = true;
  f.presentation.syncEditingContext();
  assert.equal(summary.parentElement.hidden, false, 'validation failures retain the full affected list');

  preview.validation.blocking = false;
  selection.stage = 'selection';
  f.presentation.syncEditingContext();
  assert.equal(summary.parentElement.hidden, false, 'leaving review restores the default list');

  selection.stage = 'review';
  preview.affectedIds = [];
  f.presentation.syncEditingContext();
  assert.equal(summary.parentElement.hidden, false, 'unknown impact cannot be treated as duplicate');

  preview.affectedIds = ['COUNTRY', 'DONOR'];
  selection.sourceCountryIds = ['MISSING-DONOR'];
  f.presentation.syncEditingContext();
  assert.equal(summary.parentElement.hidden, false, 'unresolved donor names must not suppress impact');
});

test('country merge selection keeps the keeper card, hides empty results, and restores preview metadata', async t => {
  const countrySourceFeature = id => ['COUNTRY', 'OTHER'].includes(id)
    ? { type: 'Feature', id, properties: { name: id, entityKind: 'general' },
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } }
    : null;
  const f = await fixture(t, { tool: 'merge-country', mergeSourceCountryId: 'COUNTRY',
    mergeTargetCountryIds: [], boundaryEditPhase: '', boundaryPreparation: null }, {
    countrySourceFeature,
    objectDisplayInfo: ref => ({ name: ref.id === 'OTHER' ? 'Other' : 'Country', type: ref.type }),
  });
  f.presentation.updateModeButtons();
  assert.equal(f.elements.modeTaskObjects.classList.contains('hidden'), false);
  assert.equal(f.elements.modeTaskResults.classList.contains('hidden'), true);
  assert.equal(f.elements.modeTaskResultsSummary.textContent, '합칠 객체 0개');
  assert.equal(f.elements.modeTaskViewTime.parentElement.classList.contains('hidden'), true);
  assert.equal(f.elements.modeTaskDisabledReason.textContent, '합칠 대상을 하나 이상 선택하세요.');
  assert.equal(f.elements.modeTaskDisabledReason.classList.contains('hidden'), false);
  assert.equal(f.elements.modePrimaryBtn.disabled, true);
  assert.equal(f.elements.modePrimaryBtn.textContent, '합병 미리보기');

  f.state.mergeTargetCountryIds.push('OTHER');
  f.presentation.updateModeButtons();
  assert.equal(f.elements.modeTaskResults.classList.contains('hidden'), false);
  assert.equal(f.elements.modeTaskResultsSummary.textContent, '합칠 객체 1개');
  assert.equal(f.elements.modeTaskResultsList.children.length, 1);
  assert.equal(f.elements.modeTaskResultsList.children[0].children[2].dataset.objectId, 'OTHER');
  assert.equal(f.elements.modeTaskResultsList.children[0].children[2].attributes.get('aria-label'), 'Other 합병 대상에서 제외');
  assert.equal(f.elements.modePrimaryBtn.disabled, false);
  assert.equal(f.elements.modePrimaryBtn.textContent, '합병 미리보기');

  f.state.mergeTargetCountryIds.pop();
  f.presentation.updateModeButtons();
  assert.equal(f.elements.modeTaskResults.classList.contains('hidden'), true);
  assert.equal(f.elements.modeTaskResultsList.children.length, 0);
  assert.equal(f.elements.modePrimaryBtn.disabled, true);

  f.state.geometryPreview.session = { validation: { blocking: false }, metrics: { finalAreaKm2: 42 } };
  f.presentation.syncEditingContext();
  assert.equal(f.elements.modeTaskViewTime.parentElement.classList.contains('hidden'), false);
});

test('territorial unit merge uses the same compact empty/selected target behavior', async t => {
  const geometry = { type: 'Polygon', coordinates: [[[0, 0], [0, 1], [1, 0], [0, 0]]] };
  const unit = id => ({ type: 'Feature', id, properties: {
    name: id, entityKind: 'general', parentId: 'COUNTRY',
  }, geometry });
  const f = await fixture(t, {
    tool: 'merge-territorial-unit', territorialUnitMergeSourceId: 'SUB',
    territorialUnitMergeTargetIds: [], territorialEntities: [unit('SUB'), unit('OTHER')],
    boundaryEditPhase: '', boundaryPreparation: null,
  }, { objectDisplayInfo: ref => ({ name: ref.id, type: ref.type }) });
  f.presentation.updateModeButtons();
  assert.equal(f.elements.modeTaskResults.classList.contains('hidden'), true);
  assert.equal(f.elements.modeTaskViewTime.parentElement.classList.contains('hidden'), true);
  f.state.territorialUnitMergeTargetIds.push('OTHER');
  f.presentation.updateModeButtons();
  assert.equal(f.elements.modeTaskResults.classList.contains('hidden'), false);
  assert.equal(f.elements.modeTaskResultsList.children.length, 1);
  assert.equal(f.elements.modeTaskResultsList.children[0].children[2].dataset.objectId, 'OTHER');
});

test('merge review distinguishes surviving and absorbed countries without losing metrics or impact', async t => {
  const feature = (id, name) => ({ type: 'Feature', id,
    properties: { entityKind: 'general', name },
    geometry: { type: 'Polygon', coordinates: [[[0,0],[1,0],[1,1],[0,0]]] } });
  const countries = { COUNTRY: feature('COUNTRY', 'Country'), OTHER: feature('OTHER', 'Other') };
  const preview = {
    operation: 'merge', affectedIds: ['COUNTRY', 'OTHER'], removedIds: ['OTHER'],
    validation: { blocking: false, issues: [] }, temporalImpact: [],
    delta: { objects: [] }, metrics: { finalAreaKm2: 42 },
  };
  const f = await fixture(t, {
    tool: 'merge-country', mergeSourceCountryId: 'COUNTRY',
    mergeTargetCountryIds: ['OTHER'], boundaryEditPhase: '', boundaryPreparation: null,
    geometryPreview: { session: preview },
  }, {
    countrySourceFeature: id => countries[id] || null,
    objectDisplayInfo: ref => ({ name: countries[ref.id]?.properties.name || ref.id, type: ref.type }),
  });
  const affected = f.elements.modeTaskAffectedSummary.parentElement;
  const rows = () => f.elements.geometryPreviewSummary.children.map(row =>
    [row.children[0].textContent, row.children[1].textContent]);

  f.presentation.updateModeButtons();
  assert.equal(f.elements.geometryPreviewSummary.classList.contains('hidden'), false);
  assert.deepEqual(rows().slice(0, 2), [
    ['남길 객체', 'Country'], ['합쳐질 객체', 'Other'],
  ]);
  assert.ok(rows().some(([label, value]) => label === '결과 면적' && value === '42 km²'));
  assert.equal(f.elements.modeTaskViewTime.parentElement.classList.contains('hidden'), false);
  assert.equal(f.elements.modeTaskAffectedList.textContent, 'Country, Other');
  assert.equal(affected.hidden, true, 'exactly duplicated impact is already shown by merge roles');

  preview.affectedIds.push('DEPENDENT');
  f.presentation.syncEditingContext();
  assert.equal(affected.hidden, false, 'additional affected entity must remain visible');
  assert.match(f.elements.modeTaskAffectedList.textContent, /DEPENDENT/);
  preview.affectedIds.pop();

  preview.validation.issues.push({ severity: 'warning', message: '참조를 확인하세요.' });
  f.presentation.syncEditingContext();
  assert.equal(affected.hidden, false, 'warnings preserve full affected details');
  preview.validation.issues.pop();

  preview.temporalImpact.push({ entityId: 'DEPENDENT', from: '1950-01' });
  f.presentation.syncEditingContext();
  assert.equal(affected.hidden, false, 'unselected temporal changes preserve full impact');
  preview.temporalImpact.pop();

  preview.delta.objects.push({ ref: { domain: 'distribution', id: 'd1' } });
  f.presentation.syncEditingContext();
  assert.equal(affected.hidden, false, 'changes to dependent content preserve impact');
  preview.delta.objects.pop();

  preview.removedIds.push('UNEXPECTED');
  f.presentation.syncEditingContext();
  assert.equal(affected.hidden, false, 'extra removals preserve impact');
  preview.removedIds.pop();

  preview.validation.blocking = true;
  f.presentation.updateModeButtons();
  assert.equal(affected.hidden, false, 'blocked preview never suppresses impact');
  assert.equal(f.elements.geometryPreviewSummary.classList.contains('hidden'), true);
  preview.validation.blocking = false;

  preview.validation = undefined;
  f.presentation.syncEditingContext();
  assert.equal(affected.hidden, false, 'missing validation must never hide affected objects');
  preview.validation = { blocking: false, issues: [] };

  preview.operation = 'unrelated';
  f.presentation.updateModeButtons();
  assert.equal(affected.hidden, false, 'unmatched preview operation retains affected objects');
  assert.equal(rows()[0][0], '대상', 'unmatched preview operation must not label an unrelated preview as a merge');
  preview.operation = 'merge';

  f.state.geometryPreview.session = null;
  f.presentation.updateModeButtons();
  assert.equal(affected.hidden, false, 'returning to selection restores impact disclosure');
  assert.equal(f.elements.geometryPreviewSummary.classList.contains('hidden'), true);
});

test('subunit merge review uses the same roles without hiding indirect effects', async t => {
  const geometry = { type: 'Polygon', coordinates: [[[0,0],[1,0],[1,1],[0,0]]] };
  const units = ['SUB', 'OTHER'].map(id => ({
    type: 'Feature', id,
    properties: { name: id === 'SUB' ? 'Kept subunit' : 'Absorbed subunit', entityKind: 'general', parentId: 'COUNTRY' },
    geometry,
  }));
  const preview = {
    operation: 'territorial-merge', affectedIds: ['SUB', 'OTHER'],
    removedIds: ['OTHER'], validation: { blocking: false, issues: [] },
    temporalImpact: [], delta: { objects: [] }, metrics: { finalAreaKm2: 18 },
  };
  const f = await fixture(t, {
    tool: 'merge-territorial-unit', territorialUnitMergeSourceId: 'SUB',
    territorialUnitMergeTargetIds: ['OTHER'], territorialEntities: units,
    boundaryEditPhase: '', boundaryPreparation: null, geometryPreview: { session: preview },
  }, {
    objectDisplayInfo: ref => ({ name: units.find(unit => unit.id === ref.id)?.properties.name || ref.id, type: ref.type }),
  });
  f.presentation.updateModeButtons();
  const rows = f.elements.geometryPreviewSummary.children.map(row =>
    [row.children[0].textContent, row.children[1].textContent]);
  assert.deepEqual(rows.slice(0, 2), [
    ['남길 객체', 'Kept subunit'], ['합쳐질 객체', 'Absorbed subunit'],
  ]);
  assert.equal(f.elements.modeTaskAffectedSummary.parentElement.hidden, true);
  preview.affectedIds.push('CHILD');
  f.presentation.syncEditingContext();
  assert.equal(f.elements.modeTaskAffectedSummary.parentElement.hidden, false,
    'additional dependent units keep the original impact disclosure');
});

test('non-merge preview retains the original general target label', async t => {
  const f = await fixture(t, {
    tool: 'redraw-territorial-unit', territorialUnitRedrawSourceId: 'SUB',
    boundaryEditPhase: '', boundaryPreparation: null,
    geometryPreview: { session: { validation: { blocking: false }, metrics: { finalAreaKm2: 9 } } },
    territorialEntities: [{
      type: 'Feature', id: 'SUB', properties: { name: 'Subunit', entityKind: 'general', parentId: 'COUNTRY' },
      geometry: { type: 'Polygon', coordinates: [[[0,0],[1,0],[1,1],[0,0]]] },
    }],
  }, { objectDisplayInfo: ref => ({ name: 'Subunit', type: ref.type }) });
  f.presentation.updateModeButtons();
  const labels = f.elements.geometryPreviewSummary.children.map(row => row.children[0].textContent);
  assert.ok(labels.includes('대상'), 'other editors should retain the existing review terminology');
  assert.ok(!labels.includes('합쳐질 객체'));
});

test('country border target picker hides only uncalculated metadata and restores it for editing', async t => {
  const f = await fixture(t, {
    tool: 'territorial-border', boundaryEditSeedEntityId: 'COUNTRY',
    boundaryEditEntityIds: ['COUNTRY'], boundaryEditPhase: 'selecting',
    boundaryPreparation: { status: 'ready' }, geometryPreview: { session: null },
  });
  f.presentation.syncEditingContext();
  assert.equal(f.elements.modeTaskViewTime.parentElement.classList.contains('hidden'), true);
  f.state.boundaryEditPhase = 'editing';
  f.presentation.syncEditingContext();
  assert.equal(f.elements.modeTaskViewTime.parentElement.classList.contains('hidden'), false);
});

test('border vertex editing hides uncalculated metadata and review restores real impact', async t => {
  const feature = (id, name) => ({
    type: 'Feature', id, properties: { name, entityKind: 'general' },
    geometry: { type: 'Polygon', coordinates: [[[0,0],[0,1],[1,1],[0,0]]] },
  });
  const countries = { COUNTRY: feature('COUNTRY', 'Country'), NEIGHBOR: feature('NEIGHBOR', 'Neighbor') };
  const f = await fixture(t, {
    tool: 'territorial-border', boundaryEditSeedEntityId: 'COUNTRY',
    boundaryEditEntityIds: ['COUNTRY', 'NEIGHBOR'], boundaryEditPhase: 'editing',
    boundaryPreparation: { status: 'ready' }, geometryPreview: { session: null },
  }, {
    countrySourceFeature: id => countries[id] || null,
    objectDisplayInfo: ref => ({ name: countries[ref.id]?.properties.name || ref.id, type: ref.type }),
    editingDomain: { snapshot: () => ({ boundaryDraft: { moveCount: 0 } }) },
  });
  f.presentation.updateModeButtons();
  assert.equal(f.elements.modeTaskViewTime.parentElement.classList.contains('hidden'), true);
  assert.equal(f.elements.modeTaskObjects.classList.contains('hidden'), false);
  assert.equal(f.elements.modePrimaryBtn.disabled, true);
  assert.equal(f.elements.modePrimaryBtn.textContent, '변경 미리보기');

  const preview = {
    operation: 'territorial-country-boundary',
    affectedIds: ['COUNTRY', 'NEIGHBOR'],
    validation: { blocking: false, issues: [] },
    metrics: { finalAreaKm2: 42 },
    temporalImpact: [{ entityId: 'COUNTRY', from: '1950-01', until: '1951-01' }],
  };
  f.state.geometryPreview.session = preview;
  f.presentation.updateModeButtons();
  assert.equal(f.elements.modeTaskViewTime.parentElement.classList.contains('hidden'), false);
  assert.equal(f.elements.geometryPreviewSummary.classList.contains('hidden'), false);
  const rows = f.elements.geometryPreviewSummary.children.map(row =>
    [row.children[0].textContent, row.children[1].textContent]);
  assert.deepEqual(rows[0], ['국경 조정 국가', 'Country, Neighbor']);
  assert.ok(rows.some(([name, value]) => name === '결과 면적' && value === '42 km²'));
  assert.match(f.elements.modeTaskPeriod.textContent, /1950-01/);
  assert.equal(f.elements.modePrimaryBtn.textContent, '경계 변경 적용');
  assert.equal(f.elements.modePrimaryBtn.disabled, false);

  preview.validation = { blocking: true, issues: [{ severity: 'error', message: '경계가 겹칩니다.' }] };
  f.presentation.updateModeButtons();
  assert.equal(f.elements.geometryPreviewSummary.classList.contains('hidden'), true);
  assert.equal(f.elements.modeTaskDisabledReason.textContent, '경계가 겹칩니다.');
  assert.equal(f.elements.modeTaskDisabledReason.classList.contains('hidden'), false);
  assert.equal(f.elements.modePrimaryBtn.disabled, true);

  f.state.geometryPreview.session = null;
  f.presentation.updateModeButtons();
  assert.equal(f.elements.modeTaskViewTime.parentElement.classList.contains('hidden'), true);
});

test('mobile border edit shows one routine hint while retaining processing and accessibility', async t => {
  const prepare = (isMobile, status = 'ready') => fixture(t, {
    tool: 'territorial-border', boundaryEditSeedEntityId: 'COUNTRY',
    boundaryEditEntityIds: ['COUNTRY'], boundaryEditPhase: 'editing',
    boundaryPreparation: { status }, geometryPreview: { session: null },
  }, {
    isMobile: () => isMobile,
    editingDomain: { snapshot: () => ({ boundaryDraft: { moveCount: 0 } }) },
  });
  const mobile = await prepare(true);
  mobile.presentation.updateModeButtons();
  assert.equal(mobile.elements.modeTaskInput.classList.contains('hidden'), false);
  assert.equal(mobile.elements.modeTaskDisabledReason.textContent,
    '꼭짓점을 이동하면 변경을 미리 볼 수 있습니다.');
  assert.equal(mobile.elements.modeTaskDisabledReason.classList.contains('hidden'), true);
  assert.match(mobile.elements.modePrimaryBtn.attributes.get('aria-describedby') || '',
    /modeTaskDisabledReason/);
  mobile.state.boundaryPreparation.status = 'pending';
  mobile.presentation.updateModeButtons();
  assert.equal(mobile.elements.modeTaskStatus.dataset.taskState, 'preparing');
  assert.equal(mobile.elements.modeTaskDisabledReason.classList.contains('hidden'), false);

  const desktop = await prepare(false);
  desktop.presentation.updateModeButtons();
  assert.equal(desktop.elements.modeTaskInput.classList.contains('hidden'), true);
  assert.equal(desktop.elements.modeTaskDisabledReason.classList.contains('hidden'), false);
});

test('coast editing keeps topology constraints while hiding uncalculated metadata', async t => {
  const f = await fixture(t, {
    tool: 'country-coast', coastEditCountryId: 'COUNTRY',
    boundaryEditPhase: '', boundaryPreparation: { status: 'ready' },
    geometryPreview: { session: null },
  }, {
    editingDomain: { snapshot: () => ({ boundaryDraft: { moveCount: 0 } }) },
  });
  f.presentation.updateModeButtons();
  assert.equal(f.elements.modeTaskViewTime.parentElement.classList.contains('hidden'), true);
  assert.equal(f.elements.modeTaskInput.classList.contains('hidden'), false);
  assert.equal(f.elements.modeTaskInput.textContent, '국경 접점은 고정됩니다.');
  assert.equal(f.elements.modePrimaryBtn.disabled, true);
  assert.equal(f.elements.modePrimaryBtn.textContent, '변경 미리보기');

  f.state.coastEditScopeGenericFeatureId = 'GEN-1';
  f.presentation.syncEditingContext();
  assert.equal(f.elements.modeTaskInput.textContent, '연결 영역도 함께 변경됩니다.');

  f.state.spacePanActive = true;
  f.presentation.syncEditingContext();
  assert.match(f.elements.modeTaskInput.textContent, /지도 이동 중/);
  assert.doesNotMatch(f.elements.modeTaskInput.textContent, /연결 영역/);
  f.state.spacePanActive = false;

  f.state.boundaryPreparation.status = 'error';
  f.presentation.updateModeButtons();
  assert.equal(f.elements.modeTaskInput.classList.contains('hidden'), true,
    'topology note should not compete with an actual preparation error');
});

test('coast preview restores dates and shows the edited scope without hiding validation', async t => {
  const f = await fixture(t, {
    tool: 'country-coast', coastEditCountryId: 'COUNTRY',
    boundaryEditPhase: '', boundaryPreparation: { status: 'ready' },
    geometryPreview: { session: null },
  }, {
    editingDomain: { snapshot: () => ({ boundaryDraft: { moveCount: 1 } }) },
  });
  const preview = {
    operation: 'territorial-coast', affectedIds: ['COUNTRY'],
    metrics: { finalAreaKm2: 52 },
    temporalImpact: [{ entityId: 'COUNTRY', from: '1950-01', until: '1951-01' }],
    validation: { blocking: false, issues: [] },
  };
  f.state.geometryPreview.session = preview;
  f.presentation.updateModeButtons();
  assert.equal(f.elements.modeTaskViewTime.parentElement.classList.contains('hidden'), false);
  assert.equal(f.elements.modeTaskInput.classList.contains('hidden'), true);
  const rows = () => f.elements.geometryPreviewSummary.children.map(row =>
    [row.children[0].textContent, row.children[1].textContent]);
  assert.deepEqual(rows()[0], ['해안선 조정 국가', 'Country']);
  assert.ok(rows().some(([label, value]) => label === '결과 면적' && value === '52 km²'));
  assert.match(f.elements.modeTaskPeriod.textContent, /1950-01/);
  assert.equal(f.elements.modePrimaryBtn.textContent, '경계 변경 적용');

  f.state.coastEditScopeGenericFeatureId = 'GEN-1';
  f.presentation.updateModeButtons();
  assert.equal(rows()[0][0], '해안선 조정 대상');
  assert.equal(f.elements.modeTaskAffectedSummary.parentElement.hidden, false);

  preview.validation = { blocking: true, issues: [{ severity: 'error', message: '해안 위상 검증 실패' }] };
  f.presentation.updateModeButtons();
  assert.equal(f.elements.geometryPreviewSummary.classList.contains('hidden'), true);
  assert.equal(f.elements.modeTaskDisabledReason.textContent, '해안 위상 검증 실패');
  assert.equal(f.elements.modeTaskDisabledReason.classList.contains('hidden'), false);
  assert.equal(f.elements.modePrimaryBtn.disabled, true);
  f.state.geometryPreview.session = null;
  f.presentation.syncEditingContext();
  assert.equal(f.elements.modeTaskViewTime.parentElement.classList.contains('hidden'), true);
});

test('coast mobile gesture hint is not repeated while progress remains visible', async t => {
  const f = await fixture(t, {
    tool: 'country-coast', coastEditCountryId: 'COUNTRY',
    boundaryEditPhase: '', boundaryPreparation: { status: 'ready' },
    geometryPreview: { session: null },
  }, {
    isMobile: () => true,
    editingDomain: { snapshot: () => ({ boundaryDraft: { moveCount: 0 } }) },
  });
  f.presentation.updateModeButtons();
  assert.equal(f.elements.modeTaskInput.classList.contains('hidden'), false);
  assert.match(f.elements.modeTaskInput.textContent, /국경 접점은 고정됩니다/);
  assert.equal(f.elements.modeTaskDisabledReason.classList.contains('hidden'), true);
  assert.equal(f.elements.modeTaskDisabledReason.textContent, '꼭짓점을 이동하면 변경을 미리 볼 수 있습니다.');
  assert.match(f.elements.modePrimaryBtn.attributes.get('aria-describedby') || '', /modeTaskDisabledReason/);
  f.state.boundaryPreparation.status = 'pending';
  f.presentation.updateModeButtons();
  assert.equal(f.elements.modeTaskStatus.dataset.taskState, 'preparing');
  assert.equal(f.elements.modeTaskDisabledReason.classList.contains('hidden'), false);
});

test('region redraw reuses the current target card, hides pre-review metadata and preserves review', async t => {
  const f = await fixture(t, {
    tool: 'redraw-territorial-unit',
    boundaryEditPhase: '',
    boundaryPreparation: null,
    territorialUnitRedrawSourceId: 'REG',
    territorialEntities: [{
      type: 'Feature', id: 'REG', properties: { name: '독립 권역', entityKind: 'regional' },
      geometry: { type: 'Polygon', coordinates: [] },
    }],
  }, {
    describeTool: () => ({ name: '영역 다시 지정', stage: '영역 그리기' }),
    objectDisplayInfo: ref => ({ name: ref.id === 'REG' ? '독립 권역' : 'Country', type: ref.type }),
    isGenericFeatureDraftTool: () => true,
  });
  f.presentation.updateModeButtons();
  assert.equal(f.elements.modeTaskName.textContent, '영역 다시 지정');
  assert.equal(f.elements.modeTaskStage.textContent, '영역 그리기');
  assert.equal(f.elements.modeTaskStep.textContent, '1 / 2');
  assert.equal(f.elements.modeTaskObjects.classList.contains('hidden'), false);
  assert.equal(f.elements.modeTaskObjects.children[0].children[0].textContent, '대상 영역');
  assert.equal(f.elements.modeTaskObjects.children[0].children[1].children[0].textContent, '독립 권역');
  assert.equal(f.elements.modeTaskTargetSummary.parentElement.classList.contains('hidden'), true);
  assert.equal(f.elements.modeTaskViewTime.parentElement.classList.contains('hidden'), true);
  assert.equal(f.elements.geometryPreviewSummary.classList.contains('hidden'), true);

  f.state.modeTaskMinimized = true;
  f.presentation.syncMapContextSurfaces();
  assert.equal(f.elements.modeTaskTargetSummary.parentElement.classList.contains('hidden'), false);
  f.state.modeTaskMinimized = false;
  f.state.geometryPreview.session = {
    operation: 'redraw-region', validation: { blocking: false },
    metrics: { finalAreaKm2: 42 }, affectedIds: ['REG'],
  };
  f.presentation.updateModeButtons();
  assert.equal(f.elements.modeTaskStage.textContent, '변경 확인');
  assert.equal(f.elements.modeTaskStep.textContent, '2 / 2');
  assert.equal(f.elements.modeTaskObjects.classList.contains('hidden'), true);
  assert.equal(f.elements.geometryPreviewSummary.classList.contains('hidden'), false);
  assert.equal(f.elements.modeTaskTargetSummary.parentElement.classList.contains('hidden'), true);
  assert.equal(f.elements.modeTaskViewTime.parentElement.classList.contains('hidden'), false);
  assert.equal(f.elements.geometryPreviewSummary.children.at(-1).children[1].textContent, '42 km²');

  f.state.geometryPreview.session.validation = {
    blocking: true, issues: [{ severity: 'error', message: '영역이 유효하지 않습니다.' }],
  };
  f.presentation.updateModeButtons();
  assert.equal(f.elements.geometryPreviewSummary.classList.contains('hidden'), true);
  assert.equal(f.elements.modeTaskDisabledReason.textContent, '영역이 유효하지 않습니다.');
  assert.equal(f.elements.modeTaskDisabledReason.classList.contains('hidden'), false);
  f.state.geometryPreview.session = null;
  f.presentation.updateModeButtons();
  assert.equal(f.elements.modeTaskStage.textContent, '영역 그리기');
  assert.equal(f.elements.modeTaskObjects.classList.contains('hidden'), false);
  assert.equal(f.elements.modeTaskViewTime.parentElement.classList.contains('hidden'), true);
});
