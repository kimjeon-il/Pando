import { expect, test } from '@playwright/test';

test('single WebGL context draws a country selection from the shared stroke resource', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = [];
  const warnings = [];
  page.on('pageerror', error => {
    errors.push(error.message);
    console.log(`PAGE_ERROR ${error.stack || error.message}`);
  });
  page.on('console', message => {
    if (message.type() === 'error' && !message.text().includes('[PL-WATER-001]')) {
      errors.push(message.text());
      console.log(`CONSOLE_ERROR ${message.text()}`);
    }
    if (message.type() === 'warning' && message.text().includes('gpu-stroke')) {
      warnings.push(message.text());
      console.log(`GPU_STROKE_WARNING ${message.text()}`);
    }
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?perf=1');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__?.snapshot().gpu.canonicalMeshReady), { timeout: 60_000 }).toBe(true);
  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('country', 'RUS'));
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpuSelection.drawCoverage?.primary?.renderedKeys || []), { timeout: 30_000 }).toContain('country:RUS');
  const snapshot = await page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot());
  expect(snapshot.gpu.activeWebGlContextCount).toBe(1);
  expect(snapshot.gpu.stroke.gpuHealth).toBe('healthy');
  expect(snapshot.gpu.stroke.selfTestPassed).toBe(true);
  expect(snapshot.gpuSelection.bufferBuildCount).toBe(0);
  expect(snapshot.selection.svgFallbackKeys || []).toEqual([]);
  expect(await page.locator('.gpu-selection-canvas').count()).toBe(0);
  await expect(page.locator('body')).toHaveAttribute('data-map-host', 'legacy');
  expect(await page.locator('#map .gpu-map-canvas').count()).toBe(1);
  expect(warnings).toEqual([]);
  expect(errors).toEqual([]);
});
