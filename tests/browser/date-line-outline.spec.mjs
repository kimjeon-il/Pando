import { expect, test } from '@playwright/test';

test('date-line country selection stays lightweight during selection and navigation', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?debug=1');
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  await page.waitForTimeout(800);

  for (const id of ['RUS']) {
    const before = await page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot());
    await page.evaluate(countryId => window.PANDOLAB_TERRITORIAL.select('country', countryId), id);
    await expect(page.locator('.selection-overlay-layer .map-selection-shape')).toHaveCount(0);
    await page.waitForTimeout(80);

    const after = await page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot());
    expect(after.selection.pathCount).toBe(0);
    expect(after.selection.pathCharacterCount).toBe(0);
    expect(after.gpu.emphasizedCountryCount).toBeGreaterThanOrEqual(1);
    expect(after.fullRenderCount - before.fullRenderCount, JSON.stringify({ before, after })).toBeLessThanOrEqual(1);
    expect(after.labelLayoutCount - before.labelLayoutCount).toBeLessThanOrEqual(1);
  }

  const mapBox = await page.locator('#map').boundingBox();
  expect(mapBox).not.toBeNull();
  await page.mouse.move(mapBox.x + mapBox.width * 0.45, mapBox.y + mapBox.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(mapBox.x + mapBox.width * 0.52, mapBox.y + mapBox.height * 0.55, { steps: 4 });
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpu.activeMeshQuality)).toBe('preview');
  await page.mouse.up();
  await page.waitForTimeout(400);
  const settled = await page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot());
  expect(settled.gpu.activeMeshQuality, JSON.stringify(settled)).toBe('canonical');
});
