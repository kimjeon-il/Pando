import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 1366, height: 900 }, trace: 'off', actionTimeout: 10_000, reducedMotion: 'reduce',
  launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'] } });

test('dense connected WebGL strokes preserve visible dash gaps', async ({ page, baseURL }) => {
  const site = process.env.PANDOLAB_TEST_SITE_URL || `${baseURL}/`;
  await page.goto(new URL('assets/js/build-meta.js', site).href);
  const result = await page.evaluate(async site => {
    const { createRenderDevice } = await import(new URL('assets/js/modules/render-device.js', site).href);
    const { createGpuStrokeRenderer } = await import(new URL('assets/js/modules/gpu-stroke-renderer.js', site).href);
    const canvas = new OffscreenCanvas(320, 48);
    const gl = canvas.getContext('webgl2');
    const renderer = createGpuStrokeRenderer();
    if (!renderer.initialize(createRenderDevice({ gl, canvas }))) throw new Error('Stroke initialization failed');
    const segments = [];
    for (let index = 0; index < 800; index++) segments.push(-8 + index * 0.02, 0, -8 + (index + 1) * 0.02, 0);
    gl.viewport(0, 0, 320, 48);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    const drawn = renderer.drawBatches([{ key: 'dense-child', geometryRevision: 1, startsEnds: new Float32Array(segments),
      style: { color: '#ffffff', alpha: 1, width: 3, cap: 'round', join: 'round', dash: [3, 2], antiAlias: false } }],
    { viewport: [320, 48], translate: [160, 24], scale: 1000, rowX: [1, 0, 0], rowY: [0, 1, 0], rowZ: [0, 0, 1],
      flatCenter: [0, 0], mode: 1, worldOffsets: [0] });
    const pixels = new Uint8Array(320 * 4);
    gl.readPixels(0, 24, 320, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const values = Array.from({ length: 260 }, (_, index) => pixels[(index + 30) * 4 + 3] > 127);
    const transitions = values.reduce((count, value, index) => count + Number(index > 0 && value !== values[index - 1]), 0);
    renderer.dispose();
    return { succeeded: drawn.succeeded, transitions, painted: values.filter(Boolean).length };
  }, site);
  expect(result.succeeded).toBe(true);
  expect(result.transitions).toBeGreaterThan(60);
  expect(result.painted).toBeGreaterThan(100);
  expect(result.painted).toBeLessThan(210);
});

for (const renderer of ['webgl2', 'canvas']) {
  test(`Hong Kong and Macao child boundaries survive mode and visibility changes in ${renderer}`, async ({ page }) => {
    test.setTimeout(240_000);
    const errors = [];
    page.on('pageerror', error => { errors.push(error.message); console.log(error.stack); });
    const query = `?debug=1&demTerrain=raster&renderer=${renderer}`;
    await page.goto(process.env.PANDOLAB_TEST_SITE_URL ? new URL(query, process.env.PANDOLAB_TEST_SITE_URL).href : `/${query}`);
    await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
    if (!await page.locator('#layerSearchInput').isVisible()) await page.locator('#objectSearchBtn').click({ timeout: 30_000 });
    await page.locator('#layerSearchInput').fill('홍콩');
    await page.getByRole('button', { name: '홍콩 선택 객체로 이동', exact: true }).click({ timeout: 30_000 });
    await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(() => window.__PANDOLAB_GPU_METRICS__?.activeMeshQuality), { timeout: 60_000 }).toBe('canonical');
    await expect.poll(() => page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__?.snapshot().gpu.countryInternalBoundaryVisibleOwnerIds || []), { timeout: 60_000 }).toContain('HKG');
    const point = await page.evaluate(() => window.__PANDOLAB_VIEW_DEBUG__.geoToScreen([114.15, 22.3]));
    await page.mouse.move(point[0], point[1] + 47);
    await page.mouse.wheel(0, -1800);
    await page.mouse.click(1300, 780);
    await page.mouse.click(1330, 20);
    for (const mode of ['Physical', 'Political', 'None']) {
      await page.mouse.click(1330, 20);
      await page.locator('#mapDisplayBtn').click();
      await page.locator('[data-map-display-row="terrain"]').click();
      await page.locator(`label[for="terrain${mode}Radio"]`).click();
      await page.mouse.click(1330, 20);
      await expect.poll(() => page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__?.snapshot().gpu.countryInternalBoundaryVisibleOwnerIds || []), { timeout: 45_000 }).toContain('HKG');
      expect(errors).toEqual([]);
    }
    await page.mouse.click(1330, 20);
    await page.locator('#mapDisplayBtn').click();
    await page.locator('[data-map-display-row="general"]').click();
    await page.locator('[data-map-display-row="subunits"]').click();
    const boundary = page.locator('[data-layer-style-boundary="subunits"]');
    await boundary.locator('..').click();
    await expect(boundary).not.toBeChecked();
    await expect.poll(() => page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__?.snapshot().gpu.countryInternalBoundaryVisibleOwnerIds || [])).not.toContain('HKG');
    await boundary.locator('..').click();
    await expect(boundary).toBeChecked();
    await expect.poll(() => page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__?.snapshot().gpu.countryInternalBoundaryVisibleOwnerIds || [])).toContain('HKG');
    await page.mouse.click(1330, 20);
    if (!await page.locator('#layerSearchInput').isVisible()) await page.locator('#objectSearchBtn').click({ timeout: 30_000 });
    await page.locator('#layerSearchInput').fill('마카오');
    await page.getByRole('button', { name: '마카오 선택 객체로 이동', exact: true }).click({ timeout: 30_000 });
    await page.keyboard.press('Escape');
    await expect(page.locator('#entityNameInput')).toHaveValue('마카오');
    expect(errors).toEqual([]);
  });
}
