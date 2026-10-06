import { expect, test } from '@playwright/test';
import { staticAutosaveProject } from '../helpers/timeline-project.mjs';

test.use({ channel: 'chromium', viewport: { width: 1440, height: 900 } });

test('editing a river color updates actual GPU paint and undo restores metadata, geometry and paint', async ({ page }) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(8_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/assets/css/app.css');
  const saved = staticAutosaveProject({
      hydroEdits: [{ type: 'Feature', id: '00000000-0000-4000-8000-000000000005',
        geometry: { type: 'LineString', coordinates: [[5, 45], [8, 46], [10, 45]] },
        properties: { pandolab_schema_version: 1, category: 'river', name: '메타데이터 검증 강', editorColor: '#3b82c4', notes: '', source: 'test', locked: false } }],
  });
  await page.evaluate(saved => localStorage.setItem('pandolab-editor-project', JSON.stringify(saved)), saved);
  await page.goto('/?debug=1');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 30_000 });
  await page.locator('#objectSearchBtn').click();
  await page.locator('#layerSearchInput').fill('메타데이터 검증 강');
  await page.locator('#layerSearchResults .layer-search-result').click();
  await expect(page.locator('#hydroProperties')).toBeVisible();
  await page.locator('#mapDisplayBtn').click();
  await page.locator('#mapProjectionMenuTrigger').click();
  await page.locator('#flatBtn').click();
  for (let index = 0; index < 2 && await page.locator('#mapDisplaySurface').isVisible(); index++) await page.keyboard.press('Escape');
  await expect(page.locator('#mapDisplaySurface')).toBeHidden();
  await page.locator('#focusSelectedObjectBtn').click();
  await page.addStyleTag({ content: '#map .map-selection-outline, #map .map-selection-fill { visibility: hidden !important; }' });
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpu.hydroEditBatchCount)).toBe(1);
  const originalColor = await page.locator('#hydroColorInput').inputValue();
  const original = await page.locator('path.hydro-edit-shape').evaluate(node => structuredClone(node.__data__));
  const colorPixels = async color => {
    const screenshot = (await page.screenshot()).toString('base64');
    return page.evaluate(async ({ screenshot, color }) => {
      const image = new Image(); image.src = `data:image/png;base64,${screenshot}`; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(image, 0, 0);
      const map = document.querySelector('#map').getBoundingClientRect();
      const point = window.__PANDOLAB_VIEW_DEBUG__.geoToScreen([8, 46]);
      const pixels = context.getImageData(Math.round(map.x + point[0]) - 20, Math.round(map.y + point[1]) - 20, 40, 40).data;
      const expected = [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16));
      let count = 0;
      for (let index = 0; index < pixels.length; index += 4) if (expected.every((value, channel) => Math.abs(pixels[index + channel] - value) <= 8)) count++;
      return count;
    }, { screenshot, color });
  };
  await expect.poll(() => colorPixels(originalColor)).toBeGreaterThan(0);
  const before = await page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpu.hydroEditRevision);
  await page.locator('#hydroColorTrigger').click();
  const swatch = page.locator(`#hydroColorPopover [data-color-value]:not([data-color-value="${originalColor}"])`).first();
  const nextColor = await swatch.getAttribute('data-color-value');
  await swatch.click();
  await expect(page.locator('#hydroColorInput')).toHaveValue(nextColor);
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpu.hydroEditRevision)).toBe(before + 1);
  await expect.poll(() => colorPixels(nextColor)).toBeGreaterThan(0);
  await page.locator('#undoBtn').click();
  await expect(page.locator('#hydroProperties')).toBeHidden();
  await page.locator('#objectSearchBtn').click();
  await page.locator('#layerSearchInput').fill('메타데이터 검증 강');
  await page.locator('#layerSearchResults .layer-search-result').click();
  await expect(page.locator('#hydroColorInput')).toHaveValue(originalColor);
  expect(await page.locator('path.hydro-edit-shape').evaluate(node => node.__data__)).toEqual(original);
  await expect.poll(() => colorPixels(originalColor)).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
