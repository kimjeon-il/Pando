import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createSelectionPerformanceBaseline,
  decideSelectionRedrawStrategy,
} from '../../assets/js/modules/selection-performance-baseline.js';

test('selection baseline ignores two warmups and locks after twenty samples', () => {
  const baseline = createSelectionPerformanceBaseline();
  for (let index = 0; index < 22; index += 1) {
    baseline.record({ inputToPresentMs: 10, baselineInputToPresentMs: 10, mainGpuFrameMs: 5 });
  }
  const snapshot = baseline.snapshot();
  assert.equal(snapshot.observedCount, 22);
  assert.equal(snapshot.collectedCount, 20);
  assert.equal(snapshot.complete, true);
  assert.equal(snapshot.strategy.strategy, 'FULL_REDRAW');
});

test('selection baseline chooses scene color cache when redraw budget is exceeded', () => {
  const decision = decideSelectionRedrawStrategy(Array.from({ length: 20 }, () => ({
    inputToPresentMs: 24,
    baselineInputToPresentMs: 20,
    mainGpuFrameMs: 18,
    longTaskCount: 0,
    worldMeshUploadCount: 0,
    hydroUploadBytes: 0,
  })));
  assert.equal(decision.strategy, 'SCENE_COLOR_CACHE');
  assert.ok(decision.reasons.includes('main-gpu-p95>12ms'));
  assert.ok(decision.reasons.includes('selection-input-regression>10%'));
});
