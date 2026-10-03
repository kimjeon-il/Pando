import { expect, test } from '@playwright/test';
import { selectUiOption } from './helpers/ui-select.mjs';

for (const renderer of ['webgl2', 'webgl1', 'canvas']) {
  test(`inherited subunit interior survives add, undo and redo in ${renderer}`, async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => localStorage.setItem('pandolab-user-preferences', JSON.stringify({
      version: 2, selection: { outlineVisible: false, fillStrength: 0 },
    })));
    await page.goto(`/?perf&renderer=${renderer}`);
    await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 120_000 });
    await expect.poll(() => page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__?.snapshot().gpu.renderer))
      .toBe(renderer === 'canvas' ? 'canvas2d' : renderer);
    await page.locator('#gisFileInput').setInputFiles({
      name: 'inherited-fill.geojson', mimeType: 'application/geo+json',
      buffer: Buffer.from(JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature',
        properties: { name: '상속 화면 비교' },
        geometry: { type: 'Polygon', coordinates: [[[9, 50], [9, 51], [10, 51], [10, 50], [9, 50]]] },
      }] })),
    });
    await selectUiOption(page, '#gisTargetType', 'subunit');
    await page.locator('#gisImportNextBtn').click();
    await expect(page.locator('#gisStepIndicator')).toContainText('2/3');
    await expect(page.locator('#gisTargetCountryRow')).toBeVisible();
    await selectUiOption(page, '#gisTargetCountry', 'DEU');
    await page.locator('#gisImportNextBtn').click();
    await expect(page.locator('#gisStepIndicator')).toContainText('3/3');
    await expect(page.locator('#gisImportConfirmBtn')).toBeEnabled({ timeout: 30_000 });
    await page.locator('#gisImportConfirmBtn').click();
    await expect.poll(() => page.evaluate(() => window.PANDOLAB_TERRITORIAL.list({ kind: 'general' }).filter(f => f.properties.parentId)
      .some(unit => unit.properties.name === '상속 화면 비교')), { timeout: 60_000 }).toBe(true);
    const clip = await page.locator('path.territorial-unit-shape').evaluateAll(nodes => {
      const path = nodes.find(node => node.__data__?.properties?.name === '상속 화면 비교');
      if (!path) throw new Error('하위단위 표시 경로가 없습니다.');
      const box = path.getBoundingClientRect();
      return { x: box.x + box.width * 0.25, y: box.y + box.height * 0.25, width: box.width * 0.5, height: box.height * 0.5 };
    });
    expect(clip.width).toBeGreaterThan(2);
    expect(clip.height).toBeGreaterThan(2);
    // Remove only text from the captured interior; territorial and physical fills stay visible.
    await page.addStyleTag({ content: '#map text, #map .map-label, #map .country-label { visibility: hidden !important; }' });
    async function captureStable(name) {
      let prior;
      await expect.poll(async () => {
        const next = await page.screenshot({ clip, animations: 'disabled' });
        const stable = prior?.equals(next) || false;
        prior = next;
        return stable;
      }, { timeout: 30_000, intervals: [500, 1000, 1500] }).toBe(true);
      await testInfo.attach(name, { body: prior, contentType: 'image/png' });
      return prior;
    }
    const added = await captureStable('subunit-added');
    await page.locator('#undoBtn').click();
    await expect.poll(() => page.evaluate(() => window.PANDOLAB_TERRITORIAL.list({ kind: 'general' }).filter(f => f.properties.parentId)
      .some(unit => unit.properties.name === '상속 화면 비교'))).toBe(false);
    const without = await captureStable('without-subunit');
    expect(added.equals(without), 'Interior color and terrain must not change when the inherited child is added').toBe(true);
    await page.locator('#redoBtn').click();
    await expect.poll(() => page.evaluate(() => window.PANDOLAB_TERRITORIAL.list({ kind: 'general' }).filter(f => f.properties.parentId)
      .some(unit => unit.properties.name === '상속 화면 비교'))).toBe(true);
    const restored = await captureStable('subunit-restored');
    expect(restored.equals(without)).toBe(true);
  });
}
