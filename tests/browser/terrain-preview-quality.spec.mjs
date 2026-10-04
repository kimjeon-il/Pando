import { expect, test } from '@playwright/test';
import path from 'node:path';

test.use({ viewport: { width: 1100, height: 760 }, trace: 'off',
  launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'] } });

for (const renderer of ['webgl2', 'canvas']) {
  test(`improved ${renderer} terrain paints while the map remains in preview`, async ({ page, baseURL }, testInfo) => {
    test.setTimeout(150_000);
    const errors = [], tiles = [];
    page.on('pageerror', error => errors.push(error.message));
    const output = process.env.PANDOLAB_DEM_OUTPUT_DIR;
    await page.route('**/terrain/**', async route => {
      const pathname = new URL(route.request().url()).pathname;
      const tile = pathname.match(/\/(\d+)\/\d+-\d+\.webp$/);
      if (tile) tiles.push(Number(tile[1]));
      if (renderer === 'webgl2' && output
          && new URL(route.request().url()).hostname === 'kimjeon-il.github.io') {
        const relative = pathname.match(/\/terrain\/v[^/]+\/(.*)$/)[1];
        await route.fulfill({ path: path.join(output, relative),
          contentType: pathname.endsWith('.webp') ? 'image/webp' : 'application/json',
          headers: { 'Access-Control-Allow-Origin': '*' } });
      } else await route.continue();
    });
    try {
      const site = process.env.PANDOLAB_TEST_SITE_URL || `${baseURL}/`;
      await page.goto(new URL(`?renderer=${renderer}&debug=1${renderer === 'canvas' ? '&demTerrain=raster' : ''}`, site).href,
        { waitUntil: 'domcontentloaded' });
      await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
      await expect(page.locator('.gpu-map-canvas')).toBeVisible();
      await expect.poll(() => tiles.length, { timeout: 90_000 }).toBeGreaterThan(0);
      expect(tiles.every(level => level === 1)).toBe(true);
      if (renderer === 'webgl2') {
        await expect.poll(() => page.evaluate(() => {
          const m = window.__PANDOLAB_GPU_METRICS__;
          return m?.terrainTargetLevel === 1 && m.terrainRenderedLevel === 1
            && m.terrainTargetTilesSettled && m.terrainTintReady;
        }), { timeout: 90_000 }).toBe(true);
      } else {
        await expect.poll(() => page.evaluate(() => {
          const canvas = document.querySelector('.gpu-map-canvas');
          if (!canvas) return 0;
          const probe = document.createElement('canvas');
          probe.width = canvas.width; probe.height = canvas.height;
          const context = probe.getContext('2d');
          context.drawImage(canvas, 0, 0);
          const rgba = context.getImageData(0, 0, probe.width, probe.height).data;
          let blue = 0;
          for (let i = 0; i < rgba.length; i += 4) if (rgba[i + 3] > 0 && rgba[i + 2] > rgba[i] + 15) blue++;
          return blue;
        }), { timeout: 90_000 }).toBeGreaterThan(40_000);
      }
      await page.screenshot({ path: testInfo.outputPath(`${renderer}-improved-preview.png`) });
      expect(tiles.every(level => level === 1)).toBe(true);
      if (renderer === 'webgl2') {
        await page.evaluate(() => {
          const host = window.__PANDOLAB_MAP_HOST__;
          const view = host.getViewState();
          host.setViewState({ projection: 'flat', view: { ...view, flatCenter: [110, 32], flatZoom: 4 } });
          host.requestRepaint('terrain-china-quality');
        });
        await expect.poll(() => page.evaluate(() => {
          const m = window.__PANDOLAB_GPU_METRICS__;
          return m?.terrainTargetLevel > 1 && m.terrainTargetTilesSettled && m.terrainTintReady;
        }), { timeout: 90_000 }).toBe(true);
        await page.screenshot({ path: testInfo.outputPath('china-detailed-tint.png') });
      }
      expect(errors).toEqual([]);
    } finally {
      await page.close();
    }
  });
}
