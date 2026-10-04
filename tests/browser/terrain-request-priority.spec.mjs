import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 1100, height: 760 }, trace: 'off',
  launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'] } });

test('rotating the globe loads the new viewport while obsolete responses remain stalled', async ({ page, baseURL }) => {
  test.setTimeout(150_000);
  let phase = 'startup', changedAt = 0;
  let release;
  const stalled = new Promise(resolve => { release = resolve; });
  const oldRequests = new Set(), newRequests = [], cancelled = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('requestfailed', request => { if (oldRequests.has(request.url())) cancelled.push(request.url()); });
  await page.route('**/terrain/v*/**/*.webp*', async route => {
    const match = new URL(route.request().url()).pathname.match(/\/terrain\/v[^/]+\/(\d+)\/\d+-\d+\.webp$/);
    if (match && Number(match[1]) > 0) {
      if (phase === 'old') { oldRequests.add(route.request().url()); await stalled; }
      else if (phase === 'new') newRequests.push({ url: route.request().url(), delayMs: Date.now() - changedAt });
    }
    if (!page.isClosed()) await route.continue().catch(error => {
      if (!route.request().failure() && !page.isClosed()) throw error;
    });
  });
  const move = rotation => page.evaluate(value => {
    const host = window.__PANDOLAB_MAP_HOST__;
    host.setViewState({ projection: 'globe', view: {
      flatCenter: [0, 0], flatZoom: 1, globeRotation: value, globeZoom: 3,
    } });
    host.requestRepaint('terrain-priority-rotation');
  }, rotation);
  try {
    const site = process.env.PANDOLAB_TEST_SITE_URL || `${baseURL}/`;
    await page.goto(new URL('?renderer=webgl2&debug=1', site).href, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
    phase = 'old';
    await move([0, 0, 0]);
    await expect.poll(() => oldRequests.size, { timeout: 15_000 }).toBe(4);
    phase = 'new'; changedAt = Date.now();
    await move([-160, 0, 0]);
    await expect.poll(() => newRequests.length, { timeout: 3_000 }).toBeGreaterThan(0);
    await expect.poll(() => cancelled.length, { timeout: 3_000 }).toBeGreaterThan(0);
    await expect.poll(() => page.evaluate(() => window.__PANDOLAB_GPU_METRICS__?.terrainTargetTilesLoaded || 0),
      { timeout: 45_000 }).toBeGreaterThan(0);
    const metrics = await page.evaluate(() => window.__PANDOLAB_GPU_METRICS__);
    expect(metrics.terrainFailureCount).toBe(0);
    expect(errors).toEqual([]);
    console.log(JSON.stringify({ newViewportRequestDelayMs: newRequests[0].delayMs, cancelled: cancelled.length,
      loadedCurrentTiles: metrics.terrainTargetTilesLoaded }));
    await page.screenshot({ path: test.info().outputPath('current-globe-tiles.png') });
  } finally { release(); }
});
