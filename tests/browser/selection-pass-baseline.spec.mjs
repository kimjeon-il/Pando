import { expect, test } from '@playwright/test';

import { decideSelectionRedrawStrategy } from '../../assets/js/modules/selection-performance-baseline.js';

const nextPresentedFrame = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

test('single-context SelectionPass reuses scene and stroke buffers during selection and view changes', async ({ page }) => {
  test.setTimeout(300_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'warning' && message.text().includes('gpu-stroke')) console.log(`GPU_STROKE_WARNING ${message.text()}`);
    if (message.type() === 'error' && !message.text().includes('[PL-WATER-001]')) errors.push(message.text());
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?perf=1');
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__?.snapshot().gpu.canonicalMeshReady), { timeout: 60_000 }).toBe(true);
  await page.evaluate(() => {
    window.__PANDOLAB_TEST_LONG_TASK_COUNT__ = 0;
    try {
      const observer = new globalThis.PerformanceObserver(list => {
        window.__PANDOLAB_TEST_LONG_TASK_COUNT__ += list.getEntries().filter(entry => entry.duration >= 50).length;
      });
      observer.observe({ type: 'longtask', buffered: true });
      window.__PANDOLAB_TEST_LONG_TASK_OBSERVER__ = observer;
    } catch {
      window.__PANDOLAB_TEST_LONG_TASK_COUNT__ = 0;
    }
  });

  const layerOrder = await page.evaluate(() => Object.fromEntries([
    ['base', '.map-base-svg'],
    ['main', '.gpu-map-canvas'],
    ['projected', '.map-overlay-svg'],
    ['interaction', '.map-interaction-svg'],
  ].map(([key, selector]) => [key, Number(getComputedStyle(document.querySelector(selector)).zIndex)])));
  expect(layerOrder).toEqual({ base: 0, main: 1, projected: 2, interaction: 4 });
  await expect(page.locator('body')).toHaveAttribute('data-map-host', 'legacy');
  expect(await page.locator('#map .gpu-map-canvas').count()).toBe(1);
  expect(await page.locator('#map .gpu-selection-canvas').count()).toBe(0);
  expect(await page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpu.activeWebGlContextCount)).toBe(1);

  const ids = ['RUS', 'DEU', 'FRA', 'POL'];
  const samples = await page.evaluate(async countryIds => {
    const rows = [];
    const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    for (let index = 0; index < 22; index += 1) {
      const before = window.__PANDOLAB_RENDER_DEBUG__.snapshot();
      const longTasksBefore = Number(window.__PANDOLAB_TEST_LONG_TASK_COUNT__ || 0);
      const startedAt = performance.now();
      window.PANDOLAB_TERRITORIAL.select('country', countryIds[index % countryIds.length]);
      const handlerMs = performance.now() - startedAt;
      await nextFrame();
      const elapsed = performance.now() - startedAt;
      const after = window.__PANDOLAB_RENDER_DEBUG__.snapshot();
      if (index >= 2) rows.push({
        inputToPresentMs: elapsed,
        baselineInputToPresentMs: elapsed,
        handlerMs,
        mainGpuFrameMs: Number(after.gpu.p95CpuSubmitMs || 0),
        selectionGpuDrawMs: Number(after.gpuSelection.lastDrawMs || 0),
        longTaskCount: Math.max(0, Number(window.__PANDOLAB_TEST_LONG_TASK_COUNT__ || 0) - longTasksBefore),
        worldMeshUploadCount: 0,
        hydroUploadBytes: Math.max(0, Number(after.gpu.hydroUploadBytes || 0) - Number(before.gpu.hydroUploadBytes || 0)),
        selectionBufferRebuilds: Math.max(0, Number(after.gpuSelection.bufferBuildCount || 0) - Number(before.gpuSelection.bufferBuildCount || 0)),
        selectionUploadBytes: Math.max(0, Number(after.gpuSelection.bufferUploadBytes || 0) - Number(before.gpuSelection.bufferUploadBytes || 0)),
        selectionDrawCount: Math.max(0, Number(after.gpuSelection.viewDrawCount || 0) - Number(before.gpuSelection.viewDrawCount || 0)),
        selectionOnlyBaseDraws: Math.max(0, Number(after.gpu.selectionOnlyBaseDrawCount || 0) - Number(before.gpu.selectionOnlyBaseDrawCount || 0)),
        mainDrawCount: Math.max(0,
          Number(after.fullRenderCount || 0) + Number(after.viewRenderCount || 0)
          - Number(before.fullRenderCount || 0) - Number(before.viewRenderCount || 0)),
        svgFallbackCount: Number(after.selection.fallbackCount || 0),
      });
    }
    return rows;
  }, ids);
  expect(samples).toHaveLength(20);

  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('country', 'RUS'));
  await nextPresentedFrame(page);
  const beforePan = await page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpuSelection);
  await page.mouse.move(720, 450);
  await page.mouse.wheel(0, -180);
  await page.waitForTimeout(300);
  const afterPan = await page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpuSelection);
  const activeCanvasCount = await page.evaluate(() => document.querySelectorAll('#map canvas').length);
  const finalDebug = await page.evaluate(() => {
    const snapshot = window.__PANDOLAB_RENDER_DEBUG__.snapshot();
    return {
      gpuInteractionIndices: {
        drawn: snapshot.gpu.countryInteractionIndexCount,
        full: snapshot.gpu.countryInteractionFullIndexCount,
        ranges: snapshot.gpu.countryInteractionRangeCount,
      },
      gpuSelection: snapshot.gpuSelection,
      gpuStroke: snapshot.gpu.stroke,
      gpuLastSelection: snapshot.gpu.lastSelectionRenderResult,
      selection: snapshot.selection,
    };
  });
  expect(afterPan.bufferBuildCount).toBe(beforePan.bufferBuildCount);
  expect(afterPan.viewDrawCount).toBeGreaterThan(beforePan.viewDrawCount);

  const decision = decideSelectionRedrawStrategy(samples);
  const totals = samples.reduce((result, sample) => ({
    selectionBufferRebuilds: result.selectionBufferRebuilds + sample.selectionBufferRebuilds,
    selectionUploadBytes: result.selectionUploadBytes + sample.selectionUploadBytes,
    selectionDrawCount: result.selectionDrawCount + sample.selectionDrawCount,
    mainDrawCount: result.mainDrawCount + sample.mainDrawCount,
    selectionOnlyBaseDraws: result.selectionOnlyBaseDraws + sample.selectionOnlyBaseDraws,
    svgFallbackCount: result.svgFallbackCount + sample.svgFallbackCount,
  }), { selectionBufferRebuilds: 0, selectionUploadBytes: 0, selectionDrawCount: 0, mainDrawCount: 0, selectionOnlyBaseDraws: 0, svgFallbackCount: 0 });
  console.log(`SELECTION_PASS_BASELINE ${JSON.stringify({
    layerOrder,
    sampleCount: samples.length,
    strategy: decision,
    totals,
    selectionBufferBuildCount: afterPan.bufferBuildCount,
    selectionViewDrawDelta: afterPan.viewDrawCount - beforePan.viewDrawCount,
    activeCanvasCount,
    finalDebug,
    selectionInput: await page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().selectionInput),
  })}`);
  expect(decision.strategy).toBe('SCENE_COLOR_CACHE');
  expect(activeCanvasCount).toBe(1);
  expect(finalDebug.gpuInteractionIndices.drawn).toBe(0);
  expect(totals.selectionOnlyBaseDraws).toBe(0);
  expect(totals.svgFallbackCount).toBe(0);
  expect(errors).toEqual([]);
});
