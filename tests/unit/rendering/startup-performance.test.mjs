import { describe as contractSuite } from 'node:test';
import * as __perf_dep0 from "node:assert/strict";


import * as __perf_dep3 from "node:test";


import * as __perf_dep6 from "../../../src/rendering/gpu-map-renderer.js";
import * as __perf_dep7 from "../../../src/app/startup-readiness.js";

import * as __perf_dep9 from "../../../src/rendering/adaptive-render-quality.js";

// Original feature contract: startup-performance.test.mjs
contractSuite("startup-performance", () => {
const assert = __perf_dep0.default;


const test = __perf_dep3.default;


const { resolveRenderPixelRatioValue, visibleFlatWorldOffsets } = __perf_dep6;
const { DATA_READINESS, READINESS_EVENTS, canMutateProject, resolveStartupLoadPolicy, transitionDataReadiness } = __perf_dep7;

test('mobile DPR is capped at two while desktop retains the existing cap', () => {
  assert.equal(resolveRenderPixelRatioValue(4, true), 2);
  assert.equal(resolveRenderPixelRatioValue(3, true), 2);
  assert.equal(resolveRenderPixelRatioValue(1.5, true), 1.5);
  assert.equal(resolveRenderPixelRatioValue(4, false), 3);
  assert.equal(resolveRenderPixelRatioValue(2.5, false), 2.5);
  assert.equal(resolveRenderPixelRatioValue(3, false, 1.25), 1.25);
});

test('flat world copies are limited to intervals intersecting the viewport', () => {
  assert.deepEqual(visibleFlatWorldOffsets({
    translateX: 500,
    scale: 500,
    flatCenterRadians: 0,
    viewportWidth: 1000,
  }), [0]);
  assert.deepEqual(visibleFlatWorldOffsets({
    translateX: 500,
    scale: 100,
    flatCenterRadians: 0,
    viewportWidth: 1000,
  }), [-2 * Math.PI, 0, 2 * Math.PI]);
  assert.deepEqual(visibleFlatWorldOffsets({
    translateX: 500,
    scale: 1000 / (2 * Math.PI),
    flatCenterRadians: 0,
    viewportWidth: 1000,
  }), [0]);
  assert.deepEqual(visibleFlatWorldOffsets({
    translateX: -6000,
    scale: 500,
    flatCenterRadians: 0,
    viewportWidth: 1000,
  }), [2 * Math.PI]);
  assert.deepEqual(visibleFlatWorldOffsets({ scale: 0, viewportWidth: 1000 }), [0]);
});

test('readiness transitions enable mutations at geometry-ready and preserve them through enhancement', () => {
  const restoring = transitionDataReadiness('', READINESS_EVENTS.RESTORE_STARTED);
  assert.equal(restoring, DATA_READINESS.RESTORING);
  assert.equal(canMutateProject(restoring), false);
  assert.equal(transitionDataReadiness(restoring, READINESS_EVENTS.GEOMETRY_READY), DATA_READINESS.EDITABLE);
  let readiness = transitionDataReadiness('', READINESS_EVENTS.PREVIEW_READY);
  assert.equal(readiness, DATA_READINESS.PREVIEW);
  assert.equal(canMutateProject(readiness), false);
  readiness = transitionDataReadiness(readiness, READINESS_EVENTS.GEOMETRY_ERROR);
  assert.equal(readiness, DATA_READINESS.ERROR);
  assert.equal(canMutateProject(readiness), false);
  readiness = transitionDataReadiness(readiness, READINESS_EVENTS.RETRY_GEOMETRY);
  assert.equal(readiness, DATA_READINESS.PREVIEW);
  readiness = transitionDataReadiness(readiness, READINESS_EVENTS.GEOMETRY_READY);
  assert.equal(readiness, DATA_READINESS.EDITABLE);
  assert.equal(canMutateProject(readiness), true);
  readiness = transitionDataReadiness(readiness, READINESS_EVENTS.MESH_READY);
  assert.equal(readiness, DATA_READINESS.ENHANCED);
  assert.equal(canMutateProject(readiness), true);
});

test('startup load policy is sequential on every device while preserving diagnostic signals', () => {
  assert.equal(resolveStartupLoadPolicy({ layout: 'mobile', deviceMemory: 8, hardwareConcurrency: 8, effectiveType: '4g' }).mode, 'sequential');
  assert.equal(resolveStartupLoadPolicy({ layout: 'wide', deviceMemory: 4, hardwareConcurrency: 12, effectiveType: '4g' }).mode, 'sequential');
  assert.equal(resolveStartupLoadPolicy({ layout: 'wide', deviceMemory: 16, hardwareConcurrency: 16, effectiveType: '3g' }).mode, 'sequential');
  assert.equal(resolveStartupLoadPolicy({ layout: 'wide', deviceMemory: 16, hardwareConcurrency: 16, effectiveType: '4g', saveData: true }).mode, 'sequential');
  assert.equal(resolveStartupLoadPolicy({ layout: 'mobile', hardwareConcurrency: 8, effectiveType: '4g' }).mode, 'sequential');
  assert.equal(resolveStartupLoadPolicy({ layout: 'wide', hardwareConcurrency: 8, effectiveType: '4g' }).mode, 'sequential');
  assert.equal(resolveStartupLoadPolicy({ layout: 'wide', deviceMemory: 32, hardwareConcurrency: 32, effectiveType: '4g' }).reason, 'interaction-first-v1');
});

});

// Original feature contract: adaptive-render-quality.test.mjs
contractSuite("adaptive-render-quality", () => {
const assert = __perf_dep0.default;
const test = __perf_dep3.default;
const { createAdaptiveRenderQualityController, renderQualityProfile, resolveInitialRenderQuality } = __perf_dep9;


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

test('mobile sharpness uses DPR two at normal tiers while preserving a low-memory tier', () => {
  assert.equal(renderQualityProfile('medium', { mobile: true }).dprCap, 2);
  assert.equal(renderQualityProfile('high', { mobile: true }).dprCap, 2);
  assert.equal(renderQualityProfile('coarse', { mobile: true }).dprCap, 1.5);
  assert.equal(renderQualityProfile('medium', { mobile: false }).dprCap, 1.75);
  assert.equal(renderQualityProfile('coarse', { mobile: false }).dprCap, 1.25);
});
});

// Original feature contract: label-shell-performance.test.mjs
