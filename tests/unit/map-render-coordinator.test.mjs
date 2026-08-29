import assert from 'node:assert/strict';
import test from 'node:test';

import { createMapRenderCoordinator } from '../../assets/js/modules/map-render-coordinator.js';

function fixture() {
  const calls = [];
  const frames = [];
  const names = [
    'base', 'countries', 'hydroSelectionPosition', 'hydro', 'hydroEdits', 'boundaryEdit',
    'territorialUnits', 'distributions', 'drawings', 'stackOverlays', 'geometryPreview',
    'hover', 'selection', 'validation', 'countryLabelPositions', 'userLabelPositions',
    'countryLabels', 'userLabels', 'vertices', 'draft', 'snapIndicator', 'debug', 'layerTree',
  ];
  const renderers = Object.fromEntries(names.map(name => [name, (...args) => calls.push([name, ...args])]));
  const coordinator = createMapRenderCoordinator({
    requestFrame: callback => frames.push(callback),
    prepareView: () => { calls.push(['prepare']); return 7; },
    renderers,
  });
  return { calls, frames, coordinator };
}

test('full render preserves canonical layer order and revision', () => {
  const { calls, coordinator } = fixture();
  assert.deepEqual(coordinator.renderFull(), { renderRevision: 1, viewRevision: 7, viewOnly: false });
  assert.deepEqual(calls.map(call => call[0]), [
    'prepare', 'base', 'countries', 'hydro', 'hydroEdits', 'boundaryEdit', 'territorialUnits',
    'distributions', 'drawings', 'stackOverlays', 'geometryPreview', 'hover', 'selection',
    'validation', 'countryLabels', 'userLabels', 'vertices', 'draft', 'snapIndicator', 'debug', 'layerTree',
  ]);
  assert.deepEqual(calls.find(call => call[0] === 'countries'), ['countries', 7]);
});

test('view render uses lightweight hydro and label paths', () => {
  const { calls, coordinator } = fixture();
  coordinator.renderView();
  assert.equal(calls.some(call => call[0] === 'hydro'), false);
  assert.equal(calls.some(call => call[0] === 'layerTree'), false);
  assert.equal(calls.some(call => call[0] === 'hydroSelectionPosition'), true);
  assert.equal(calls.some(call => call[0] === 'countryLabelPositions'), true);
});

test('scheduled renders coalesce independently and preserve manual revisions', () => {
  const { frames, coordinator } = fixture();
  assert.equal(coordinator.scheduleFull(), true);
  assert.equal(coordinator.scheduleFull(), false);
  assert.equal(coordinator.scheduleView(), true);
  assert.equal(frames.length, 2);
  frames.shift()();
  frames.shift()();
  assert.equal(coordinator.revision(), 2);
  assert.equal(coordinator.advanceRevision(), 3);
});
