import { expect, test } from '@playwright/test';

// The canonical map contains more than half a million coordinates. Retained
// Playwright DOM snapshots can stall for minutes after the enhanced handoff;
// explicit screenshots still preserve visual evidence for geometry regressions.
test.use({ trace: 'off' });

async function runDebugAudit(page) {
  const panel = page.locator('#debugMapPanel');
  await panel.getByRole('button', { name: '전체 지도 검사' }).evaluateAll(buttons => buttons.at(-1)?.click());
  await expect.poll(
    () => panel.locator('pre').evaluateAll(nodes => nodes.at(-1)?.textContent || ''),
    { timeout: 120_000 },
  ).toContain('audit: ready / 0 issues');
}

async function prepareCountryInLayerSearch(page, name) {
  if (!await page.locator('#leftPanel').isVisible()) await page.locator('#mobileMapBtn').click();
  await page.locator('#layerSearchInput').fill(name);
  const result = page.getByRole('option').filter({ hasText: name }).first();
  await expect(result).toBeVisible();
  return result;
}

async function focusCountryFromLayerSearch(page, name) {
  const result = await prepareCountryInLayerSearch(page, name);
  await result.click();
  await page.locator('#focusSelectedObjectBtn').click();
}

async function attachMapSnapshot(page, testInfo, name) {
  const body = await page.locator('#map').screenshot({ animations: 'disabled' });
  await testInfo.attach(name, { body, contentType: 'image/png' });
}

function trackBrowserErrors(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    const value = message.text();
    if (message.type() === 'warning' && /^\[\.WebGL-.*GPU stall due to ReadPixels/.test(value)) return;
    if (['warning', 'warn', 'error'].includes(message.type())) errors.push(`${message.type()}: ${value}`);
  });
  return errors;
}

async function gateCanonicalAssets(page) {
  let releaseCanonical;
  const canonicalGate = new Promise(resolve => { releaseCanonical = resolve; });
  for (const pattern of ['**/countries-ne-5.1.1.geojson.gz*', '**/world-mesh-v0.12.6.bin.gz*']) {
    await page.route(pattern, async route => {
      await canonicalGate;
      await route.continue();
    });
  }
  return releaseCanonical;
}

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

  const viewRevisionBefore = await page.evaluate(() => window.__PANDOLAB_VIEW_REVISION__ || 0);
  await page.locator('#mobileZoomInBtn').click();
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_VIEW_REVISION__ || 0)).toBeGreaterThan(viewRevisionBefore);
  await page.locator('#mobileMapBtn').click();
  const countryFolder = page.locator('[data-layer-folder-toggle="countries"]').first();
  if (await countryFolder.getAttribute('aria-expanded') !== 'true') await countryFolder.click();
  const previewCountry = page.locator('#countriesLayerChildren .layer-child-name').first();
  const selectedCountryName = (await previewCountry.textContent()).trim();
  await previewCountry.click();
  await expect(page.locator('#selectionStatus')).toContainText(selectedCountryName);
  await page.locator('#mobileCreateBtn').click();
  await expect(page.locator('#createMenu .create-menu-item').first()).toBeDisabled();
  await expect(page.locator('#newProjectBtn')).toBeDisabled();
  await expect(page.locator('#saveProjectBtn')).toBeDisabled();
  await expect(page.locator('#openGisBtn')).toBeDisabled();

  const previewMetrics = await page.evaluate(() => window.__PANDOLAB_GPU_METRICS__ || {});
  expect(previewMetrics.meshQuality).toBe('preview');
  expect(previewMetrics.renderVertices).toBeLessThan(100_000);
  expect(await page.evaluate(() => window.__PANDOLAB_STARTUP_EVENTS__)).toEqual(['interactive']);
  await page.locator('#mobileCreateBtn').click();
  await expect(page.locator('#createMenu')).not.toHaveClass(/mobile-open/);
  const stableView = await page.evaluate(() => ({
    revision: window.__PANDOLAB_VIEW_REVISION__,
    projection: window.__PANDOLAB_VIEW_STATE__?.projection,
    geographicCenter: window.__PANDOLAB_VIEW_STATE__?.geographicCenter,
    zoom: window.__PANDOLAB_VIEW_STATE__?.zoom,
  }));

  releaseGeometry();
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'editable', { timeout: 30_000 });
  await expect(page.locator('#createMenu .create-menu-item').first()).toBeEnabled();
  await expect(page.locator('#newProjectBtn')).toBeEnabled();
  await expect(page.locator('#saveProjectBtn')).toBeEnabled();
  await expect(page.locator('#openGisBtn')).toBeEnabled();
  await expect(page.locator('#selectionStatus')).toContainText(selectedCountryName);
  expect(await page.evaluate(() => window.__PANDOLAB_STARTUP_EVENTS__)).toEqual(['interactive', 'editable']);
  expect((await page.evaluate(() => window.__PANDOLAB_GPU_METRICS__ || {})).meshQuality).toBe('preview');
  expect(await page.evaluate(() => ({
    revision: window.__PANDOLAB_VIEW_REVISION__,
    projection: window.__PANDOLAB_VIEW_STATE__?.projection,
    geographicCenter: window.__PANDOLAB_VIEW_STATE__?.geographicCenter,
    zoom: window.__PANDOLAB_VIEW_STATE__?.zoom,
  }))).toEqual(stableView);

  releaseMesh();
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  await expect.poll(
    () => page.evaluate(() => window.__PANDOLAB_STARTUP_EVENTS__),
    { timeout: 45_000 },
  ).toEqual(['interactive', 'editable', 'ready']);
  expect(await page.evaluate(() => window.__PANDOLAB_VIEW_REVISION__)).toBe(stableView.revision);

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

test.describe('canonical handoff geometry regression', () => {
  test('preview map keeps Egypt and Borneo valid while canonical assets are delayed', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const errors = trackBrowserErrors(page);
    await gateCanonicalAssets(page);

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/?debug');
    await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 45_000 });
    await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'preview');
    await page.locator('#flatBtn').click();
    await runDebugAudit(page);

    await focusCountryFromLayerSearch(page, '이집트');
    await attachMapSnapshot(page, testInfo, 'egypt-preview');
    await focusCountryFromLayerSearch(page, '브루나이');
    await attachMapSnapshot(page, testInfo, 'borneo-preview');
    expect(errors).toEqual([]);
  });

  test('enhanced map audit stays valid after canonical handoff', async ({ page }) => {
    test.setTimeout(240_000);
    const errors = trackBrowserErrors(page);
    const releaseCanonical = await gateCanonicalAssets(page);

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/?debug');
    await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 45_000 });
    await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'preview');
    await page.locator('#flatBtn').click();

    releaseCanonical();
    await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 120_000 });
    await expect.poll(() => page.evaluate(() => window.__PANDOLAB_GPU_METRICS__?.pendingCountryCount || 0), {
      timeout: 45_000,
    }).toBe(0);
    await expect.poll(() => page.evaluate(() => {
      const metrics = window.__PANDOLAB_GPU_METRICS__ || {};
      return metrics.displayedRevision === metrics.requestedRevision;
    }), {
      timeout: 45_000,
    }).toBe(true);

    await runDebugAudit(page);
    expect(errors).toEqual([]);
  });
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
    const cache = await caches.open('pandolab-core-0.30.0-r11');
    const url = new URL('/assets/data/countries-ne-5.1.1.geojson.gz?v=0.30.0-r11', location.href);
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
