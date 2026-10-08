import { expect, test } from '@playwright/test';
import { canonicalVertexCount, worldAssets } from '../helpers/world-assets.mjs';

// The canonical map contains more than half a million coordinates. Retained
// Playwright DOM snapshots can stall for minutes after the enhanced handoff;
// explicit screenshots still preserve visual evidence for geometry regressions.
test.use({ trace: 'off' });

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
  // The mobile ceiling is two; adaptive quality can impose a lower cap.
  expect(metrics.effectivePixelRatio).toBe(Math.min(3, 2, metrics.renderQuality.dprCap));
  expect(metrics.canvasBackingPixels[0] / metrics.viewportCss[0]).toBeLessThanOrEqual(2.01);
  expect(metrics.canvasBackingPixels[1] / metrics.viewportCss[1]).toBeLessThanOrEqual(2.01);
});

test('immutable core assets are reused from Cache Storage on reload', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  const first = await page.evaluate(() => window.__PANDOLAB_STARTUP_METRICS__);
  expect(first.geometry.assets.countryPacket.source).toBe('network');
  expect(first.mesh.assets.mesh.source).toBe('network');

  await page.reload();
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  const second = await page.evaluate(() => window.__PANDOLAB_STARTUP_METRICS__);
  expect(second.preview.assets.countries.source).toBe('cache');
  expect(second.geometry.assets.countryPacket.source).toBe('cache');
  expect(second.mesh.assets.mesh.source).toBe('cache');
  expect(second.geometry.transferredBytes).toBe(0);
  expect(second.mesh.transferredBytes).toBe(0);
});

test('a damaged cached country asset is deleted and recovered from the network', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  await page.evaluate(async packetUrl => {
    const cache = await caches.open('pandolab-world-content-v1');
    const url = new URL(packetUrl, new URL('assets/data/', new URL('./', location.href)));
    await cache.put(url, new Response(new Uint8Array([1, 2, 3, 4]), { headers: { 'Content-Type': 'application/gzip' } }));
  }, worldAssets.canonicalCountryPacket.url);
  let recoveryRequests = 0;
  page.on('request', request => {
    if (request.url().includes(worldAssets.canonicalCountryPacket.url)) recoveryRequests += 1;
  });

  await page.reload();
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  const metrics = await page.evaluate(() => window.__PANDOLAB_STARTUP_METRICS__);
  expect(recoveryRequests).toBe(1);
  expect(metrics.geometry.assets.countryPacket.source).toBe('network');
  expect(metrics.geometry.assets.countryPacket.cacheHit).toBe(false);
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
  await page.route(`**/${worldAssets.canonicalCountryPacket.url}*`, async route => {
    await geometryGate;
    await route.continue();
  });
  await page.route(`**/${worldAssets.canonicalMesh.url}*`, async route => {
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
    for (const pattern of [worldAssets.canonicalCountryPacket.url, worldAssets.canonicalMesh.url].map(url => `**/${url}*`)) {
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
    expect(await page.evaluate(() => {
      window.__startupCanvas = document.querySelector('.gpu-map-canvas');
      return !!window.__startupCanvas;
    })).toBe(true);
    releaseCanonical();
    await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 45_000 });
    await expect.poll(() => page.evaluate(() => window.__PANDOLAB_GPU_METRICS__?.canonicalMeshReady), { timeout: 45_000 }).toBe(true);
    // World scale intentionally retains preview LOD even after canonical upload.
    await page.mouse.move(720, 450);
    await page.mouse.wheel(0, -1800);
    await expect.poll(() => page.evaluate(() => {
      const metrics = window.__PANDOLAB_GPU_METRICS__ || {};
      return metrics.meshQuality === 'canonical' && metrics.canonicalMeshReady === true;
    }), { timeout: 45_000 }).toBe(true);
    const metrics = await page.evaluate(() => window.__PANDOLAB_GPU_METRICS__ || {});
    expect(metrics.meshQuality).toBe('canonical');
    expect(metrics.canonicalMeshReady).toBe(true);
    expect(metrics.renderVertices).toBe(canonicalVertexCount);
    expect(await page.evaluate(() => window.__startupCanvas.isConnected
      && window.__startupCanvas === document.querySelector('.gpu-map-canvas'))).toBe(true);
    if (renderer === 'webgl1') expect(metrics.renderer).toBe('webgl1');
    else expect(['canvas-worker', 'canvas2d']).toContain(metrics.renderer);
  });
}
