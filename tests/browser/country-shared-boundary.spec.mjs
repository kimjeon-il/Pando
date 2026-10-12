import { expect, test } from '@playwright/test';

for (const renderer of ['webgl2', 'canvas']) {
  test(`physical terrain prepares shared country borders in ${renderer}`, async ({ page }) => {
    test.setTimeout(120_000);
    const errors = [];
    const diagnostics = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'warning' || message.type() === 'error') diagnostics.push(message.text());
      if (message.type() === 'error' && message.text().includes('PL-COUNTRY-BOUNDARY')) errors.push(message.text());
    });
    await page.goto(`/?renderer=${renderer}&demTerrain=raster&debug=1`);
    await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
    await page.locator('#mapDisplayBtn').click();
    await page.locator('[data-map-display-row="terrain"]').click();
    await page.locator('label[for="terrainPhysicalRadio"]').click();
    await expect.poll(() => page.evaluate(() => window.__PANDOLAB_GPU_METRICS__?.countryBoundaryMode)).toBe('shared');
    try {
      await expect.poll(() => page.evaluate(() => window.__PANDOLAB_GPU_METRICS__?.countrySharedBoundarySegmentCount || 0),
        { timeout: 12_000 }).toBeGreaterThan(100);
    } catch (error) {
      const metrics = await page.evaluate(() => ({ ...window.__PANDOLAB_GPU_METRICS__, startup: window.__PANDOLAB_STARTUP_METRICS__ }));
      throw new Error(`${error.message}\nDiagnostics: ${JSON.stringify({
        renderer: metrics.rendererMode, quality: metrics.activeMeshQuality, ready: metrics.countrySharedBoundaryReady,
        worker: metrics.countrySharedBoundaryWorkerActive, requestId: metrics.countrySharedBoundaryRequestId,
        lastMessage: metrics.countrySharedBoundaryLastMessage,
        startup: metrics.startup?.rendererStatus, warnings: diagnostics.slice(-10),
      })}`, { cause: error });
    }
    expect(errors).toEqual([]);
  });
}


test.describe('mobile country-border handoff', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 2, trace: 'off' });

  for (const renderer of ['webgl2', 'canvas']) {
    test(`keeps precise borders visible through zoom without mesh switching (${renderer})`, async ({ page }) => {
      test.setTimeout(150_000);
      await page.goto(`/?renderer=${renderer}&demTerrain=raster&debug=1`);
      await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
      await expect.poll(() => page.evaluate(() =>
        window.__PANDOLAB_GPU_METRICS__?.countrySharedBoundarySegmentCount || 0),
      { timeout: 40_000 }).toBeGreaterThan(100);
      await expect.poll(() => page.evaluate(() =>
        window.__PANDOLAB_GPU_METRICS__?.activeMeshQuality)).toBe('canonical');
      const start = await page.evaluate(() => window.__PANDOLAB_GPU_METRICS__?.meshSwitchCount || 0);
      await page.evaluate(() => {
        window.__countryBorderSamples = [];
        window.__countryBorderSampler = setInterval(() => {
          const metrics = window.__PANDOLAB_GPU_METRICS__;
          if (metrics) window.__countryBorderSamples.push({
            count: metrics.countrySharedBoundarySegmentCount,
            ready: metrics.countrySharedBoundaryReady,
            pending: metrics.countrySharedBoundaryReplacementPending,
          });
        }, 15);
      });
      try {
        for (const target of [3.3, 1, 3.3, 1]) {
          await page.evaluate(zoom => {
            const map = document.getElementById('map');
            const rect = map.getBoundingClientRect();
            const current = window.__PANDOLAB_VIEW_DEBUG__.snapshot().zoom;
            map.dispatchEvent(new WheelEvent('wheel', {
              bubbles: true, cancelable: true,
              clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
              deltaY: -Math.log(zoom / current) / 0.0013,
            }));
          }, target);
          await page.waitForTimeout(380);
        }
      } finally {
        await page.evaluate(() => clearInterval(window.__countryBorderSampler));
      }
      const result = await page.evaluate(() => ({
        samples: window.__countryBorderSamples,
        switches: window.__PANDOLAB_GPU_METRICS__?.meshSwitchCount || 0,
      }));
      expect(result.switches).toBe(start);
      expect(result.samples.length).toBeGreaterThan(12);
      expect(result.samples.every(row => row.ready && row.count > 100)).toBe(true);
    });
  }
});
