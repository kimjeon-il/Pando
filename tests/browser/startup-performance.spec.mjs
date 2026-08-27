import { expect, test } from '@playwright/test';

test('preview becomes interactive while canonical assets are delayed, then upgrades in place', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.addInitScript(() => {
    window.__PANDOLAB_STARTUP_EVENTS__ = [];
    window.addEventListener('pandolab:interactive', () => window.__PANDOLAB_STARTUP_EVENTS__.push('interactive'));
    window.addEventListener('pandolab:ready', () => window.__PANDOLAB_STARTUP_EVENTS__.push('ready'));
  });

  let releaseCanonical;
  const canonicalGate = new Promise(resolve => { releaseCanonical = resolve; });
  for (const pattern of ['**/countries-ne-5.1.1.geojson*', '**/world-mesh-v0.12.6.bin.gz*']) {
    await page.route(pattern, async route => {
      await canonicalGate;
      await route.continue();
    });
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 45_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'preview');
  await expect(page.locator('#map .map-svg')).toBeVisible();

  const zoomBefore = await page.locator('#zoomStatus').textContent();
  await page.locator('#mobileZoomInBtn').click();
  await expect.poll(() => page.locator('#zoomStatus').textContent()).not.toBe(zoomBefore);
  await page.locator('#mobileMapBtn').click();
  const countryFolder = page.locator('[data-layer-folder-toggle="countries"]').first();
  if (await countryFolder.getAttribute('aria-expanded') !== 'true') await countryFolder.click();
  const previewCountry = page.locator('#countriesLayerChildren .layer-child-name').first();
  const selectedCountryName = (await previewCountry.textContent()).trim();
  await previewCountry.click();
  await expect(page.locator('#selectionStatus')).toContainText(selectedCountryName);
  const previewZoom = await page.locator('#zoomStatus').textContent();
  await page.locator('#mobileCreateBtn').click();
  await expect(page.locator('#createMenu .create-menu-item').first()).toBeDisabled();
  await expect(page.locator('#newProjectBtn')).toBeDisabled();
  await expect(page.locator('#saveProjectBtn')).toBeDisabled();
  await expect(page.locator('#openGisBtn')).toBeDisabled();

  const previewMetrics = await page.evaluate(() => window.__PANDOLAB_GPU_METRICS__ || {});
  expect(previewMetrics.meshQuality).toBe('preview');
  expect(previewMetrics.renderVertices).toBeLessThan(100_000);
  expect(await page.evaluate(() => window.__PANDOLAB_STARTUP_EVENTS__)).toEqual(['interactive']);

  releaseCanonical();
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'canonical', { timeout: 30_000 });
  await expect(page.locator('#createMenu .create-menu-item').first()).toBeEnabled();
  await expect(page.locator('#newProjectBtn')).toBeEnabled();
  await expect(page.locator('#selectionStatus')).toContainText(selectedCountryName);
  await expect(page.locator('#zoomStatus')).toHaveText(previewZoom);
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_STARTUP_EVENTS__)).toEqual(['interactive', 'ready']);

  const canonicalMetrics = await page.evaluate(() => ({
    gpu: window.__PANDOLAB_GPU_METRICS__ || {},
    startup: window.__PANDOLAB_STARTUP_METRICS__ || {},
  }));
  expect(canonicalMetrics.gpu.meshQuality).toBe('canonical');
  expect(canonicalMetrics.gpu.canonicalMeshReady).toBe(true);
  expect(canonicalMetrics.gpu.renderVertices).toBe(1_028_628);
  expect(canonicalMetrics.startup.interactiveMs).toBeLessThan(canonicalMetrics.startup.readyMs);
  expect(errors).toEqual([]);
});

test('Android-density mobile viewport caps the map backing store at DPR two', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 90_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'canonical', { timeout: 120_000 });
  const metrics = await page.evaluate(() => window.__PANDOLAB_GPU_METRICS__ || {});
  expect(metrics.devicePixelRatio).toBe(3);
  expect(metrics.effectivePixelRatio).toBe(2);
  expect(metrics.canvasBackingPixels[0] / metrics.viewportCss[0]).toBeLessThanOrEqual(2.01);
  expect(metrics.canvasBackingPixels[1] / metrics.viewportCss[1]).toBeLessThanOrEqual(2.01);
});

for (const renderer of ['webgl1', 'canvas']) {
  test(`${renderer} replaces preview data without recreating the visible map`, async ({ page }) => {
    test.setTimeout(180_000);
    let releaseCanonical;
    const canonicalGate = new Promise(resolve => { releaseCanonical = resolve; });
    for (const pattern of ['**/countries-ne-5.1.1.geojson*', '**/world-mesh-v0.12.6.bin.gz*']) {
      await page.route(pattern, async route => {
        await canonicalGate;
        await route.continue();
      });
    }
    await page.goto(`/?renderer=${renderer}`);
    await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });
    await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'preview');
    await expect.poll(
      () => page.evaluate(() => window.__PANDOLAB_GPU_METRICS__?.meshQuality),
      { timeout: 30_000 },
    ).toBe('preview');
    if (renderer === 'webgl1') {
      await expect.poll(() => page.evaluate(() => window.__PANDOLAB_GPU_METRICS__?.terrainLevel), { timeout: 20_000 }).toBe(0);
    }
    releaseCanonical();
    await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'canonical', { timeout: 45_000 });
    if (renderer === 'webgl1') {
      await expect.poll(() => page.evaluate(() => window.__PANDOLAB_GPU_METRICS__?.terrainLevel), { timeout: 20_000 }).toBeGreaterThanOrEqual(1);
    }
    const metrics = await page.evaluate(() => window.__PANDOLAB_GPU_METRICS__ || {});
    expect(metrics.meshQuality).toBe('canonical');
    expect(metrics.canonicalMeshReady).toBe(true);
    expect(metrics.renderVertices).toBe(1_028_628);
    if (renderer === 'webgl1') expect(metrics.renderer).toBe('webgl1');
    else expect(['canvas-worker', 'canvas2d']).toContain(metrics.renderer);
  });
}
