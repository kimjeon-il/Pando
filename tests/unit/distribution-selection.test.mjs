import assert from 'node:assert/strict';
import test from 'node:test';
import { createPropertySelection } from '../../assets/js/modules/app-property-selection.js';

function setup(renderMode = 'single') {
  const layers = [{ id: 'A' }, { id: 'B' }];
  const state = { distributionSettings: { renderMode, activeLayerId: 'A' } };
  const events = [];
  const owner = createPropertySelection();
  owner.connect({
    projectState: { state },
    objectModelA: { distributionService: { getLayer: id => layers.find(layer => layer.id === id) } },
    selectionServices: { normalizeObjectRef: ref => ref },
    distributionPresentation: { bumpVisibilityRevision() { events.push('revision'); } },
    domains: {
      renderingDomain: { renderDistributions() { events.push(['render', state.distributionSettings.activeLayerId]); } },
      projectDomain: { queuePresentationAutosave() { events.push('autosave'); } },
      selectionUiController: { applyIntent(ref, options) { events.push(['select', ref.id, options.refreshOnly]); return true; } },
    },
  });
  return { owner, state, events };
}

for (const mode of ['single', 'overlap']) {
  test(`${mode}: choosing another distribution invalidates and renders its current ID`, () => {
    const { owner, state, events } = setup(mode);
    assert.equal(owner.applyDistributionSelectionIntent('B'), true);
    assert.equal(state.distributionSettings.activeLayerId, 'B');
    assert.equal(state.selectedDistributionLayerId, 'B');
    assert.deepEqual(events, ['revision', ['render', 'B'], 'autosave', ['select', 'B', false]]);
    events.length = 0;
    owner.applyDistributionSelectionIntent('A', true);
    assert.deepEqual(events, ['revision', ['render', 'A'], 'autosave', ['select', 'A', true]]);
  });
}

test('reselecting the active distribution only refreshes selection; missing IDs do nothing', () => {
  const { owner, state, events } = setup();
  owner.applyDistributionSelectionIntent('A', true);
  assert.deepEqual(events, [['select', 'A', true]]);
  events.length = 0;
  assert.equal(owner.applyDistributionSelectionIntent('missing'), false);
  assert.equal(state.distributionSettings.activeLayerId, 'A');
  assert.deepEqual(events, []);
});
