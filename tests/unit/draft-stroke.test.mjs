import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appendDraftStrokeSamples,
  beginDraftStroke,
  cancelDraftStroke,
  createDraftStrokeState,
  draftStrokeProfile,
  finalizeDraftStroke,
  simplifyDraftStrokeSamples,
} from '../../assets/js/modules/draft-stroke.js';

const sample = (x, y, lon = x, lat = y) => ({ screen: [x, y], coordinate: [lon, lat] });

test('draft stroke profiles use fine and coarse CSS-pixel thresholds', () => {
  assert.deepEqual(draftStrokeProfile('boundary', 'mouse'), {
    profile: 'boundary', pointerGroup: 'fine', sampleDistance: 4, simplifyTolerance: 2.5,
  });
  assert.deepEqual(draftStrokeProfile('river', 'touch'), {
    profile: 'river', pointerGroup: 'coarse', sampleDistance: 8, simplifyTolerance: 3,
  });
});

test('stroke sampling ignores short moves and keeps deterministic shape points', () => {
  const state = createDraftStrokeState();
  assert.equal(beginDraftStroke(state, { pointerId: 1, pointerType: 'mouse', profile: 'river', sample: sample(0, 0) }), true);
  assert.equal(appendDraftStrokeSamples(state, [sample(2, 0), sample(4, 0), sample(8, 2), sample(12, 2)]), 3);
  assert.deepEqual(state.samples.map(item => item.screen), [[0, 0], [4, 0], [8, 2], [12, 2]]);
  const result = finalizeDraftStroke(state);
  assert.deepEqual(result.coords[0], [0, 0]);
  assert.deepEqual(result.coords.at(-1), [12, 2]);
  assert.equal(result.rawSampleCount, 4);
  assert.equal(state.active, false);
});

test('RDP simplification preserves endpoints and meaningful turns', () => {
  const simplified = simplifyDraftStrokeSamples([
    sample(0, 0), sample(4, 0.2), sample(8, 0), sample(10, 8), sample(12, 8.1), sample(18, 8),
  ], 1);
  assert.deepEqual(simplified.map(item => item.screen), [[0, 0], [8, 0], [10, 8], [18, 8]]);
});

test('polygon ending near its start removes the duplicate closing sample', () => {
  const state = createDraftStrokeState();
  beginDraftStroke(state, { pointerId: 2, pointerType: 'mouse', profile: 'area', sample: sample(0, 0) });
  appendDraftStrokeSamples(state, [sample(40, 0), sample(40, 40), sample(0, 40), sample(6, 4)]);
  const result = finalizeDraftStroke(state, { shape: 'polygon' });
  assert.equal(result.autoClosed, true);
  assert.deepEqual(result.coords[0], [0, 0]);
  assert.notDeepEqual(result.coords.at(-1), [6, 4]);
  assert.ok(result.coords.length >= 3);
});

test('polygon ending away from its start keeps an implicit straight closure', () => {
  const state = createDraftStrokeState();
  beginDraftStroke(state, { pointerId: 3, pointerType: 'touch', profile: 'area', sample: sample(0, 0) });
  appendDraftStrokeSamples(state, [sample(32, 0), sample(32, 32), sample(0, 32)]);
  const result = finalizeDraftStroke(state, { shape: 'polygon' });
  assert.equal(result.autoClosed, false);
  assert.deepEqual(result.coords.at(-1), [0, 32]);
  assert.equal(result.closureDistance, 32);
});

test('cancelling an active stroke discards only its raw samples', () => {
  const state = createDraftStrokeState();
  beginDraftStroke(state, { pointerId: 4, pointerType: 'pen', profile: 'boundary', sample: sample(1, 1) });
  appendDraftStrokeSamples(state, [sample(8, 8)]);
  assert.equal(cancelDraftStroke(state), 2);
  assert.equal(state.active, false);
  assert.deepEqual(state.samples, []);
  assert.equal(finalizeDraftStroke(state), null);
});
