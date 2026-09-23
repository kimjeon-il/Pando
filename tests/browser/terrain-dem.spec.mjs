import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import path from 'node:path';

const output = process.env.PANDOLAB_DEM_OUTPUT_DIR;
const available = !!output && existsSync(path.join(output, 'manifest.json'));
const demOrigin = 'http://127.0.0.1:4174';

test.use({
  launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'] },
  trace: 'retain-on-failure',
});
test.skip(!available, 'Set PANDOLAB_DEM_OUTPUT_DIR to the complete external v0.13.0 output directory');

async function openDem(page, renderer, lowPrecision = false) {
  const requested = [];
  await page.route(`${demOrigin}/terrain/v0.13.0/**`, async route => {
    const pathname = new URL(route.request().url()).pathname;
    const relative = pathname.slice('/terrain/v0.13.0/'.length);
    requested.push(relative);
    const file = path.resolve(output, relative);
    if (!file.startsWith(path.resolve(output) + path.sep) || !existsSync(file)) {
      await route.fulfill({ status: 404, body: 'missing DEM asset' }); return;
    }
    await route.fulfill({ path: file, contentType: file.endsWith('.webp') ? 'image/webp' : 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  await page.addInitScript(({ url, lowPrecision }) => {
    window.PANDOLAB_DEV_DEM_MANIFEST_URL = url;
    if (lowPrecision) {
      const original = window.WebGLRenderingContext.prototype.getShaderPrecisionFormat;
      window.WebGLRenderingContext.prototype.getShaderPrecisionFormat = function(shader, precision) {
        if (shader === this.FRAGMENT_SHADER && precision === this.HIGH_FLOAT) {
          return { rangeMin: 0, rangeMax: 0, precision: 0 };
        }
        return original.call(this, shader, precision);
      };
    }
  }, { url: `${demOrigin}/terrain/v0.13.0/manifest.json`, lowPrecision });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`/?renderer=${renderer}&debug=1`);
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 120_000 });
  return { requested, errors };
}

test('WebGL2 uses DEM height tiles and tint through both terrain styles', async ({ page }) => {
  test.setTimeout(180_000);
  const { requested, errors } = await openDem(page, 'webgl2');
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_GPU_METRICS__?.terrainRepresentation),
    { timeout: 60_000 }).toBe('dem-relief-v1');
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_GPU_METRICS__?.terrainTilesLoaded || 0),
    { timeout: 60_000 }).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_GPU_METRICS__?.terrainTintReady),
    { timeout: 60_000 }).toBe(true);
  await page.locator('#terrainPoliticalRadio').check();
  await page.locator('#terrainPhysicalRadio').check();
  const moved = await page.evaluate(() => {
    const host = window.__PANDOLAB_MAP_HOST__;
    const old = host.getViewState();
    host.setViewState({ projection: 'flat', view: {
      flatCenter: [100, 60], flatZoom: Math.max(2, old.flatZoom),
      globeRotation: old.globeRotation, globeZoom: old.globeZoom,
    } });
    host.requestRepaint('dem-russia-smoke');
    return host.getViewState().flatCenter;
  });
  expect(moved).toEqual([100, 60]);
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_GPU_METRICS__?.terrainTilesLoaded || 0),
    { timeout: 60_000 }).toBeGreaterThan(0);
  expect(requested).toContain('tint.webp');
  expect(errors).toEqual([]);
});

test('WebGL1 with insufficient fragment precision falls back to raster as a whole', async ({ page }) => {
  test.setTimeout(180_000);
  const { errors } = await openDem(page, 'webgl1', true);
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_GPU_METRICS__?.terrainRepresentation),
    { timeout: 60_000 }).toBe('raster-rgba-v1');
  expect(errors).toEqual([]);
});

test('Canvas keeps Natural Earth raster despite the development DEM option', async ({ page }) => {
  test.setTimeout(180_000);
  const { requested, errors } = await openDem(page, 'canvas');
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_GPU_METRICS__?.terrainDatasetVersion),
    { timeout: 60_000 }).toBe('0.12.6');
  expect(requested.filter(value => value.endsWith('.webp'))).toEqual([]);
  expect(errors).toEqual([]);
});
