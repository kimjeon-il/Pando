import { expect, test } from '@playwright/test';

async function openApp(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/');
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'canonical', { timeout: 30_000 });
  await expect(page.locator('#map .map-svg')).toBeVisible();
  return errors;
}

test('a language layer stores a region share and survives undo and redo', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = await openApp(page);

  await page.locator('#createMenuBtn').click();
  page.once('dialog', dialog => dialog.accept('그리스어'));
  await page.locator('#addLanguageBtn').click();
  await expect(page.locator('#distributionProperties')).toBeVisible();
  await expect(page.locator('#distributionTypeValue')).toHaveText('언어');

  const regionId = await page.locator('#distributionRegionInput option').nth(1).getAttribute('value');
  expect(regionId).toBeTruthy();
  await page.locator('#distributionRegionInput').selectOption(regionId);
  await page.locator('#distributionShareInput').fill('95');
  await page.locator('#addRegionDistributionBtn').click();

  await expect(page.locator('#distributionEntryList .distribution-entry-row')).toHaveCount(1);
  await expect(page.locator('#map path.distribution-shape')).toHaveCount(1);
  const stored = await page.evaluate(() => {
    const layer = window.PANDOLAB_DISTRIBUTIONS.listLayers('language')[0];
    return { layer, entries: window.PANDOLAB_DISTRIBUTIONS.listEntries(layer.id) };
  });
  expect(stored.layer.name).toBe('그리스어');
  expect(stored.entries).toHaveLength(1);
  expect(stored.entries[0]).toMatchObject({ mode: 'region', regionId, share: 95 });

  await page.locator('#undoBtn').click();
  await expect(page.locator('#map path.distribution-shape')).toHaveCount(0);
  await page.locator('#redoBtn').click();
  await expect(page.locator('#map path.distribution-shape')).toHaveCount(1);
  expect(errors).toEqual([]);
});
