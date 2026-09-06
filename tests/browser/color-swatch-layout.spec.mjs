import { test, expect } from '@playwright/test';

test('palette swatches stay square and inside their grid on desktop and mobile', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('country', 'POL'));
    if (width < 800 && await page.locator('#mobileEditBtn').getAttribute('aria-expanded') !== 'true') {
      await page.locator('#mobileEditBtn').click();
    }
    await page.locator('#countryColorTrigger').click();
    const palette = page.locator('#countryColorPopover');
    await expect(palette).toBeVisible();
    await expect(palette.locator('.ui-color-swatch')).toHaveCount(66);
    await expect.poll(() => palette.locator('.ui-color-swatch-grid').evaluateAll(grids => grids.every(grid => {
      const bounds = grid.getBoundingClientRect();
      const rects = [...grid.querySelectorAll('.ui-color-swatch')].map(node => node.getBoundingClientRect());
      return rects.every((rect, index) => Math.abs(rect.width - rect.height) < 1
        && rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1
        && rects.slice(index + 1).every(other => rect.right <= other.left + 0.1 || other.right <= rect.left + 0.1
          || rect.bottom <= other.top + 0.1 || other.bottom <= rect.top + 0.1));
    }))).toBe(true);
    await palette.screenshot({ path: testInfo.outputPath(`palette-${width}.png`) });
    await palette.locator('[data-color-value="#ef4444"]').click();
    await expect(page.locator('#countryColorInput')).toHaveValue('#ef4444');
  }
  expect(errors).toEqual([]);
});
