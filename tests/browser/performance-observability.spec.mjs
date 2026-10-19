import { gotoEditor } from './helpers/editor-entry.mjs';
import { expect, test } from '@playwright/test';

test('publishes a bounded runtime performance report after the app becomes interactive', async ({ page }, testInfo) => {
  test.setTimeout(85_000);
  const consoleErrors = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await page.setViewportSize({ width: 1366, height: 768 });
  await gotoEditor(page, '/?debug');
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 60_000 });

  await expect.poll(() => page.evaluate(() => typeof window.__PANDOLAB_PERFORMANCE_REPORT__), {
    timeout: 10_000,
  }).toBe('function');
  // Bootstrap overlay disappearance does not imply an interactive map.
  // Record stage telemetry if the app never reaches the Core-backed interactive state.
  // Do not turn an absent interactive marker into a fabricated zero measurement.
  try {
    await expect.poll(() => page.evaluate(() => {
      const report = window.__PANDOLAB_PERFORMANCE_REPORT__?.();
      return Number.isFinite(report?.startup?.interactiveMs) && report.startup.interactiveMs >= 0;
    }), { timeout: 95_000, intervals: [250, 750, 1500] }).toBe(true);
  } catch (error) {
    const details = await page.evaluate(() => ({
      appReadiness: document.querySelector('#app')?.dataset.readiness ?? null,
      overlayHidden: document.querySelector('#bootstrapLoading')?.hasAttribute('hidden') ?? null,
      bootstrap: window.__PANDOLAB_STARTUP_METRICS__ ?? null,
      report: window.__PANDOLAB_PERFORMANCE_REPORT__?.() ?? null,
      mapStatus: document.querySelector('[role="status"]')?.textContent?.slice(0, 400) ?? null,
    }));
    const diagnostics = { details, consoleErrors };
    await testInfo.attach('p3-interactive-stage-diagnostic.json', {
      body: Buffer.from(JSON.stringify(diagnostics, null, 2)), contentType: 'application/json',
    });
    console.error('P3_INTERACTIVE_STAGE:', JSON.stringify(diagnostics).slice(0, 5000));
    throw error;
  }

  const report = await page.evaluate(() => window.__PANDOLAB_PERFORMANCE_REPORT__());
  expect(report.version).toBe(1);
  expect(report.startup).toBeTruthy();
  expect(report.startup.interactiveMs).toBeGreaterThanOrEqual(0);
  expect(report.longTasks.firstLoadWindowMs).toBe(5_000);
  expect(Array.isArray(report.longTasks.samples)).toBe(true);
  expect(report.longTasks.samples.length).toBeLessThanOrEqual(120);
  expect(report.operations).toBeTruthy();
  expect(Array.isArray(report.memory)).toBe(true);

  const thresholds = await page.evaluate(() => window.__PANDOLAB_PERFORMANCE_THRESHOLDS__);
  expect(thresholds.longTaskMs).toBe(50);
  expect(thresholds.commitToPaintMs).toBe(100);
});

