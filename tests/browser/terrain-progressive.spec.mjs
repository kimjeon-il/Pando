import { expect, test } from '@playwright/test';
import path from 'node:path';

const DEM_ORIGIN = 'https://kimjeon-il.github.io/world-map-terrain-v0.13.0';

test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  deviceScaleFactor: 2,
  launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'] },
});
test.skip(process.env.PANDOLAB_VERIFY_LIVE_DEM !== '1' && !process.env.PANDOLAB_DEM_OUTPUT_DIR,
  'Opt in to hosted DEM network regression or provide generated DEM assets');

test('slow mobile globe uses coarse DEM only during map preview and requests detail directly after promotion', async ({ page }) => {
  test.setTimeout(240_000);
  const started = [];
  let releaseFine;
  const fineGate = new Promise(resolve => { releaseFine = resolve; });
  let releaseCanonical;
  const canonicalGate = new Promise(resolve => { releaseCanonical = resolve; });
  await page.route('**/countries-canonical-v*.pcg.gz*', async route => {
    await canonicalGate;
    if (!page.isClosed()) await route.continue();
  });
  await page.route(`${DEM_ORIGIN}/terrain/**`, async route => {
    const pathname = new URL(route.request().url()).pathname;
    const tile = pathname.match(/\/terrain\/v\d+\.\d+\.\d+\/(\d+)\/(\d+)-(\d+)\.webp$/);
    if (tile) {
      started.push({ level: Number(tile[1]), column: Number(tile[2]), row: Number(tile[3]) });
      await new Promise(resolve => setTimeout(resolve, 150));
      if (Number(tile[1]) > 1) await fineGate;
    }
    const output = process.env.PANDOLAB_DEM_OUTPUT_DIR;
    if (output) {
      const relative = pathname.match(/\/terrain\/v[^/]+\/(.*)$/)[1];
      await route.fulfill({ path: path.join(output, relative),
        contentType: pathname.endsWith('.webp') ? 'image/webp' : 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*' } });
    } else await route.continue();
  });

  try {
    await page.goto('/?renderer=webgl2&debug=1&demTerrain=preview', { waitUntil: 'domcontentloaded' });
    await expect.poll(() => page.evaluate(() => window.__PANDOLAB_GPU_METRICS__?.terrainRepresentation),
      { timeout: 120_000 }).toBe('dem-relief-v1');
    await expect.poll(() => started.length, { timeout: 60_000 }).toBeGreaterThanOrEqual(2);
    expect(started.slice(0, 2).every(tile => tile.level === 1)).toBe(true);
    await expect.poll(() => page.evaluate(() => {
      const metrics = window.__PANDOLAB_GPU_METRICS__;
      return metrics?.terrainTargetLevel === 1 && metrics.terrainTargetTileCount > 0
        && metrics.terrainRenderedLevel === 1
        && metrics.terrainTargetTilesSettled;
    }), { timeout: 90_000 }).toBe(true);
    expect(started.every(tile => tile.level === 1)).toBe(true);
    releaseCanonical();
    await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
    await page.evaluate(() => {
      const map = document.getElementById('map');
      const rect = map.getBoundingClientRect();
      const current = window.__PANDOLAB_VIEW_DEBUG__.snapshot().zoom;
      map.dispatchEvent(new window.WheelEvent('wheel', { bubbles: true, cancelable: true,
        clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
        deltaY: -Math.log(3 / current) / 0.0013 }));
    });
    await expect.poll(() => page.evaluate(() => {
      const metrics = window.__PANDOLAB_GPU_METRICS__;
      return metrics?.terrainTargetLevel > 1 && metrics.terrainRenderedLevel === -1;
    }), { timeout: 60_000 }).toBe(true);
    const targetLevel = await page.evaluate(() => window.__PANDOLAB_GPU_METRICS__.terrainTargetLevel);
    expect(started.filter(tile => tile.level > 1).every(tile => tile.level === targetLevel)).toBe(true);

    for (const longitude of [-90, 0, 90]) {
      await page.evaluate(value => {
        const host = window.__PANDOLAB_MAP_HOST__;
        const view = host.getViewState();
        host.setViewState({ projection: 'globe', view: { ...view, globeRotation: [value, 0] } });
        host.requestRepaint('terrain-progressive-rotation');
      }, longitude);
      await page.waitForTimeout(90);
    }
    const priorRequests = started.length;
    releaseFine();
    await expect.poll(() => page.evaluate(() => {
      const metrics = window.__PANDOLAB_GPU_METRICS__;
      return { level: metrics?.terrainTargetLevel, rendered: metrics?.terrainRenderedLevel,
        loaded: metrics?.terrainTargetTilesLoaded, target: metrics?.terrainTargetTileCount,
        settled: metrics?.terrainTargetTilesSettled };
    }), { timeout: 90_000 }).toMatchObject({ level: targetLevel, rendered: targetLevel, settled: true });
    const afterRotation = started.slice(priorRequests).filter(tile => tile.level > 0);
    expect(afterRotation.length).toBeGreaterThan(0);
    const currentViewRequests = afterRotation.filter(tile => {
      const width = 1350 * 2 ** tile.level;
      const pixelWidth = Math.min(1024, width - tile.column * 1024);
      const centerLongitude = -180 + (tile.column * 1024 + pixelWidth / 2) / width * 360;
      const distanceFromFinalView = Math.abs((((centerLongitude + 90) + 540) % 360) - 180);
      return distanceFromFinalView < 80;
    });
    expect(currentViewRequests.length).toBeGreaterThan(0);
  } finally {
    releaseCanonical();
    releaseFine();
    await page.close();
  }
});
