import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createAdaptiveRenderQualityController,
  renderQualityProfile,
  resolveInitialRenderQuality,
} from '../../assets/js/modules/adaptive-render-quality.js';

test('device hints choose a conservative initial quality without relying on user agent strings', () => {
  assert.equal(resolveInitialRenderQuality({ deviceMemory: 2, hardwareConcurrency: 8 }), 'coarse');
  assert.equal(resolveInitialRenderQuality({ mobile: true, deviceMemory: 8, hardwareConcurrency: 8 }), 'medium');
  assert.equal(resolveInitialRenderQuality({ deviceMemory: 16, hardwareConcurrency: 12 }), 'high');
});

test('interaction quality keeps canonical geometry while lowering only work budgets', () => {
  const profile = renderQualityProfile('high', { phase: 'interaction' });
  assert.equal(profile.countryMeshQuality, 'canonical');
  assert.equal(profile.terrainResolutionScale, 1);
  assert.equal(profile.backgroundLod, 'high');
  assert.equal(profile.activeEditLod, 'high');
  assert.equal(profile.selectedLod, 'high');
  assert.ok(profile.uploadBudgetBytes < profile.settleUploadBudgetBytes);
});

test('measured expensive frames downgrade the runtime tier with hysteresis', () => {
  let clock = 10_000;
  const controller = createAdaptiveRenderQualityController({
    deviceMemory: 16,
    hardwareConcurrency: 12,
    evaluationWindow: 4,
    degradeWindows: 1,
    changeCooldownMs: 0,
    now: () => ++clock,
  });
  assert.equal(controller.profile().tier, 'high');
  for (let index = 0; index < 4; index += 1) controller.recordFrame(60);
  assert.equal(controller.profile().tier, 'medium');
  assert.equal(controller.stats().qualityChangeCount, 1);
});

test('phase changes are explicit and revisioned', () => {
  const controller = createAdaptiveRenderQualityController({ deviceMemory: 8, hardwareConcurrency: 8 });
  const initial = controller.profile().revision;
  assert.equal(controller.beginInteraction(), true);
  assert.equal(controller.profile().phase, 'interaction');
  assert.ok(controller.profile().revision > initial);
  assert.equal(controller.endInteraction(), true);
  assert.equal(controller.profile().phase, 'settle');
});
