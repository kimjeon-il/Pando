import { expect, test } from '@playwright/test';

test.use({ trace: 'off' });

test('selection domain drives country editing, multi-selection, and independent hover revisions', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  await expect.poll(() => page.evaluate(() => typeof window.PANDOLAB_TERRITORIAL?.select === 'function')).toBe(true);

  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('country', 'DEU'));
  await expect(page.locator('#propertyTypeLabel')).toHaveText('국가');
  await expect(page.locator('#countryProperties')).toBeVisible();
  await expect(page.locator('#actionsTabBtn')).toBeVisible();
  await expect(page.locator('#editBorderBtn')).toHaveCount(1);

  const search = page.locator('#layerSearchInput');
  await search.fill('프랑스');
  const franceRow = page.locator('#layerSearchResults [data-layer-item-select="countries"][data-item-id="FRA"]');
  await expect(franceRow).toHaveCount(1);
  await franceRow.click({ modifiers: ['Control'] });

  await expect(page.locator('#multiSelectionBar, #multiSelectionModeBtn, #clearMultiSelectionBtn')).toHaveCount(0);
  await expect(page.locator('#multiProperties')).toBeVisible();
  expect(errors).toEqual([]);
});
