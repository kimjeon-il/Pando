import assert from 'node:assert/strict';
import test from 'node:test';

import { createMapRenderCoordinator } from '../../assets/js/modules/map-render-coordinator.js';

function fixture() {
  const calls = [];
  const frames = [];
  const viewState = Object.freeze({ revision: 7, projection: 'globe' });
  const names = [
    'base', 'countries', 'hydro', 'hydroEdits', 'boundaryEdit',
    'territorialUnits', 'distributions', 'drawings', 'stackOverlays', 'projectedOverlays', 'geometryPreview',
    'hover', 'selection', 'validation', 'countryLabelPositions', 'userLabelPositions',
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
    'prepare', 'base', 'countries', 'hydro', 'hydroEdits', 'territorialUnits',
    'distributions', 'drawings', 'stackOverlays', 'geometryPreview', 'hover', 'selection',
    'validation', 'boundaryEdit', 'vertices', 'draft', 'snapIndicator', 'labelLayout', 'countryLabels', 'userLabels', 'layerTree', 'debug',
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
  assert.equal(calls.some(call => call[0] === 'projectedOverlays'), true);
  assert.equal(calls.some(call => call[0] === 'layerTree'), false);
  assert.equal(calls.some(call => call[0] === 'selection'), true);
  assert.equal(calls.some(call => call[0] === 'countries'), true);
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
