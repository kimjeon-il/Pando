import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
/* global Event, EventTarget */
import { createTaskPresentation } from '../../assets/js/modules/app-task-presentation.js';
import { createToolBindings } from '../../assets/js/modules/app-tool-bindings.js';
import { MAP_INTERACTION_OWNER_PORTS, PROJECT_IO_OWNER_PORTS } from '../../assets/js/modules/app-capability-ports.js';
import { capabilityPortsForFixture } from './helpers/capability-port-fixture.mjs';

const htmlSource = await readFile(new URL('../../index.html', import.meta.url), 'utf8');

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
    'modeTaskTargets', 'modeTaskTargetList', 'modeTaskTargetsFocusBtn', 'modeTaskDisabledReason',
    'modePrimaryBtn', 'modeDraftActions', 'modeDraftDoneBtn',
  ];
  const elements = Object.fromEntries(ids.map(id => [id, new FakeElement(document)]));
  const state = {
    tool: 'country-border',
    selected: null,
    territorySelectionSession: null,
    geometryPreview: { session: null },
    labelPlacementMode: false,
    boundaryEditPhase: 'selecting',
    boundaryEditCountryIds: [],
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
  const presentation = createTaskPresentation();
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
    countryFeatureById: id => id === 'COUNTRY' ? { type: 'Feature', id, properties: { name: 'Country' }, geometry: { type: 'Polygon', coordinates: [] } } : null,
    objectDisplayInfo: ref => ({ name: ref.id === 'SUB' ? 'Subunit' : 'Country', type: ref.type }),
    focusObjectRef: ref => focusCalls.push(['single', ref]),
    mapFeatureForObjectRef: ref => ({ type: 'Feature', id: ref.id, properties: {}, geometry: { type: 'Polygon', coordinates: [] } }),
    focusCountry: (feature, options) => focusCalls.push(['multi', feature, options]),
    isMobile: () => false,
    setMapModeContextActive() {},
    editorWorkspacePresentation: { sync() {} },
    syncSelectionToolbarInteraction() {},
    projectUi: { syncHistory() {} },
    syncStatusBar() {},
    ...portOverrides,
  }));
  return { presentation, elements, state, focusCalls };
}

test('task sync lists true country and subunit targets once without focusing the map', t => {
  const f = fixture(t, {
    boundaryEditCountryIds: ['SUB', 'COUNTRY', 'SUB', 'MISSING'],
    territorialUnits: [{ type: 'Feature', id: 'SUB', properties: { name: 'Subunit', unitType: 'subunit' }, geometry: { type: 'Polygon', coordinates: [] } }],
  });

  f.presentation.updateModeButtons();

  assert.deepEqual(f.elements.modeTaskTargetList.children.map(item => item.dataset.objectKey), [
    'territorial:subunit:SUB',
    'territorial:country:COUNTRY',
  ]);
  assert.deepEqual(f.elements.modeTaskTargetList.children.map(item => item.children[0].textContent), ['Subunit', 'Country']);
  assert.equal(f.elements.modeTaskTargets.classList.contains('hidden'), false);
  assert.equal(f.elements.modeTaskTargetsFocusBtn.attributes.get('aria-label'), '선택한 2개 대상으로 이동');
  assert.deepEqual(f.focusCalls, []);
});

test('task target focus uses the approved visible label', () => {
  const button = htmlSource.match(/<button id="modeTaskTargetsFocusBtn"[^>]*>([^<]+)<\/button>/);
  assert.equal(button?.[1], '대상으로 이동');
});

test('task target labels refresh from the repository while object refs stay stable', t => {
  let name = 'Before';
  const f = fixture(t, { boundaryEditCountryIds: ['COUNTRY'] }, {
    objectDisplayInfo: ref => ({ name, type: ref.type }),
  });
  f.presentation.updateModeButtons();
  assert.equal(f.elements.modeTaskTargetList.children[0].children[0].textContent, 'Before');
  assert.equal(f.elements.modeTaskTargetsFocusBtn.attributes.get('aria-label'), '대상으로 이동');

  name = 'After';
  f.presentation.updateModeButtons();

  assert.equal(f.elements.modeTaskTargetList.children[0].children[0].textContent, 'After');
});

test('task status explains pending and missing-target decisions without changing retry eligibility', async t => {
  const pending = fixture(t, {
    boundaryEditCountryIds: ['COUNTRY'],
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
    boundaryEditCountryIds: ['COUNTRY'],
    boundaryPreparation: { status: 'error', message: '경계 계산에 실패했습니다.', retry() {} },
  });
  failed.presentation.updateModeButtons();
  assert.equal(failed.elements.modeTaskStatus.dataset.taskState, 'invalid');
  assert.equal(failed.elements.modeTaskStatus.textContent, '확인 필요');
  assert.equal(failed.elements.modePrimaryBtn.disabled, false);
  assert.equal(failed.elements.modePrimaryBtn.textContent, '다시 시도');
  assert.equal(failed.elements.modeTaskDisabledReason.classList.contains('hidden'), true);

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
    boundaryEditCountryIds: ['SUB'],
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
    boundaryEditCountryIds: ['SUB', 'COUNTRY'],
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
