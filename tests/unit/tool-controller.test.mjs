import assert from 'node:assert/strict';
import test from 'node:test';

import { toolDraftDefinition } from '../../assets/js/modules/tool-controller.js';

test('draft tools derive line and polygon behavior from one definition table', () => {
  assert.deepEqual(toolDraftDefinition('river'), { shape: 'line', profile: 'river' });
  assert.deepEqual(toolDraftDefinition('line'), { shape: 'line', profile: 'river' });
  assert.deepEqual(toolDraftDefinition('split-generic-feature'), { shape: 'line', profile: 'boundary' });
  assert.deepEqual(toolDraftDefinition('split-territorial-unit'), { shape: 'line', profile: 'boundary' });
  assert.deepEqual(toolDraftDefinition('lake'), { shape: 'polygon', profile: 'area' });
  assert.deepEqual(toolDraftDefinition('polygon'), { shape: 'polygon', profile: 'area' });
  assert.deepEqual(toolDraftDefinition('redraw-territorial-unit'), { shape: 'polygon', profile: 'area' });
});

test('every territorial workflow exposes draft input from the shared session only', () => {
  for (const [tool, kind] of [
    ['annex-territory', 'annex'],
    ['new-country', 'new-country'],
    ['draw-territorial-unit', 'subunit'],
    ['draw-territorial-unit', 'region'],
  ]) {
    const state = { territorySelectionSession: { tool, kind, stage: 'method', selectionPhase: null } };
    assert.equal(toolDraftDefinition(tool, state), null);
    state.territorySelectionSession.stage = 'selection';
    state.territorySelectionSession.selectionPhase = 'line';
    assert.deepEqual(toolDraftDefinition(tool, state), { shape: 'line', profile: 'boundary' });
    state.territorySelectionSession.selectionPhase = 'polygon';
    assert.deepEqual(toolDraftDefinition(tool, state), { shape: 'polygon', profile: 'area' });
    state.territorySelectionSession.selectionPhase = 'components';
    assert.equal(toolDraftDefinition(tool, state), null);
  }
});
