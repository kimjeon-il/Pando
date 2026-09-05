import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createMapRenderCoordinator,
  MAP_RENDER_DIRTY,
  MAP_RENDER_MASKS,
  RenderInvalidationError,
} from '../../assets/js/modules/map-render-coordinator.js';

function fixture() {
  const calls = [];
  const frames = [];
  const viewState = Object.freeze({ revision: 7, projection: 'globe' });
  const viewFrameResult = Object.freeze({ succeeded: true, selection: { succeeded: true } });
  const names = [
    'view',
    'base', 'countries', 'hydro', 'hydroEdits', 'boundaryEdit',
    'territorialUnits', 'distributions', 'genericFeatures', 'stackOverlays', 'projectedOverlays', 'geometryPreview',
    'selectionData', 'selectionView', 'selectionStyle', 'validation', 'countryLabelPositions', 'userLabelPositions',
    'labelLayout', 'countryLabels', 'userLabels', 'vertices', 'draft', 'snapIndicator', 'debug', 'layerTree',
  ];
  const renderers = Object.fromEntries(names.map(name => [name, (...args) => {
    calls.push([name, ...args]);
    if (name === 'view') return viewFrameResult;
    return name === 'labelLayout' ? { countryLabels: [], userLabels: [] } : undefined;
  }]));
  const coordinator = createMapRenderCoordinator({
    requestFrame: callback => frames.push(callback),
    prepareView: () => { calls.push(['prepare']); return viewState; },
    renderers,
  });
  return { calls, frames, coordinator, viewState, viewFrameResult };
}

