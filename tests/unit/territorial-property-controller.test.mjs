import assert from 'node:assert/strict';
import test from 'node:test';
import { createTerritorialPropertyController } from '../../assets/js/modules/territorial-property-controller.js';
import { createTerritorialFeature } from '../../assets/js/modules/territorial-units.js';
import { normalizeObjectRef } from '../../assets/js/modules/object-selection-controller.js';

const square = side => ({ type: 'Polygon', coordinates: [[[0, 0], [0, side], [side, side], [side, 0], [0, 0]]] });

function setup() {
  const a = normalizeObjectRef({ domain: 'territorial', type: 'entity', id: 'A' });
  const feature = createTerritorialFeature({ id: 'A', entityKind: 'general', name: 'A', geometry: square(1) });
  const views = new Map([[a.key, { ref: a, displayName: 'A', feature, properties: feature.properties }]]);
  const fields = new Map();
  const getElement = id => {
    if (!fields.has(id)) fields.set(id, { value: '', disabled: false, classList: { toggle() {} }, addEventListener() {} });
    return fields.get(id);
  };
  const forms = []; 
  let primary = a;
  const callbacks = [];
  const calculations = [];
  const area = { textContent: '', dataset: {} };
  const selectionStatus = { textContent: '' };
  const controller = createTerritorialPropertyController({
    window: { requestIdleCallback: callback => callbacks.push(callback) },
    elements: { area, selectionStatus, name: getElement('entityNameInput'), notes: getElement('entityNotesInput'), color: getElement('entityColorInput') },
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
  });
  return { a, views, callbacks, calculations, area, selectionStatus, controller, fields, forms, setPrimary: ref => { primary = ref; } };
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
