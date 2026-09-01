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
  assert.deepEqual(toolDraftDefinition('draw-territorial-unit'), { shape: 'polygon', profile: 'area' });
  assert.deepEqual(toolDraftDefinition('redraw-territorial-unit'), { shape: 'polygon', profile: 'area' });
});

test('phased territorial tools expose draft input only during their line phase', () => {
  assert.equal(toolDraftDefinition('new-country', { newCountryPhase: 'sources' }), null);
  assert.deepEqual(toolDraftDefinition('new-country', { newCountryPhase: 'line' }), { shape: 'line', profile: 'boundary' });
  assert.equal(toolDraftDefinition('annex-territory', { annexPhase: 'donor' }), null);
  assert.deepEqual(toolDraftDefinition('annex-territory', { annexPhase: 'line' }), { shape: 'line', profile: 'boundary' });
});
