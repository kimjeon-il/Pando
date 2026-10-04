import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 1100, height: 760 }, trace: 'off',
  launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'] } });

test('western Pacific stays blue while land tint is still loading', async ({ page, baseURL }) => {
  test.setTimeout(150_000);
  let releaseTint;
  const tintGate = new Promise(resolve => { releaseTint = resolve; });
  const timings = [], started = new Map(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/\/\d+\/\d+-\d+\.webp/.test(request.url())) started.set(request.url(), Date.now()); });
  page.on('requestfinished', request => {
    if (started.has(request.url())) timings.push({ tile: new URL(request.url()).pathname, ms: Date.now() - started.get(request.url()) });
  });
  await page.route('**/tint.webp*', async route => { await tintGate; if (!page.isClosed()) await route.continue(); });
  await page.addInitScript(() => {
    window.__oceanLoadingPixels = [];
    const prototype = window.WebGL2RenderingContext.prototype, draw = prototype.drawElements;
    prototype.drawElements = function(...args) {
      const result = draw.apply(this, args);
      if (!window.__oceanLoadingSample) return result;
      const program = this.getParameter(this.CURRENT_PROGRAM), land = this.getUniformLocation(program, 'uLandPass');
      if (!land || this.getUniform(program, land) !== 0) return result;
      const point = window.__oceanLoadingSample, viewport = this.getParameter(this.VIEWPORT);
      const rgba = new Uint8Array(4);
      this.readPixels(Math.floor(point[0]), viewport[3] - Math.floor(point[1]) - 1, 1, 1, this.RGBA, this.UNSIGNED_BYTE, rgba);
      window.__oceanLoadingPixels.push([...rgba]);
      if (window.__oceanLoadingPixels.length > 100) window.__oceanLoadingPixels.shift();
      return result;
    };
  });
  try {
    const site = process.env.PANDOLAB_TEST_SITE_URL || `${baseURL}/`;
    await page.goto(new URL('?renderer=webgl2&debug=1', site).href, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
    await page.evaluate(() => {
      const host = window.__PANDOLAB_MAP_HOST__;
      host.setViewState({ projection: 'globe', view: { flatCenter: [0, 0], flatZoom: 1, globeRotation: [-125, -20, 0], globeZoom: 3 } });
      const point = host.project([145, 15]);
      const canvas = document.querySelector('.gpu-map-canvas'), bounds = canvas.getBoundingClientRect();
      window.__oceanLoadingSample = [point[0] * canvas.width / bounds.width, point[1] * canvas.height / bounds.height];
      host.requestRepaint('western-pacific-loading');
    });
    await expect.poll(() => page.evaluate(() => {
      const m = window.__PANDOLAB_GPU_METRICS__;
      return m?.terrainTargetTileCount > 0 && m.terrainTargetTilesLoaded === m.terrainTargetTileCount;
    }), { timeout: 45_000 }).toBe(true);
    expect(await page.evaluate(() => window.__PANDOLAB_GPU_METRICS__.terrainTintReady)).toBe(false);
    console.log(JSON.stringify({ networkTimings: timings, metrics: await page.evaluate(() => {
      const m = window.__PANDOLAB_GPU_METRICS__;
      return { level: m.terrainTargetLevel, loaded: m.terrainTargetTilesLoaded, target: m.terrainTargetTileCount, failures: m.terrainFailureCount };
    }), oceanPixels: await page.evaluate(() => window.__oceanLoadingPixels.slice(-3)) }));
    await expect.poll(() => page.evaluate(() => window.__oceanLoadingPixels.some(p => p[3] && p[2] > p[0] + 15)), { timeout: 5_000 }).toBe(true);
    await page.screenshot({ path: test.info().outputPath('western-pacific-without-land-tint.png') });
    expect(errors).toEqual([]);
  } finally { releaseTint(); }
});
