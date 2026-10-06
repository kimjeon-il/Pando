import assert from 'node:assert/strict';
import { createSemanticIcon } from '../../assets/js/modules/icon-utils.js';
import { editorNode } from './helpers/editor-dom-fixture.mjs';
import test from 'node:test';
import { createTerritorialPropertyController } from '../../assets/js/modules/territorial-property-controller.js';
import { createTerritorialFeature } from '../../assets/js/modules/territorial-units.js';
import { normalizeObjectRef } from '../../assets/js/modules/object-selection-controller.js';

const square = side => ({ type: 'Polygon', coordinates: [[[0, 0], [0, side], [side, side], [side, 0], [0, 0]]] });

function setup(overrides = {}) {
  const a = normalizeObjectRef({ domain: 'territorial', type: 'entity', id: 'A' });
  const feature = createTerritorialFeature({ id: 'A', entityKind: 'general', name: 'A', geometry: square(1) });
  const views = new Map([[a.key, { ref: a, displayName: 'A', feature, properties: feature.properties }]]);
  const node = editorNode;
  const fields = new Map();
  const getElement = id => {
    if (!fields.has(id)) fields.set(id, node());
    return fields.get(id);
  };
  const forms = [];
  const relations = [], focused = [];
  let primary = a;
  const callbacks = [];
  const calculations = [];
  const area = { textContent: '', dataset: {} };
  const selectionStatus = { textContent: '' };
  const controller = createTerritorialPropertyController({
    window: { ...editorNode(), requestIdleCallback: callback => callbacks.push(callback) },
    document: { ...editorNode(), createElement: node },
    createIcon: (name, className) => createSemanticIcon({ createElementNS: (_namespace, tag) => node(tag) }, name, className),
    entityRepository: {
      ancestors: () => [],
      list: () => [...views.values()].map(view => view.feature),
      parent: id => [...views.values()].find(view => view.feature.id === views.get(a.key).feature.properties.parentId)?.feature || null,
      children: id => [...views.values()].filter(view => view.feature.properties.parentId === id).map(view => view.feature),
    },
    elements: { area, selectionStatus, name: getElement('entityNameInput'), notes: getElement('entityNotesInput'), color: getElement('entityColorInput') },
    commitRelation: (...args) => { relations.push(args); return { ok: true, changed: true }; },
    focusObject: ref => focused.push(ref),
    getElement, territorialParentOptions: () => [{ value: '', label: '상위 객체 없음' }],
    replaceSelectOptions: (element, _choices, value) => { element.value = value; },
    refreshTerritorialCoastAvailability() {},
    getTerritorialView: ref => views.get(ref.key), getPrimaryRef: () => primary,
    showPropertyForm: (...args) => forms.push(args), resolveColor: () => ({ value: '#888888', isDefault: true }),
    defaultColor: () => '#888888', syncColorPicker() {}, resolveFlagUrl: () => null,
    calculateAreaKm2: geometry => {
      calculations.push(geometry);
      const ring = geometry.coordinates[0];
      return Math.abs(ring.slice(1).reduce((sum, point, index) => sum + ring[index][0] * point[1] - point[0] * ring[index][1], 0)) / 2;
    },
    formatArea: value => `${value} km²`,
    ...overrides,
  });
  return { a, views, callbacks, calculations, area, selectionStatus, controller, fields, forms, relations, focused, setPrimary: ref => { primary = ref; } };
}

test('presenting the same entity twice while its area is pending completes with one calculation and current name', () => {
  const state = setup();
  state.controller.present(state.a);
  const firstView = state.views.get(state.a.key);
  state.views.set(state.a.key, { ...firstView, displayName: 'A renamed' });
  state.controller.present(state.a, { refreshOnly: true });
  assert.equal(state.callbacks.length, 1);
  assert.equal(state.area.textContent, '면적 계산 중…');
  state.callbacks.shift()();
  assert.equal(state.calculations.length, 1);
  assert.equal(state.area.textContent, '1 km²');
  assert.equal(state.selectionStatus.textContent, 'A renamed · 1 km²');
});

test('replaced entity geometry discards the old display result and calculates the new geometry only once', () => {
  const state = setup();
  state.controller.present(state.a);
  const first = state.views.get(state.a.key);
  const secondGeometry = square(2);
  state.views.set(state.a.key, { ...first, feature: { ...first.feature, geometry: secondGeometry } });
  state.controller.present(state.a);
  assert.equal(state.callbacks.length, 2);
  state.callbacks.shift()();
  assert.equal(state.area.textContent, '면적 계산 중…');
  assert.equal(state.selectionStatus.textContent, 'A');
  assert.equal(state.callbacks.length, 1);
  state.callbacks.shift()();
  assert.deepEqual(state.calculations, [first.feature.geometry, secondGeometry]);
  assert.equal(state.area.textContent, '4 km²');
  assert.equal(state.selectionStatus.textContent, 'A · 4 km²');
});

test('an area callback schedules a replaced current geometry when no new presentation has run', () => {
  const state = setup();
  state.controller.present(state.a);
  const first = state.views.get(state.a.key);
  state.views.set(state.a.key, { ...first, displayName: 'A changed', feature: { ...first.feature, geometry: square(2) } });
  state.callbacks.shift()();
  assert.equal(state.area.textContent, '면적 계산 중…');
  assert.equal(state.callbacks.length, 1);
  state.callbacks.shift()();
  assert.equal(state.area.textContent, '4 km²');
  assert.equal(state.selectionStatus.textContent, 'A changed · 4 km²');
});

