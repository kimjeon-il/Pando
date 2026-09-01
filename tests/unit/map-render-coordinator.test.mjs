import assert from 'node:assert/strict';
import test from 'node:test';

import { createMapRenderCoordinator, MAP_RENDER_DIRTY } from '../../assets/js/modules/map-render-coordinator.js';

function fixture() {
  const calls = [];
  const frames = [];
  const viewState = Object.freeze({ revision: 7, projection: 'globe' });
  const names = [
    'view',
    'base', 'countries', 'hydro', 'hydroEdits', 'boundaryEdit',
    'territorialUnits', 'distributions', 'genericFeatures', 'stackOverlays', 'projectedOverlays', 'geometryPreview',
    'selectionData', 'selectionView', 'selectionStyle', 'validation', 'countryLabelPositions', 'userLabelPositions',
    'labelLayout', 'countryLabels', 'userLabels', 'vertices', 'draft', 'snapIndicator', 'debug', 'layerTree',
  ];
  const renderers = Object.fromEntries(names.map(name => [name, (...args) => {
    calls.push([name, ...args]);
    return name === 'labelLayout' ? { countryLabels: [], userLabels: [] } : undefined;
  }]));
  const coordinator = createMapRenderCoordinator({
    requestFrame: callback => frames.push(callback),
    prepareView: () => { calls.push(['prepare']); return viewState; },
    renderers,
  });
  return { calls, frames, coordinator, viewState };
}

test('full render preserves canonical layer order and revision', () => {
  const { calls, coordinator, viewState } = fixture();
  assert.deepEqual(coordinator.renderFull(), { renderRevision: 1, viewRevision: 7, viewState, viewOnly: false });
  assert.deepEqual(calls.map(call => call[0]), [
    'prepare', 'base', 'hydro', 'hydroEdits', 'territorialUnits',
    'distributions', 'genericFeatures', 'stackOverlays', 'countries', 'geometryPreview', 'validation', 'selectionData',
    'boundaryEdit', 'vertices', 'draft', 'snapIndicator', 'labelLayout', 'countryLabels', 'userLabels', 'layerTree', 'debug',
  ]);
  assert.equal(calls.find(call => call[0] === 'countries')[1], viewState);
  assert.equal(calls.filter(call => !['prepare', 'labelLayout', 'countryLabels', 'userLabels', 'debug', 'layerTree'].includes(call[0])).every(call => call[1] === viewState), true);
  assert.equal(calls.find(call => call[0] === 'countryLabels')[2], viewState);
  assert.equal(calls.find(call => call[0] === 'userLabels')[2], viewState);
  assert.equal(calls.filter(call => call[0] === 'labelLayout').length, 1);
  assert.deepEqual(calls.find(call => call[0] === 'countryLabels')[1], { countryLabels: [], userLabels: [] });
});

test('view render refreshes projection-dependent layers with the shared view state', () => {
  const { calls, coordinator } = fixture();
  coordinator.renderView();
  assert.equal(calls.some(call => call[0] === 'hydro'), false);
  assert.equal(calls.some(call => call[0] === 'view'), true);
  assert.equal(calls.some(call => call[0] === 'projectedOverlays'), false);
  assert.equal(calls.some(call => call[0] === 'layerTree'), false);
  assert.equal(calls.some(call => call[0] === 'selectionData'), false);
  assert.equal(calls.some(call => call[0] === 'selectionView'), true);
  assert.equal(calls.some(call => call[0] === 'countries'), false);
  assert.equal(calls.some(call => call[0] === 'countryLabelPositions'), true);
});

test('scheduled view and full renders merge into one full frame', () => {
  const { calls, frames, coordinator } = fixture();
  assert.equal(coordinator.scheduleView('pan'), true);
  assert.equal(coordinator.scheduleFull('selection'), false);
  assert.equal(coordinator.scheduleView('resize'), false);
  assert.equal(frames.length, 1);
  frames.shift()();
  assert.equal(coordinator.revision(), 1);
  assert.equal(calls.some(call => call[0] === 'hydro'), true);
  assert.equal(calls.some(call => call[0] === 'countryLabelPositions'), false);
  assert.deepEqual(coordinator.getStats().lastReasons, ['pan', 'selection', 'resize']);
  assert.equal(coordinator.advanceRevision(), 2);
});

test('interaction end schedules one delayed settle frame', async () => {
  const { calls, frames, coordinator } = fixture();
  coordinator.beginInteraction();
  coordinator.scheduleView('drag');
  assert.equal(coordinator.endInteraction('settle'), true);
  assert.equal(frames.length, 1);
  frames.shift()();
  assert.equal(coordinator.getStats().viewRenderCount, 1);
  await new Promise(resolve => setTimeout(resolve, 140));
  assert.equal(frames.length, 1);
  frames.shift()();
  assert.equal(calls.filter(call => call[0] === 'labelLayout').length, 1);
  assert.equal(coordinator.getStats().fullRenderCount, 0);
  assert.equal(coordinator.getStats().viewRenderCount, 2);
});

