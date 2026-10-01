import { expect, test } from '@playwright/test';

test.use({
  launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'] },
  trace: 'off',
});

test('WebGL2 displays the startup preview', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/?renderer=webgl2', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'preview', { timeout: 30_000 });
  expect(await page.evaluate(() => window.__PANDOLAB_GPU_METRICS__?.renderer)).toBe('webgl2');
});

test('terrain tiles render on the preview while canonical countries remain pending', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let releaseCanonical;
  const canonicalGate = new Promise(resolve => { releaseCanonical = resolve; });
  await page.route('**/countries-canonical-v*.pcg.gz*', async route => {
    await canonicalGate;
    if (!page.isClosed()) await route.continue();
  });
  try {
    // Local raster avoids CDN timing; both formats use the same startup loader.
    await page.goto('/?renderer=webgl2&demTerrain=raster', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'preview', { timeout: 30_000 });
    await expect.poll(() => page.evaluate(() => window.__PANDOLAB_GPU_METRICS__?.terrainRenderedLevel ?? -1),
      { timeout: 20_000 }).toBeGreaterThanOrEqual(0);
    const status = await page.evaluate(() => ({
      canonicalReceived: window.__PANDOLAB_STARTUP_METRICS__?.canonicalGeometryReceivedMs,
      renderer: window.__PANDOLAB_GPU_METRICS__?.renderer,
      terrainCacheBytes: window.__PANDOLAB_GPU_METRICS__?.terrainCacheBytes,
      readiness: document.querySelector('#app').dataset.readiness,
    }));
    expect(status.canonicalReceived).toBeNull();
    expect(status.renderer).toBe('webgl2');
    expect(status.terrainCacheBytes).toBeGreaterThan(0);
    expect(status.readiness).toBe('preview');
    expect(errors).toEqual([]);
  } finally {
    await page.close();
    releaseCanonical();
  }
});
