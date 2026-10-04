import assert from 'node:assert/strict';
import test from 'node:test';
import { createObjectMetadata } from '../../assets/js/modules/app-object-metadata.js';
import { normalizeColorValue } from '../../assets/js/modules/color-adapter.js';
import { createGpuMapRenderer } from '../../assets/js/modules/gpu-map-renderer.js';

function setup() {
  const feature = { type: 'Feature', id: 'river-1', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
    properties: { category: 'river', name: 'Old river', editorColor: '#3b82c4', notes: '' } };
  const state = { selected: { domain: 'hydro', id: feature.id }, hydroEdits: [feature], stateRevision: 7 };
  const events = [], history = [];
  const owner = createObjectMetadata();
  owner.connect({
    projectState: { state }, colorModel: { normalizeEditorColor: normalizeColorValue },
    hydroPresentation: { hydroEditById: id => state.hydroEdits.find(item => item.id === id),
      HYDRO_TOOL_CONFIG: { river: { color: '#3b82c4' } }, hydroCategoryLabel: () => '강' },
    domains: { projectDomain: {
      recordHistory() { history.push(structuredClone(feature)); events.push('history'); },
      queueAutosave() { events.push('autosave'); },
    }, renderingDomain: { invalidateHydroPatch(reason) { events.push(['render', reason, state.stateRevision, feature.properties.editorColor]); } } },
    layers: { markLayerTreeDirty() { events.push('tree'); } },
    propertyEditingA: { applyHydroSelectionIntent(id, refreshOnly) { events.push(['present', id, refreshOnly]); } },
    feedback: { setActionStatus(_message, kind) { events.push(['status', kind]); } },
  });
  return { owner, state, feature, events, history };
}

test('normalized color change advances the existing revision before invalidating and refreshing', () => {
  const { owner, state, feature, events, history } = setup();
  owner.commitHydroEdit('editorColor', ' #ABCDEF ');
  assert.equal(feature.properties.editorColor, '#abcdef');
  assert.equal(state.stateRevision, 8);
  assert.equal(history.length, 1);
  assert.equal(history[0].properties.editorColor, '#3b82c4');
  assert.deepEqual(events, ['history', ['render', 'hydro-color-edited', 8, '#abcdef'],
    ['present', 'river-1', true], 'autosave', ['status', 'success']]);
});

test('name change marks the tree dirty without a hydro patch', () => {
  const { owner, state, feature, events } = setup();
  owner.commitHydroEdit('name', 'New river');
  assert.equal(feature.properties.name, 'New river');
  assert.equal(state.stateRevision, 8);
  assert.deepEqual(events, ['history', 'tree', ['present', 'river-1', true], 'autosave', ['status', 'success']]);
});

test('notes change is saved without dirtying the tree or hydro rendering', () => {
  const { owner, state, feature, events } = setup();
  owner.commitHydroEdit('notes', 'New notes');
  assert.equal(feature.properties.notes, 'New notes');
  assert.equal(state.stateRevision, 8);
  assert.deepEqual(events, ['history', ['present', 'river-1', true], 'autosave', ['status', 'success']]);
});

test('unchanged normalized metadata, including invalid color resolved to the existing default, has no side effects', () => {
  const { owner, state, events, history } = setup();
  for (const [field, value] of [['editorColor', ' #3B82C4 '], ['editorColor', 'invalid'], ['name', 'Old river'], ['notes', '']]) {
    assert.equal(owner.commitHydroEdit(field, value), false);
  }
  assert.equal(state.stateRevision, 7);
  assert.deepEqual(events, []);
  assert.deepEqual(history, []);
});

test('locked hydro metadata is not changed or submitted to the renderer', () => {
  const { owner, state, feature, events, history } = setup();
  feature.properties.locked = true;
  owner.commitHydroEdit('editorColor', '#abcdef');
  assert.equal(feature.properties.editorColor, '#3b82c4');
  assert.equal(state.stateRevision, 7);
  assert.deepEqual(history, []);
  assert.deepEqual(events, [['status', 'error']]);
});

test('the actual GPU hydro revision gate accepts an edited color and skips an unchanged color', t => {
  const previousWindow = globalThis.window;
  globalThis.window = { devicePixelRatio: 1 };
  t.after(() => {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  });
  const { owner, state } = setup();
  state.hydroEdits.push({ ...structuredClone(state.hydroEdits[0]), id: 'river-2' });
  const renderer = createGpuMapRenderer({ state, runtimeAssetUrl: path => path, isMobile: () => false, scheduleGpuFrame() {},
    renderCountryBoundaryFeatures: () => [], countryBoundaryStyleById: () => null });
  t.after(() => renderer.dispose());
  assert.equal(renderer.setHydroEdits(state.hydroEdits, state.stateRevision), true);
  assert.equal(renderer.getStats().hydroEditBatchCount, 1);
  assert.equal(renderer.setHydroEdits(state.hydroEdits, state.stateRevision), false);
  owner.commitHydroEdit('editorColor', '#abcdef');
  assert.equal(renderer.setHydroEdits(state.hydroEdits, state.stateRevision), true);
  assert.equal(renderer.getStats().hydroEditBatchCount, 2);
  assert.equal(renderer.getStats().hydroEditRevision, 8);
  owner.commitHydroEdit('editorColor', ' #ABCDEF ');
  assert.equal(renderer.setHydroEdits(state.hydroEdits, state.stateRevision), false);
});
