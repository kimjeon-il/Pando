import { expect, test } from '@playwright/test';

test('geometry becomes editable while the high-quality mesh is delayed, then upgrades in place', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.addInitScript(() => {
    window.__PANDOLAB_STARTUP_EVENTS__ = [];
    window.addEventListener('pandolab:interactive', () => window.__PANDOLAB_STARTUP_EVENTS__.push('interactive'));
    window.addEventListener('pandolab:editable', () => window.__PANDOLAB_STARTUP_EVENTS__.push('editable'));
    window.addEventListener('pandolab:ready', () => window.__PANDOLAB_STARTUP_EVENTS__.push('ready'));
  });

  let releaseMesh;
  const meshGate = new Promise(resolve => { releaseMesh = resolve; });
  let releaseGeometry;
  const geometryGate = new Promise(resolve => { releaseGeometry = resolve; });
  await page.route('**/countries-ne-5.1.1.geojson.gz*', async route => {
    await geometryGate;
    await route.continue();
  });
  await page.route('**/world-mesh-v0.12.6.bin.gz*', async route => {
    await meshGate;
    await route.continue();
  });

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

  releaseGeometry();
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'editable', { timeout: 30_000 });
  await expect(page.locator('#createMenu .create-menu-item').first()).toBeEnabled();
  await expect(page.locator('#newProjectBtn')).toBeEnabled();
  await expect(page.locator('#saveProjectBtn')).toBeEnabled();
  await expect(page.locator('#openGisBtn')).toBeEnabled();
  await expect(page.locator('#selectionStatus')).toContainText(selectedCountryName);
  await expect(page.locator('#zoomStatus')).toHaveText(previewZoom);
  expect(await page.evaluate(() => window.__PANDOLAB_STARTUP_EVENTS__)).toEqual(['interactive', 'editable']);
  expect((await page.evaluate(() => window.__PANDOLAB_GPU_METRICS__ || {})).meshQuality).toBe('preview');

  releaseMesh();
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  await expect.poll(
    () => page.evaluate(() => window.__PANDOLAB_STARTUP_EVENTS__),
    { timeout: 45_000 },
  ).toEqual(['interactive', 'editable', 'ready']);

  const canonicalMetrics = await page.evaluate(() => ({
    gpu: window.__PANDOLAB_GPU_METRICS__ || {},
    startup: window.__PANDOLAB_STARTUP_METRICS__ || {},
  }));
  expect(canonicalMetrics.gpu.meshQuality).toBe('canonical');
  expect(canonicalMetrics.gpu.canonicalMeshReady).toBe(true);
  expect(canonicalMetrics.gpu.renderVertices).toBe(1_028_628);
  expect(canonicalMetrics.startup.interactiveMs).toBeLessThan(canonicalMetrics.startup.readyMs);
  expect(canonicalMetrics.startup.interactiveMs).toBeLessThan(canonicalMetrics.startup.editableMs);
  expect(canonicalMetrics.startup.editableMs).toBeLessThan(canonicalMetrics.startup.readyMs);
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
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 120_000 });
  const metrics = await page.evaluate(() => window.__PANDOLAB_GPU_METRICS__ || {});
  expect(metrics.devicePixelRatio).toBe(3);
  expect(metrics.effectivePixelRatio).toBe(2);
  expect(metrics.canvasBackingPixels[0] / metrics.viewportCss[0]).toBeLessThanOrEqual(2.01);
  expect(metrics.canvasBackingPixels[1] / metrics.viewportCss[1]).toBeLessThanOrEqual(2.01);
});

test('versioned core assets are reused from Cache Storage on reload', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  const first = await page.evaluate(() => window.__PANDOLAB_STARTUP_METRICS__);
  expect(first.geometry.assets.countries.source).toBe('network');
  expect(first.mesh.assets.mesh.source).toBe('network');

  await page.reload();
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  const second = await page.evaluate(() => window.__PANDOLAB_STARTUP_METRICS__);
  expect(second.preview.assets.countries.source).toBe('cache');
  expect(second.geometry.assets.countries.source).toBe('cache');
  expect(second.mesh.assets.mesh.source).toBe('cache');
  expect(second.geometry.transferredBytes).toBe(0);
  expect(second.mesh.transferredBytes).toBe(0);
});

test('a damaged cached country asset is deleted and recovered from the network', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  await page.evaluate(async () => {
    const cache = await caches.open('pandolab-core-0.30.0-r5');
    const url = new URL('/assets/data/countries-ne-5.1.1.geojson.gz?v=0.30.0-r5', location.href);
    await cache.put(url, new Response(new Uint8Array([1, 2, 3, 4]), { headers: { 'Content-Type': 'application/gzip' } }));
  });
  let recoveryRequests = 0;
  page.on('request', request => {
    if (request.url().includes('countries-ne-5.1.1.geojson.gz')) recoveryRequests += 1;
  });

  await page.reload();
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  const metrics = await page.evaluate(() => window.__PANDOLAB_STARTUP_METRICS__);
  expect(recoveryRequests).toBe(1);
  expect(metrics.geometry.assets.countries.source).toBe('network');
  expect(metrics.geometry.assets.countries.cacheHit).toBe(false);
});

test('constrained devices request the high-quality mesh only after geometry is applied', async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'deviceMemory', { configurable: true, value: 2 });
    Object.defineProperty(navigator, 'hardwareConcurrency', { configurable: true, value: 4 });
  });
  let releaseGeometry;
  const geometryGate = new Promise(resolve => { releaseGeometry = resolve; });
  let meshRequested = false;
  await page.route('**/countries-ne-5.1.1.geojson.gz*', async route => {
    await geometryGate;
    await route.continue();
  });
  await page.route('**/world-mesh-v0.12.6.bin.gz*', async route => {
    meshRequested = true;
    await route.continue();
  });

  await page.goto('/');
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 45_000 });
  expect(meshRequested).toBe(false);
  expect((await page.evaluate(() => window.__PANDOLAB_STARTUP_METRICS__)).loadPolicy.mode).toBe('sequential');
  releaseGeometry();
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'editable', { timeout: 45_000 });
  await expect.poll(() => meshRequested, { timeout: 10_000 }).toBe(true);
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
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
    await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 45_000 });
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
