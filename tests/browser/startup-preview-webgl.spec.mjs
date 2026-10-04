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
    expect(await page.evaluate(() => window.__PANDOLAB_GPU_METRICS__.terrainTargetLevel)).toBe(0);
    expect(await page.evaluate(() => window.__PANDOLAB_GPU_METRICS__.terrainRenderedLevel)).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    await page.close();
    releaseCanonical();
  }
});

for (const renderer of ['webgl2', 'canvas']) {
  test(`${renderer} switches preview terrain directly to camera detail after canonical promotion`, async ({ page, context }, testInfo) => {
    test.setTimeout(180_000);
    const started = [];
    const errors = [];
    const warnings = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (['warning', 'error'].includes(message.type())) warnings.push(message.text()); });
    await page.addInitScript(() => {
      window.__terrainTestFrames = [];
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker {
        constructor(...args) {
          super(...args);
          this.addEventListener('message', ({ data }) => {
            if (data.type === 'frame') window.__terrainTestFrames.push({ terrainComplete: data.terrainComplete });
          });
        }
      };
    });
    let releaseCanonical, releaseDetail;
    const canonicalGate = new Promise(resolve => { releaseCanonical = resolve; });
    const detailGate = new Promise(resolve => { releaseDetail = resolve; });
    await page.route('**/countries-canonical-v*.pcg.gz*', async route => {
      await canonicalGate;
      if (!page.isClosed()) await route.continue();
    });
    await context.route('**/terrain/v0.12.6/**/*.webp*', async route => {
      const tile = new URL(route.request().url()).pathname.match(/\/(\d+)\/(\d+)-(\d+)\.webp$/);
      if (tile) {
        started.push(Number(tile[1]));
        if (Number(tile[1]) > 0) await detailGate;
      }
      if (!page.isClosed()) await route.continue();
    });
    try {
      await page.goto(`/?renderer=${renderer}&debug=1&demTerrain=raster`, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'preview', { timeout: 30_000 });
      await expect.poll(() => started.length, { timeout: 60_000 }).toBeGreaterThan(0);
      expect(started.every(level => level === 0)).toBe(true);
      await page.evaluate(() => {
        const host = window.__PANDOLAB_MAP_HOST__;
        const old = host.getViewState();
        host.setViewState({ projection: 'flat', view: { ...old, flatCenter: [100, 36], flatZoom: 8 } });
        host.requestRepaint('preview-terrain-zoom');
      });
      await expect.poll(() => page.evaluate(() => window.__PANDOLAB_MAP_HOST__.getViewState().projection)).toBe('flat');
      expect(started.every(level => level === 0)).toBe(true);
      releaseCanonical();
      await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 60_000 });
      await expect.poll(() => started.filter(level => level > 0).length, { timeout: 20_000 }).toBeGreaterThan(0);
      const detailedLevels = started.filter(level => level > 0);
      expect(new Set(detailedLevels).size).toBe(1);
      if (renderer === 'webgl2') {
        await expect.poll(() => page.evaluate(() => window.__PANDOLAB_GPU_METRICS__?.terrainRenderedLevel)).toBe(-1);
      }
      const frameCount = await page.evaluate(() => window.__terrainTestFrames.length);
      releaseDetail();
      if (renderer === 'webgl2') {
        await expect.poll(() => page.evaluate(() => {
          const metrics = window.__PANDOLAB_GPU_METRICS__;
          return metrics?.terrainTargetTilesSettled && metrics.terrainRenderedLevel === metrics.terrainTargetLevel;
        }), { timeout: 30_000 }).toBe(true);
      } else {
        await expect.poll(() => page.evaluate(() => window.__PANDOLAB_GPU_METRICS__?.renderer)).toBe('canvas-worker');
        await expect.poll(() => page.evaluate(count => window.__terrainTestFrames.slice(count)
          .some(frame => frame.terrainComplete === true), frameCount), { timeout: 30_000 }).toBe(true);
      }
      await page.screenshot({ path: testInfo.outputPath('canonical-detail.png') });
      await page.evaluate(() => {
        const map = document.getElementById('map');
        const rect = map.getBoundingClientRect();
        const current = window.__PANDOLAB_VIEW_DEBUG__.snapshot().zoom;
        map.dispatchEvent(new window.WheelEvent('wheel', { bubbles: true, cancelable: true,
          clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
          deltaY: -Math.log(1 / current) / 0.0013 }));
      });
      await expect.poll(() => page.evaluate(() => window.__PANDOLAB_GPU_METRICS__?.activeMeshQuality)).toBe('preview');
      if (renderer === 'webgl2') {
        await expect.poll(() => page.evaluate(() => window.__PANDOLAB_GPU_METRICS__?.terrainRenderedLevel)).toBe(0);
        expect(await page.evaluate(() => window.__PANDOLAB_GPU_METRICS__.terrainTargetLevel)).toBe(0);
      }
      expect(errors).toEqual([]);
    } catch (error) {
      console.log(JSON.stringify({ renderer, started, errors, warnings,
        metrics: await page.evaluate(() => window.__PANDOLAB_GPU_METRICS__),
      }));
      throw error;
    } finally {
      releaseCanonical();
      releaseDetail();
      await page.close();
    }
  });
}
