import { expect, test } from '@playwright/test';
import { selectUiOption } from './helpers/ui-select.mjs';

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
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 30_000 });

  await page.locator('#createMenuBtn').click();
  await page.locator('#addFromLibraryBtn').click();
  await expect(page.locator('#historicalLibraryModal')).toBeVisible();
  await expect.poll(() => page.locator('#historicalLibraryResults [data-library-entity-id]').count()).toBeGreaterThan(200);

  await page.locator('#historicalLibrarySearchInput').fill('USSR');
  await page.locator('.historical-library-filters summary').click();
  await selectUiOption(page, '#historicalLibraryStatusInput', 'past');
  await page.locator('#historicalLibraryYearInput').fill('1991');
  const result = page.locator('[data-library-entity-id="historical-country:soviet-union"]');
  await expect(result).toBeVisible();
  await result.click();
  await expect(page.locator('#historicalLibraryPreview')).toContainText('소련');
  await page.locator('#historicalLibraryPreview details summary').click();
  await expect(page.locator('#historicalLibraryPreview details')).toContainText('신뢰도');
  await expect(page.locator('#historicalLibraryPreview details')).toContainText('low');
  await expect(page.locator('#historicalLibraryPreview details')).toContainText('기능 시험용 근사 경계');
  await expect(page.locator('#historicalLibraryPreview svg path')).toHaveCount(1);

  const originalGeometry = await page.evaluate(() => JSON.stringify(
    window.PANDOLAB_HISTORICAL_LIBRARY.get('historical-country:soviet-union').geometryVersions[0].geometry,
  ));
  await page.locator('#historicalLibraryAddBtn').click();
  await expect(page.locator('#historicalLibraryAddOptions')).toBeVisible();
  await expect(page.locator('#historicalLibraryAddBtn')).toHaveText('추가 확정');
  await page.locator('#historicalLibraryAddBtn').click();
  await expect(page.locator('#historicalLibraryModal')).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.PANDOLAB_TERRITORIAL.list({ type: 'country' })
    .filter(unit => unit.properties.sourceLibraryId === 'historical-country:soviet-union').length)).toBe(1);
  const instanceId = await page.evaluate(() => window.PANDOLAB_TERRITORIAL.list({ type: 'country' })
    .find(unit => unit.properties.sourceLibraryId === 'historical-country:soviet-union')?.id);
  expect(instanceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  const sourceAfterEdit = await page.evaluate(() => JSON.stringify(
    window.PANDOLAB_HISTORICAL_LIBRARY.get('historical-country:soviet-union').geometryVersions[0].geometry,
  ));
  expect(sourceAfterEdit).toBe(originalGeometry);

  await page.locator('#undoBtn').click();
  await expect.poll(() => page.evaluate(() => window.PANDOLAB_TERRITORIAL.list({ type: 'country' })
    .filter(unit => unit.properties.sourceLibraryId === 'historical-country:soviet-union').length)).toBe(0);
  expect(errors).toEqual([]);
});
