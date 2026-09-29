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
