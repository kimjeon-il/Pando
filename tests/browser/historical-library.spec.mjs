import { expect, test } from '@playwright/test';

test('historical library search previews and instantiates an independent sourced country', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'canonical', { timeout: 30_000 });

  await page.locator('#createMenuBtn').click();
  await page.locator('#addFromLibraryBtn').click();
  await expect(page.locator('#historicalLibraryModal')).toBeVisible();
  await expect.poll(() => page.locator('#historicalLibraryResults [data-library-entity-id]').count()).toBeGreaterThan(200);

  await page.locator('#historicalLibrarySearchInput').fill('USSR');
  await page.locator('#historicalLibraryStatusInput').selectOption('past');
  await page.locator('#historicalLibraryYearInput').fill('1991');
  const result = page.locator('[data-library-entity-id="historical-country:soviet-union"]');
  await expect(result).toBeVisible();
  await result.click();
  await expect(page.locator('#historicalLibraryPreview')).toContainText('소련');
  await expect(page.locator('#historicalLibraryPreview')).toContainText('신뢰도 low');
  await expect(page.locator('#historicalLibraryPreview')).toContainText('기능 시험용 근사 경계');
  await expect(page.locator('#historicalLibraryPreview svg path')).toHaveCount(1);

  const originalGeometry = await page.evaluate(() => JSON.stringify(
    window.PANDOLAB_HISTORICAL_LIBRARY.get('historical-country:soviet-union').geometryVersions[0].geometry,
  ));
  await page.locator('#historicalLibraryAddBtn').click();
  await expect(page.locator('#historicalLibraryModal')).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.PANDOLAB_TERRITORIAL.list({ type: 'country' })
    .filter(unit => unit.properties.sourceLibraryId === 'historical-country:soviet-union').length)).toBe(1);
  const sourceAfterEdit = await page.evaluate(() => JSON.stringify(
    window.PANDOLAB_HISTORICAL_LIBRARY.get('historical-country:soviet-union').geometryVersions[0].geometry,
  ));
  expect(sourceAfterEdit).toBe(originalGeometry);

  await page.locator('#undoBtn').click();
  await expect.poll(() => page.evaluate(() => window.PANDOLAB_TERRITORIAL.list({ type: 'country' })
    .filter(unit => unit.properties.sourceLibraryId === 'historical-country:soviet-union').length)).toBe(0);
  expect(errors).toEqual([]);
});
