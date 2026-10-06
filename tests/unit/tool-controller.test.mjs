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
    const state = { territorySelectionSession: { tool, kind, stage: 'setup', activePhase: null, activeMethod: null } };
    assert.equal(toolDraftDefinition(tool, state), null);
    state.territorySelectionSession.stage = 'selection';
    state.territorySelectionSession.activePhase = 'drawing';
    state.territorySelectionSession.activeMethod = 'line';
    assert.deepEqual(toolDraftDefinition(tool, state), { shape: 'line', profile: 'boundary' });
    state.territorySelectionSession.activeMethod = 'polygon';
    assert.deepEqual(toolDraftDefinition(tool, state), { shape: 'polygon', profile: 'area' });
    state.territorySelectionSession.activePhase = 'components';
    assert.equal(toolDraftDefinition(tool, state), null);
    state.territorySelectionSession.stage = 'review';
    assert.equal(toolDraftDefinition(tool, state), null);
  }
});

for (const tool of ['river', 'lake']) test(`${tool} pauses draft input for a completed hydro part and resumes for the next part`, () => {
  const definition = toolDraftDefinition(tool);
  const state = { multiDraft: { kind: 'hydro', parts: [], current: null } };
  assert.deepEqual(toolDraftDefinition(tool, state), definition);
  state.multiDraft.current = { geometry: tool === 'river'
    ? { type: 'LineString', coordinates: [[0, 0], [1, 1]] }
    : { type: 'Polygon', coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]] } };
  assert.equal(toolDraftDefinition(tool, state), null);
  state.multiDraft.parts.push(state.multiDraft.current);
  state.multiDraft.current = null;
  assert.deepEqual(toolDraftDefinition(tool, state), definition);
  state.multiDraft.current = { geometry: state.multiDraft.parts[0].geometry };
  assert.equal(toolDraftDefinition(tool, state), null);
  state.multiDraft.current = null;
  assert.deepEqual(toolDraftDefinition(tool, state), definition);
});