test('GPU-only invalidation does not rebuild overlay data', () => {
  const { calls, frames, coordinator } = fixture();
  coordinator.invalidate('gpu-frame', 'tile-ready');
  frames.shift()();
  assert.equal(calls.some(call => call[0] === 'countries'), true);
  assert.equal(calls.some(call => call[0] === 'hydro'), false);
  assert.equal(calls.some(call => call[0] === 'projectedOverlays'), false);
});

test('selection data and view invalidations use independent render paths', () => {
  const { calls, frames, coordinator } = fixture();
  coordinator.invalidate(MAP_RENDER_DIRTY.SELECTION_DATA, 'selection-change');
  frames.shift()();
  assert.equal(calls.filter(call => call[0] === 'selectionData').length, 1);
  assert.equal(calls.some(call => call[0] === 'selectionView'), false);

  calls.length = 0;
  coordinator.invalidate(MAP_RENDER_DIRTY.SELECTION_VIEW, 'selection-pan');
  frames.shift()();
  assert.equal(calls.filter(call => call[0] === 'selectionView').length, 1);
  assert.equal(calls.some(call => call[0] === 'selectionData'), false);
});

test('domain geometry patches do not rebuild unrelated overlay domains', () => {
  const { calls, frames, coordinator } = fixture();
  coordinator.invalidate(MAP_RENDER_DIRTY.GENERIC_PATCH, 'generic-vertex-commit');
  frames.shift()();
  assert.equal(calls.filter(call => call[0] === 'genericFeatures').length, 1);
  assert.equal(calls.filter(call => call[0] === 'countries').length, 1);
  assert.equal(calls.some(call => call[0] === 'territorialUnits'), false);
  assert.equal(calls.some(call => call[0] === 'distributions'), false);
  assert.equal(calls.some(call => call[0] === 'hydroEdits'), false);

  calls.length = 0;
  coordinator.invalidate(MAP_RENDER_DIRTY.HYDRO_EDIT_PATCH, 'hydro-vertex-commit');
  frames.shift()();
  assert.equal(calls.filter(call => call[0] === 'hydroEdits').length, 1);
  assert.equal(calls.some(call => call[0] === 'countries'), false);
  assert.equal(calls.some(call => call[0] === 'genericFeatures'), false);
});

test('domain edit commits refresh only their own persistent edit overlay', () => {
  const { calls, frames, coordinator } = fixture();
  coordinator.invalidate(MAP_RENDER_DIRTY.GENERIC_PATCH | MAP_RENDER_DIRTY.EDITING_OVERLAYS, 'generic-edit');
  frames.shift()();
  assert.equal(calls.filter(call => call[0] === 'genericFeatures').length, 1);
  assert.equal(calls.filter(call => call[0] === 'vertices').length, 1);
  assert.equal(calls.some(call => call[0] === 'hydroEdits'), false);
  assert.equal(calls.some(call => call[0] === 'boundaryEdit'), false);

  calls.length = 0;
  coordinator.invalidate(MAP_RENDER_DIRTY.HYDRO_EDIT_PATCH | MAP_RENDER_DIRTY.EDITING_OVERLAYS, 'hydro-edit');
  frames.shift()();
  assert.equal(calls.filter(call => call[0] === 'hydroEdits').length, 1);
  assert.equal(calls.some(call => call[0] === 'boundaryEdit'), false);

  calls.length = 0;
  coordinator.invalidate(MAP_RENDER_DIRTY.COUNTRY_PATCH | MAP_RENDER_DIRTY.EDITING_OVERLAYS, 'country-edit');
  frames.shift()();
  assert.equal(calls.filter(call => call[0] === 'boundaryEdit').length, 1);
  assert.equal(calls.some(call => call[0] === 'hydroEdits'), false);
});

test('frame completion reports measured interaction state without changing render ownership', () => {
  const frames = [];
  const samples = [];
  let clock = 0;
  const coordinator = createMapRenderCoordinator({
    requestFrame: callback => frames.push(callback),
    prepareView: () => ({ revision: 1 }),
    renderers: {},
    now: () => ++clock,
    onFrameComplete: sample => samples.push(sample),
  });
  coordinator.beginInteraction('drag');
  coordinator.scheduleView('drag-frame');
  frames.shift()();
  assert.equal(samples.length, 1);
  assert.equal(samples[0].interactionActive, true);
  assert.ok(samples[0].durationMs > 0);
});
