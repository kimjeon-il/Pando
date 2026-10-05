import { createMapVisualFrame } from '../../assets/js/modules/map-visual-frame.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createPropertySelection } from '../../assets/js/modules/app-property-selection.js';
import { createRenderingDomain } from '../../assets/js/modules/rendering-domain.js';
import { MAP_RENDER_DIRTY } from '../../assets/js/modules/map-render-coordinator.js';
import { createTerritorialEntityRepository } from '../../assets/js/modules/territorial-entity-repository.js';
import { createTerritorialScopeResolver } from '../../assets/js/modules/territorial-scope.js';

function setup(renderMode = 'single') {
  const layers = [{ id: 'A' }, { id: 'B' }];
  const state = {
    distributionSettings: { renderMode, activeLayerId: 'A' },
    distributionLayers: layers,
    territorialEntities: [],
    distributionEntries: layers.map(layer => ({ id: `${layer.id}-entry`, layerId: layer.id, mode: 'geometry', value: 1,
      geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } })),
  };
  const events = [];
  const frames = [];
  let visibilityRevision = 0;
  const entityRepository = createTerritorialEntityRepository({ getEntities: () => state.territorialEntities });
  const territorialScope = createTerritorialScopeResolver({ entityRepository, getState: () => state });
  const rendering = createRenderingDomain({
    prepareView: () => testFrame(),
    requestFrame: callback => { frames.push(callback); return frames.length; },
    territorialResources: {
      getState: () => state,
      entityRepository,
      displayEntities: territorialScope.displayEntities,
    },
    distributionResources: {
      getState: () => state,
      getDistributionVisibilityRevision: () => visibilityRevision,
      isLayerItemVisible: () => true,
      DISTRIBUTION_RENDER_MODES: { SINGLE: 'single', OVERLAP: 'overlap' },
      DISTRIBUTION_MODES: { TERRITORIAL: 'territorial' },
    },
  });
  const owner = createPropertySelection();
  owner.connect({
    projectState: { state },
    objectModelA: { distributionService: { getLayer: id => layers.find(layer => layer.id === id) } },
    selectionServices: { normalizeObjectRef: ref => ref },
    distributionPresentation: { bumpVisibilityRevision() { visibilityRevision += 1; events.push('revision'); } },
    domains: {
      renderingDomain: rendering,
      projectDomain: { queuePresentationAutosave() { events.push('autosave'); } },
      selectionUiController: { applyIntent(ref, options) { events.push(['select', ref.id, options.refreshOnly]); return true; } },
    },
  });
  return { owner, state, events, rendering, frames };
}

for (const mode of ['single', 'overlap']) {
  test(`${mode}: choosing another distribution schedules a coordinator frame with the current visible rows`, t => {
    const { owner, state, events, rendering, frames } = setup(mode);
    t.after(() => rendering.dispose());
    assert.equal(owner.applyDistributionSelectionIntent('B'), true);
    assert.equal(state.distributionSettings.activeLayerId, 'B');
    assert.equal(state.selectedDistributionLayerId, 'B');
    assert.deepEqual(events, ['revision', 'autosave', ['select', 'B', false]]);
    assert.equal(frames.length, 1);
    frames.shift()();
    assert.equal(rendering.getStats().lastRequestedMask, MAP_RENDER_DIRTY.OVERLAY_STYLE | MAP_RENDER_DIRTY.LAYER_TREE);
    assert.deepEqual(rendering.getDistributionRenderRows().map(row => row.id), mode === 'single' ? ['B-entry'] : ['A-entry', 'B-entry']);
    events.length = 0;
    owner.applyDistributionSelectionIntent('A', true);
    assert.deepEqual(events, ['revision', 'autosave', ['select', 'A', true]]);
    assert.equal(frames.length, 1);
    frames.shift()();
    assert.deepEqual(rendering.getDistributionRenderRows().map(row => row.id), mode === 'single' ? ['A-entry'] : ['A-entry', 'B-entry']);
  });
}

test('reselecting the active distribution only refreshes selection; missing IDs do nothing', t => {
  const { owner, state, events, rendering, frames } = setup();
  t.after(() => rendering.dispose());
  owner.applyDistributionSelectionIntent('A', true);
  assert.deepEqual(events, [['select', 'A', true]]);
  events.length = 0;
  assert.equal(owner.applyDistributionSelectionIntent('missing'), false);
  assert.equal(state.distributionSettings.activeLayerId, 'A');
  assert.deepEqual(events, []);
  assert.equal(frames.length, 0);
});

const testFrame = (frameId = 1, viewRevision = 1, projectPath = () => 'M0,0L1,1') => createMapVisualFrame({
  frameId, viewRevision, projectionRevision: 1,
  viewState: { projection: 'flat', size: { width: 800, height: 600 }, translate: [400, 300], scale: 100, dpr: 1 }, projectPath });
