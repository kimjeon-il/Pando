import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 1100, height: 760 }, trace: 'off',
  launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'] } });

for (const initialQuality of ['preview', 'detail']) {
test(`zoom keeps loaded ${initialQuality} terrain painting while the next LOD is delayed`, async ({ page, baseURL }) => {
  test.setTimeout(300_000);
  let heldLevel = -1;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/terrain/v*/**/*.webp*', async route => {
    const match = new URL(route.request().url()).pathname.match(/\/terrain\/v[^/]+\/(\d+)\/\d+-\d+\.webp$/);
    if (match && (Number(match[1]) === heldLevel || heldLevel === -2 && Number(match[1]) > 1)) await gate;
    if (!page.isClosed()) await route.continue();
  });
  await page.addInitScript(() => {
    window.__terrainDrawPixels = [];
    const prototype = window.WebGL2RenderingContext.prototype;
    const draw = prototype.drawElements;
    prototype.drawElements = function(...args) {
      const result = draw.apply(this, args);
      if (!window.__captureTerrainDraws) return result;
      const program = this.getParameter(this.CURRENT_PROGRAM);
      const location = program && this.getUniformLocation(program, 'uLevelSize');
      if (!location) return result;
      const size = this.getUniform(program, location);
      const viewport = this.getParameter(this.VIEWPORT);
      const pixels = new Uint8Array(viewport[2] * viewport[3] * 4);
      this.readPixels(0, 0, viewport[2], viewport[3], this.RGBA, this.UNSIGNED_BYTE, pixels);
      let colored = 0;
      for (let i = 0; i < pixels.length; i += 64) {
        if (pixels[i + 3] && Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) - Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) > 20) colored++;
      }
      const level = Math.round(Math.log2(size[0] / 1350));
      window.__terrainDrawPixels.push({ level, colored });
      if (window.__terrainDrawPixels.length > 20) window.__terrainDrawPixels.shift();
      if (colored > 100 && level === window.__terrainExpectedFallbackLevel) window.__captureTerrainDraws = false;
      return result;
    };
  });
  try {
    const site = process.env.PANDOLAB_TEST_SITE_URL || `${baseURL}/`;
    await page.goto(new URL('?renderer=webgl2&debug=1', site).href, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
    if (initialQuality === 'detail') await page.evaluate(() => {
      const host = window.__PANDOLAB_MAP_HOST__;
      host.setViewState({ projection: 'flat', view: { flatCenter: [30, 40], flatZoom: 3, globeRotation: [0, 0], globeZoom: 1 } });
      host.requestRepaint('terrain-zoom-baseline');
    });
    await expect.poll(() => page.evaluate(() => {
      const m = window.__PANDOLAB_GPU_METRICS__;
      return m?.terrainTargetLevel > 0 && m.terrainTargetTilesLoaded === m.terrainTargetTileCount && m.terrainTintReady;
    }), { timeout: 60_000 }).toBe(true);
    if (initialQuality === 'detail') await expect.poll(() => page.evaluate(() =>
      window.__PANDOLAB_GPU_METRICS__.activeMeshQuality), { timeout: 60_000 }).toBe('canonical');
    const previousLevel = await page.evaluate(() => window.__PANDOLAB_GPU_METRICS__.terrainTargetLevel);
    if (initialQuality === 'preview') expect(previousLevel).toBe(1);
    expect(previousLevel).toBeLessThan(5);
    heldLevel = initialQuality === 'preview' ? -2 : previousLevel + 1;
    await page.evaluate(level => {
      window.__terrainExpectedFallbackLevel = level; window.__captureTerrainDraws = true;
    }, previousLevel);
    const bounds = await page.locator('#map').boundingBox();
    const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    await page.mouse.move(center.x, center.y);
    // Cross the globe's 2.2x country-detail threshold from the initial overview.
    await page.mouse.wheel(0, -Math.log(initialQuality === 'preview' ? 3 : 2) / 0.0013);
    if (initialQuality === 'preview') {
      await expect.poll(() => page.evaluate(() => window.__PANDOLAB_GPU_METRICS__?.terrainTargetLevel), { timeout: 30_000 }).toBeGreaterThan(previousLevel);
      heldLevel = await page.evaluate(() => window.__PANDOLAB_GPU_METRICS__.terrainTargetLevel);
    } else await expect.poll(() => page.evaluate(() => window.__PANDOLAB_GPU_METRICS__?.terrainTargetLevel), { timeout: 30_000 }).toBe(heldLevel);
    await expect.poll(() => page.evaluate(level => window.__terrainDrawPixels.some(draw => draw.level === level && draw.colored > 100), previousLevel)).toBe(true);
    expect(await page.evaluate(() => window.__PANDOLAB_GPU_METRICS__.terrainTargetTilesLoaded)).toBe(0);
    expect(await page.evaluate(() => window.__terrainDrawPixels.some(draw => draw.level === 0))).toBe(false);
    if (initialQuality === 'preview') {
      await page.evaluate(() => { window.__terrainDrawPixels = []; window.__captureTerrainDraws = true; });
      await page.mouse.down();
      await page.mouse.move(center.x + 40, center.y + 40, { steps: 5 });
      await page.mouse.up();
      await expect.poll(() => page.evaluate(level => window.__terrainDrawPixels.some(draw => draw.level === level && draw.colored > 100), previousLevel)).toBe(true);
      expect(await page.evaluate(() => window.__PANDOLAB_GPU_METRICS__.terrainTargetTilesLoaded)).toBe(0);
    }
    await page.screenshot({ path: test.info().outputPath('terrain-during-zoom.png') });
    // Pixel reads prove fallback coverage above; stop synchronizing the whole
    // software GPU on every tile draw while checking replacement completion.
    await page.evaluate(() => { window.__captureTerrainDraws = false; });
    release();
    // Camera-selected detail can stream twenty remote DEM textures on
    // SwiftShader. This checks eventual replacement, not a load-time SLA.
    await expect.poll(() => page.evaluate(() => {
      const m = window.__PANDOLAB_GPU_METRICS__;
      return m.terrainTargetTilesLoaded === m.terrainTargetTileCount && m.terrainRenderedLevel === m.terrainTargetLevel;
    }), { timeout: 120_000 }).toBe(true);
    expect(errors).toEqual([]);
  } catch (error) {
    console.log('TERRAIN_ZOOM_FAILURE', JSON.stringify(await page.evaluate(() => ({
      metrics: Object.fromEntries(Object.entries(window.__PANDOLAB_GPU_METRICS__)
        .filter(([key]) => key.startsWith('terrain') || ['p99CpuSubmitMs', 'effectivePixelRatio', 'interactionActive'].includes(key))),
      view: window.__PANDOLAB_VIEW_DEBUG__.snapshot(),
      uploads: window.__PANDOLAB_RENDER_DEBUG__.snapshot().uploads,
    }))));
    throw error;
  } finally { release(); }
});
}
