import { test, expect } from '@playwright/test';
import { createViewerProjectPackage } from '../fixtures/viewer-project-package.mjs';

test.use({ trace: 'off' });

async function scaleTo(page, scale, stats) {
  await expect(page.locator('#map')).not.toHaveClass(/dragging/);
  const current = (await stats()).screenScale;
  await page.locator('#map').evaluate((map, { current, scale }) => {
    const rect = map.getBoundingClientRect();
    map.dispatchEvent(new window.WheelEvent('wheel', { bubbles: true, cancelable: true,
      clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
      deltaY: -Math.log(scale / current) / 0.0013 }));
  }, { current, scale });
  await expect.poll(async () => Math.abs((await stats()).screenScale - scale), { timeout: 15000 }).toBeLessThan(1);
  await expect(page.locator('#map')).not.toHaveClass(/dragging/);
}

for (const setup of [
  { name: 'desktop WebGL', viewport: { width: 1440, height: 900 }, canvas: false },
  { name: 'mobile WebGL', viewport: { width: 390, height: 844 }, canvas: false },
  { name: 'desktop Canvas Worker', viewport: { width: 1440, height: 900 }, canvas: true },
]) test.describe(setup.name, () => {
  test.use({ viewport: setup.viewport, hasTouch: setup.name.startsWith('mobile') });
  test('screen scale governs quality and actual frame governs readiness', async ({ page }) => {
    test.setTimeout(180000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    if (setup.canvas) await page.addInitScript(() => {
      const getContext = window.HTMLCanvasElement.prototype.getContext;
      window.HTMLCanvasElement.prototype.getContext = function(type, ...args) {
        return String(type).includes('webgl') ? null : getContext.call(this, type, ...args);
      };
    });
    await page.goto('/?debug=1');
    await page.waitForFunction(() => !!window.__PANDOLAB_VIEWER__);
    const fixture = await createViewerProjectPackage('지도 준비 검증');
    await page.locator('#projectFileInput').setInputFiles({ name: 'map-readiness.gpkg',
      mimeType: 'application/geopackage+sqlite3', buffer: fixture.bytes });
    await expect.poll(() => page.evaluate(() => window.__PANDOLAB_VIEWER__.documentSnapshot().baseDataset), { timeout: 60000 }).toBe(fixture.project.baseDataset);
    await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready', 'true', { timeout: 120000 });
    const stats = () => page.evaluate(() => window.__PANDOLAB_VIEWER__.rendererStats());
    await expect.poll(async () => (await stats()).canonicalMeshReady, { timeout: 90000 }).toBe(true);
    for (const [scale, band] of [[700, 'high'], [570, 'high'], [500, 'low'], [570, 'low'], [700, 'high']]) {
      await scaleTo(page, scale, stats);
      await expect.poll(async () => (await stats()).scaleBand, { message: `${setup.name} S=${scale}`, timeout: 15000 }).toBe(band);
      expect((await stats()).activeMeshQuality).toBe('canonical');
    }
    const geometry = () => page.evaluate(() => JSON.stringify(window.__PANDOLAB_VIEWER__.documentSnapshot().territorialEntities));
    const beforeDrag = await geometry();
    const box = await page.locator('#map').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 45, box.y + box.height / 2 + 25, { steps: 3 });
    expect((await stats()).activeMeshQuality).toBe('canonical');
    await page.mouse.up();
    expect(await geometry()).toBe(beforeDrag);
    // Turning terrain off excludes its requests from completion without changing editing readiness.
    await page.evaluate(() => {
      document.getElementById('mapDisplayBtn').click();
      const toggle = document.getElementById('terrainNoneRadio');
      if (!toggle) throw new Error('Terrain visibility command is missing');
      toggle.click();
    });
    await expect.poll(async () => (await stats()).mapReadiness.status, { timeout: 15000 }).toBe('ready');
    await expect(page.locator('#mapPreparationStatus')).toContainText('현재 화면 준비 완료');
    expect(errors).toEqual([]);
  });
});
