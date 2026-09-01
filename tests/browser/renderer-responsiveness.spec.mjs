import { expect, test } from '@playwright/test';

test.use({ trace: 'off' });

async function openEnhanced(page, query = '?perf') {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(`/${query}`);
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 120_000 });
  await expect.poll(() => page.evaluate(() => !!window.__PANDOLAB_RENDER_DEBUG__)).toBe(true);
  return errors;
}

test('pan and zoom frames do not rebuild or upload country palettes', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await openEnhanced(page);
  await page.waitForFunction(() => {
    const count = window.__PANDOLAB_RENDER_DEBUG__.snapshot().fullRenderCount;
    const now = performance.now();
    const prior = window.__PANDOLAB_TEST_FULL_RENDER_STABILITY__;
    if (!prior || prior.count !== count) {
      window.__PANDOLAB_TEST_FULL_RENDER_STABILITY__ = { count, changedAt: now };
      return false;
    }
    return now - prior.changedAt >= 2500;
  }, null, { timeout: 30_000 });
  const before = await page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot());
  const mapBox = await page.locator('#map .map-svg').boundingBox();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  const start = { x: mapBox.x + mapBox.width / 2, y: mapBox.y + mapBox.height / 2 };
  const touchPoint = (x, y) => [{ id: 1, x, y, radiusX: 1, radiusY: 1, force: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touchPoint(start.x, start.y) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: touchPoint(start.x + 48, start.y + 20) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.evaluate(() => {
    for (let index = 0; index < 6; index += 1) document.querySelector('#zoomInBtn').click();
  });
  await page.waitForTimeout(250);
  const after = await page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot());
  expect(after.gpu.paletteRebuildCount).toBe(before.gpu.paletteRebuildCount);
  expect(after.gpu.paletteUploadCount).toBe(before.gpu.paletteUploadCount);
  expect(after.gpu.frameContextBuildCount).toBeGreaterThan(before.gpu.frameContextBuildCount);
  expect(after.fullRenderCount).toBe(before.fullRenderCount);
  expect(after.viewRenderCount).toBeGreaterThan(before.viewRenderCount);
  expect(after.distributionRows.rebuildCount).toBe(before.distributionRows.rebuildCount);
  expect(after.territorialBoundaryTopologyRebuildCount).toBe(before.territorialBoundaryTopologyRebuildCount);
  expect(errors).toEqual([]);
});

test('forced WebGL1 also keeps country palettes stable while zooming', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await openEnhanced(page, '?perf&renderer=webgl1');
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpu.renderer)).toBe('webgl1');
  const before = await page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpu);
  await page.evaluate(() => {
    for (let index = 0; index < 3; index += 1) document.querySelector('#zoomInBtn').click();
  });
  await page.waitForTimeout(250);
  const after = await page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpu);
  expect(after.paletteRebuildCount).toBe(before.paletteRebuildCount);
  expect(after.paletteUploadCount).toBe(before.paletteUploadCount);
  expect(errors).toEqual([]);
});

test('Canvas pan and zoom sends view updates without resending style state', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await openEnhanced(page, '?perf&renderer=canvas');
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpu.renderer)).toMatch(/canvas/);
  await expect.poll(() => page.evaluate(() => {
    const gpu = window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpu;
    return !gpu.canvasWorkerBusy && gpu.displayedRevision === gpu.requestedRevision;
  }), { timeout: 20_000 }).toBe(true);
  await page.waitForTimeout(500);
  const before = await page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpu);
  await page.evaluate(() => {
    for (let index = 0; index < 6; index += 1) document.querySelector('#zoomInBtn').click();
  });
  await expect.poll(
    () => page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpu.canvasWorkerViewMessageCount),
    { timeout: 20_000 },
  ).toBeGreaterThan(before.canvasWorkerViewMessageCount);
  const after = await page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpu);
  expect(after.canvasWorkerViewMessageCount).toBeGreaterThan(before.canvasWorkerViewMessageCount);
  expect(after.canvasWorkerMessagesByType.style || 0).toBe(before.canvasWorkerMessagesByType.style || 0);
  expect(after.canvasWorkerMessagesByType['physical-style'] || 0).toBe(before.canvasWorkerMessagesByType['physical-style'] || 0);
  expect(errors).toEqual([]);
});

test('Canvas2D fallback renders a view frame without Worker support', async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    Object.defineProperty(window, 'OffscreenCanvas', { configurable: true, value: undefined });
  });
  const errors = await openEnhanced(page, '?perf&renderer=canvas');
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpu.renderer)).toBe('canvas2d');
  const before = await page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpu.displayedRevision);
  await page.evaluate(() => document.querySelector('#zoomInBtn').click());
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpu.displayedRevision)).toBeGreaterThan(before);
  await expect(page.locator('#map .gpu-map-canvas')).toBeVisible();
  expect(errors).toEqual([]);
});