for (const reason of ['selection cleared', 'disposed']) test(`pending area does not update the screen after ${reason}`, () => {
  const state = setup();
  state.controller.present(state.a);
  if (reason === 'disposed') state.controller.dispose();
  else { state.setPrimary(null); state.controller.clear(); }
  state.callbacks.shift()();
  assert.equal(state.area.textContent, '면적 계산 중…');
  assert.equal(state.selectionStatus.textContent, 'A');
});

test('one entity form presents general roots, children and independent regions', () => {
  const state = setup();
  for (const [entityKind, parentId] of [['general', ''], ['general', 'P'], ['regional', '']]) {
    const feature = createTerritorialFeature({ id: 'A', entityKind, parentId, geometry: square(1) });
    state.views.set(state.a.key, { ref: state.a, displayName: 'A', feature, properties: feature.properties });
    state.controller.present(state.a);
    assert.equal(state.forms.at(-1)[0], 'entity');
    assert.equal(state.fields.get('entityParentInput').value, parentId);
    assert.equal(state.fields.get('copyEntityRegionBtn').disabled, false);
  }
});

test('relation controls target parent and child explicitly and GPS never retargets the editor', () => {
  const state = setup();
  const b = normalizeObjectRef({ domain: 'territorial', type: 'entity', id: 'B' });
  const feature = createTerritorialFeature({ id: 'B', entityKind: 'general', geometry: square(1) });
  state.views.set(b.key, { ref: b, displayName: 'B', feature });
  state.controller.present(state.a); state.controller.bind();
  const parent = state.fields.get('entityParentInput'); parent.value = 'B'; parent.dispatch('change');
  assert.deepEqual(state.relations[0], [state.a, 'parentId', 'B']);
  const child = state.fields.get('entityChildInput'); child.value = 'B';
  state.fields.get('entityAddChildBtn').click();
  assert.deepEqual(state.relations[1], [b, 'parentId', 'A']);
  const relations = state.fields.get('entityRelations');
  relations.dispatch('click', { target: { closest: selector => selector === '[data-relation-remove]' ? { dataset: { relationRemove: 'B' } } : null } });
  assert.deepEqual(state.relations[2], [b, 'parentId', '']);
  relations.dispatch('click', { target: { closest: selector => selector === '[data-relation-focus]' ? { dataset: { relationFocus: 'B' } } : null } });
  assert.deepEqual(state.focused, [b]);
  assert.equal(state.forms.at(-1)[1], 'A');
});

function flagFixture(commit = () => {}) {
  const readers = [], errors = [], flags = [];
  let generation = 1;
  const state = setup({
    window: { ...editorNode(), setTimeout() {}, FileReader: class {
      constructor() { const node = editorNode(); node.readAsDataURL = () => {}; readers.push(node); return node; }
    } },
    getProjectGeneration: () => generation,
    commitFlag: (...args) => { commit(...args); flags.push(args); },
    reportFlagError: error => errors.push(error),
  });
  state.controller.present(state.a); state.controller.bind();
  const upload = () => {
    state.fields.get('flagUploadBtn').click();
    const input = state.fields.get('flagFileInput'); input.files = [{}]; input.dispatch('change');
  };
  return { ...state, upload, readers, errors, flags, changeProject: () => { generation++; } };
}

for (const invalidation of ['project', 'selection', 'clear', 'dispose', 'lock']) test(`pending flag read cannot commit after ${invalidation} change`, () => {
  const state = flagFixture(); state.upload();
  if (invalidation === 'project') state.changeProject();
  if (invalidation === 'selection') state.setPrimary(null);
  if (invalidation === 'clear') state.controller.clear();
  if (invalidation === 'dispose') state.controller.dispose();
  if (invalidation === 'lock') state.views.get(state.a.key).feature.properties.locked = true;
  state.readers[0].result = 'data:image/png;base64,flag'; state.readers[0].dispatch('load');
  assert.deepEqual(state.flags, []);
});

test('flag upload uses the current explicit target once and reports commit failures at its boundary', () => {
  const failure = new Error('flag commit failed');
  const state = flagFixture(() => { throw failure; }); state.upload();
  state.readers[0].result = 'data:image/png;base64,flag';
  assert.doesNotThrow(() => state.readers[0].dispatch('load'));
  assert.deepEqual(state.errors, [failure]);
});

test('a newer flag choice invalidates an older pending upload and binding twice does not duplicate commits', () => {
  const state = flagFixture(); state.controller.bind();
  state.upload(); state.upload();
  state.readers[0].result = 'data:image/png;base64,old'; state.readers[0].dispatch('load');
  assert.deepEqual(state.flags, []);
  state.readers[1].result = 'data:image/png;base64,new'; state.readers[1].dispatch('load');
  assert.deepEqual(state.flags, [[state.a, 'data:image/png;base64,new']]);
});

test('child relation rows use the real GPS and remove icons and keep locked children read-only', () => {
  const state = setup();
  const b = normalizeObjectRef({ domain: 'territorial', type: 'entity', id: 'B' });
  const feature = createTerritorialFeature({ id: 'B', entityKind: 'general', parentId: 'A', locked: true, geometry: square(1) });
  state.views.set(b.key, { ref: b, displayName: 'B', feature });
  assert.doesNotThrow(() => state.controller.present(state.a));
  const actions = state.fields.get('entityChildRows').children[0].children[2].children;
  assert.equal(actions[0].children[0].children[0].getAttribute('href'), '#icon-focus-target');
  assert.equal(actions[1].children[0].children[0].getAttribute('href'), '#icon-minus');
  assert.equal(actions[1].disabled, true);
});