test('full render preserves canonical layer order and revision', () => {
  const { calls, frames, coordinator, viewState } = fixture();
  for (const method of ['renderFull', 'renderView', 'renderFrame', 'isInteractionActive', 'advanceRevision', 'scheduleFull', 'scheduleView', 'revision']) {
    assert.equal(coordinator[method], undefined, `${method} is not a public coordinator method`);
  }
  assert.equal(coordinator.invalidate(MAP_RENDER_MASKS.PROJECT, 'test-full'), true);
  frames.shift()();
  assert.equal(coordinator.getStats().renderRevision, 1);
  assert.deepEqual(calls.map(call => call[0]), [
    'prepare', 'base', 'hydro', 'hydroEdits', 'territorialUnits',
    'distributions', 'genericFeatures', 'stackOverlays', 'projectedOverlays', 'countries', 'geometryPreview', 'validation', 'selectionData',
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
  const { calls, frames, coordinator, viewState, viewFrameResult } = fixture();
  assert.equal(coordinator.invalidate(MAP_RENDER_MASKS.VIEW, 'test-view'), true);
  frames.shift()();
  assert.equal(calls.some(call => call[0] === 'hydro'), false);
  assert.equal(calls.some(call => call[0] === 'view'), true);
  assert.equal(calls.some(call => call[0] === 'projectedOverlays'), false);
  assert.equal(calls.some(call => call[0] === 'layerTree'), false);
  assert.equal(calls.some(call => call[0] === 'selectionData'), false);
  assert.equal(calls.some(call => call[0] === 'selectionView'), true);
  const fallbackCall = calls.find(call => call[0] === 'selectionView');
  assert.equal(fallbackCall[1], viewState);
  assert.equal(fallbackCall[2], viewFrameResult);
  assert.deepEqual(fallbackCall[3], { viewOnly: true, updateData: false, sparseFallbackOnly: true });
  assert.equal(coordinator.getStats().lastDirtyMask & MAP_RENDER_DIRTY.SELECTION_VIEW, 0);
  assert.equal(calls.some(call => call[0] === 'countries'), false);
  assert.equal(calls.some(call => call[0] === 'countryLabelPositions'), true);
});

test('scheduled view and full renders merge into one full frame', () => {
  const { calls, frames, coordinator } = fixture();
  assert.equal(coordinator.invalidate(MAP_RENDER_MASKS.VIEW, 'pan'), true);
  assert.equal(coordinator.invalidate(MAP_RENDER_MASKS.PROJECT, 'selection'), false);
  assert.equal(coordinator.invalidate(MAP_RENDER_MASKS.RESIZE, 'resize'), false);
  assert.equal(frames.length, 1);
  frames.shift()();
  assert.equal(coordinator.getStats().renderRevision, 1);
  assert.equal(calls.some(call => call[0] === 'hydro'), true);
  assert.equal(calls.some(call => call[0] === 'countryLabelPositions'), false);
  assert.deepEqual(coordinator.getStats().lastReasons, ['pan', 'selection', 'resize']);
});

test('interaction end coalesces settle work into the pending frame', () => {
  const { calls, frames, coordinator } = fixture();
  coordinator.beginInteraction();
  coordinator.invalidate(MAP_RENDER_MASKS.VIEW, 'drag');
  assert.equal(coordinator.endInteraction('settle'), true);
  assert.equal(frames.length, 1);
  frames.shift()();
  assert.equal(coordinator.getStats().viewRenderCount, 1);
  assert.equal(calls.filter(call => call[0] === 'labelLayout').length, 1);
  assert.equal(coordinator.getStats().fullRenderCount, 0);
});

test('GPU-only invalidation does not rebuild overlay data', () => {
  const { calls, frames, coordinator } = fixture();
  coordinator.invalidate(MAP_RENDER_DIRTY.GPU_FRAME, 'tile-ready');
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
  coordinator.invalidate(MAP_RENDER_MASKS.VIEW, 'drag-frame');
  frames.shift()();
  assert.equal(samples.length, 1);
  assert.equal(samples[0].interactionActive, true);
  assert.ok(samples[0].durationMs > 0);
});

test('invalid masks throw in strict mode without queuing or widening a frame', () => {
  const { coordinator, frames } = fixture();
  for (const input of [0, 'view', {}, Number.NaN, Number.POSITIVE_INFINITY, 1 << 29, 2 ** 32]) {
    assert.throws(
      () => coordinator.invalidate(input, 'invalid-test'),
      error => error instanceof RenderInvalidationError && error.code === 'PL-RENDER-MASK-001',
    );
  }
  assert.equal(frames.length, 0);
  assert.equal(coordinator.getStats().requestCount, 0);
  assert.equal(coordinator.getStats().invalidMaskCount, 7);

  coordinator.invalidate(MAP_RENDER_MASKS.VIEW, 'valid-view');
  assert.throws(() => coordinator.invalidate('full', 'invalid-after-valid'), /Invalid render invalidation mask/);
  assert.equal(frames.length, 1);
  frames.shift()();
  assert.equal(coordinator.getStats().lastRequestedMask, MAP_RENDER_MASKS.VIEW);
  assert.equal(coordinator.getStats().fullRenderCount, 0);
});

test('invalid masks are safely reported in production mode', () => {
  const frames = [];
  const errors = [];
  const coordinator = createMapRenderCoordinator({
    requestFrame: callback => frames.push(callback),
    prepareView: () => ({ revision: 1 }),
    renderers: {},
    invalidMaskMode: 'report',
    onInvalidMask: error => errors.push(error),
  });
  assert.equal(coordinator.invalidate('unknown', 'production-invalid'), false);
  assert.equal(frames.length, 0);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, 'PL-RENDER-MASK-001');
  assert.equal(coordinator.getStats().lastInvalidMask, 'unknown');
});

test('invalid mask mode is rejected at coordinator construction', () => {
  assert.throws(
    () => createMapRenderCoordinator({
      requestFrame: () => {},
      prepareView: () => null,
      renderers: {},
      invalidMaskMode: 'full-fallback',
    }),
    /Unknown invalid mask mode/,
  );
});

test('merged work bits never become a project frame without the project trigger', () => {
  const { frames, coordinator } = fixture();
  const triggerMask = MAP_RENDER_DIRTY.RESIZE | MAP_RENDER_DIRTY.PROJECTION | MAP_RENDER_DIRTY.PROJECT;
  const workMask = Object.values(MAP_RENDER_DIRTY)
    .reduce((mask, bit) => mask | (triggerMask & bit ? 0 : bit), 0);
  coordinator.invalidate(workMask, 'all-work-bits');
  frames.shift()();
  const stats = coordinator.getStats();
  assert.equal(stats.fullRenderCount, 0);
  assert.equal(stats.projectFrameCount, 0);
  assert.equal(stats.lastMode, 'partial');
  assert.equal(stats.recentFrames.at(-1).frameKind, 'partial');
});

test('resize and projection triggers reproject visible domains without becoming project frames', () => {
  for (const [mask, counter] of [
    [MAP_RENDER_MASKS.RESIZE, 'resizeFrameCount'],
    [MAP_RENDER_MASKS.PROJECTION, 'projectionFrameCount'],
  ]) {
    const { calls, frames, coordinator } = fixture();
    coordinator.invalidate(mask, counter);
    frames.shift()();
    const names = calls.map(call => call[0]);
    assert.equal(names.filter(name => name === 'countries').length, 1);
    assert.equal(names.includes('base'), true);
    assert.equal(names.includes('hydro'), true);
    assert.equal(names.includes('territorialUnits'), true);
    assert.equal(names.includes('distributions'), true);
    assert.equal(names.includes('genericFeatures'), true);
    assert.equal(names.includes('projectedOverlays'), true);
    assert.equal(names.includes('labelLayout'), true);
    assert.equal(names.includes('view'), false, 'scene draw must not be duplicated before the country renderer');
    assert.equal(coordinator.getStats()[counter], 1);
    assert.equal(coordinator.getStats().projectFrameCount, 0);
    assert.equal(coordinator.getStats().fullRenderCount, 0);
  }
});

test('selection-only frames do not draw the base scene or rebuild geometry', () => {
  const { calls, frames, coordinator } = fixture();
  coordinator.invalidate(MAP_RENDER_DIRTY.SELECTION_DATA | MAP_RENDER_DIRTY.GPU_INTERACTION, 'selection-only');
  frames.shift()();
  const names = calls.map(call => call[0]);
  assert.equal(names.filter(name => name === 'selectionData').length, 1);
  for (const forbidden of ['view', 'base', 'countries', 'hydro', 'territorialUnits', 'distributions', 'genericFeatures']) {
    assert.equal(names.includes(forbidden), false, `${forbidden} must not run in a selection-only frame`);
  }
});