test('1989 Soviet Union pan keeps WebGL geometry and upload resources stable', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const failures = [];
  page.on('pageerror', error => failures.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoEditor(page, '/?perf=1&renderer=webgl2');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__?.snapshot().gpu.renderer),
    { timeout: 30_000 }).toBe('webgl2');

  await page.locator('#timelineMonthButton').click();
  await page.locator('#timelineMonthInput').fill('1989-06');
  await page.locator('#timelineMonthInput').press('Enter');
  await expect(page.locator('#timelineMonthInput')).toBeHidden({ timeout: 90_000 });
  await expect.poll(() => page.evaluate(() => {
    const country = window.PANDOLAB_TERRITORIAL?.get('state:soviet-union');
    return country?.geometry?.coordinates?.length || 0;
  }), { timeout: 60_000 }).toBeGreaterThan(0);
  await page.locator('#flatBtn').evaluate(button => button.click());

  // Include the demanding selected outline, then warm all deliberate startup
  // and selection uploads before sampling ordinary camera-only gestures.
  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('state:soviet-union'));
  await page.locator('#focusSelectedObjectBtn').evaluate(button => button.click());
  await expect.poll(() => page.evaluate(() => {
    const { gpu } = window.__PANDOLAB_RENDER_DEBUG__.snapshot();
    return gpu.renderer === 'webgl2' && gpu.canonicalMeshReady === true
      && !gpu.countrySharedBoundaryReplacementPending && gpu.patchWorkerJobs?.queueDepth === 0;
  }), { timeout: 90_000 }).toBe(true);

  const pan = async (distanceX, distanceY) => {
    const rect = await page.locator('#map .map-svg').boundingBox();
    const x = rect.x + rect.width * 0.55, y = rect.y + rect.height * 0.55;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + distanceX, y + distanceY, { steps: 8 });
    await page.mouse.up();
  };
  // Historical outline is a separately uploaded GPU stroke. Complete its
  // one-time creation before the camera-only reuse interval is sampled.
  await expect.poll(() => page.evaluate(() => {
    const snapshot = window.__PANDOLAB_RENDER_DEBUG__.snapshot();
    return snapshot.gpu.selection?.segmentCount > 0
      && snapshot.gpu.selection?.channels?.primary?.drawSucceeded === true
      && snapshot.selection.fallbackCount === 0;
  }), { timeout: 90_000, intervals: [350, 900, 1500] }).toBe(true);
  await pan(24, 9);
  await page.waitForTimeout(900);

  const measurement = () => page.evaluate(() => {
    const snapshot = window.__PANDOLAB_RENDER_DEBUG__.snapshot();
    const { gpu, renderScene } = snapshot;
    return {
      renderer: gpu.renderer, contextCount: gpu.activeWebGlContextCount,
      viewRenderCount: snapshot.viewRenderCount,
      meshSwitchCount: gpu.meshSwitchCount,
      countryPatchUploadBytes: gpu.countryPatchUploadBytes,
      countryBoundaryRequestId: gpu.countrySharedBoundaryRequestId,
      paletteUploadCount: gpu.paletteUploadCount,
      polygonCacheMisses: renderScene.polygonCacheMisses,
      strokeCacheMisses: renderScene.strokeCacheMisses,
      triangulationMs: renderScene.triangulationMs,
      polygonGpuBuildCount: gpu.polygonOverlay.buildCount,
      polygonGpuUploadBytes: gpu.polygonOverlay.uploadBytes,
      strokeGpuBuildCount: gpu.stroke.buildCount,
      strokeGpuUploadBytes: gpu.stroke.uploadBytes,
      meshVariantBytes: gpu.meshVariantBytes,
      lastReasons: snapshot.lastReasons,
    };
  });
  const before = await measurement();
  for (const [dx, dy] of [[30, 12], [-28, -8], [22, 10]]) await pan(dx, dy);
  await page.waitForTimeout(600);
  const after = await measurement();
  const evidence = { sourceMonth: '1989-06', sourceEntity: 'state:soviet-union', before, after, failures };
  await testInfo.attach('soviet-pan-gpu-reuse.json', {
    body: Buffer.from(JSON.stringify(evidence, null, 2)), contentType: 'application/json',
  });
  console.log('SOVIET_1989_PAN_GPU_REUSE', JSON.stringify(evidence));
  expect(after.renderer).toBe('webgl2');
  expect(after.contextCount).toBe(1);
  expect(after.viewRenderCount).toBeGreaterThan(before.viewRenderCount);
  for (const key of [
    'meshSwitchCount', 'countryPatchUploadBytes', 'countryBoundaryRequestId',
    'paletteUploadCount', 'polygonCacheMisses', 'strokeCacheMisses', 'triangulationMs',
    'polygonGpuBuildCount', 'polygonGpuUploadBytes', 'strokeGpuBuildCount', 'strokeGpuUploadBytes',
  ]) expect(after[key], 'ordinary pan unexpectedly changed ' + key).toBe(before[key]);
  expect(failures).toEqual([]);
});
