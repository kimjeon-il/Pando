import { expect, test } from '@playwright/test';
import { selectUiOption } from './helpers/ui-select.mjs';
import { openLibrary, refuseFiniteActivation } from './helpers/library-state.mjs';

test('historical library search previews a sourced country and rejects finite activation atomically', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const errors = await openLibrary(page);
  await expect.poll(() => page.locator('#historicalLibraryResults [data-library-entity-id]').count()).toBeGreaterThan(200);
  await expect(page.locator('[data-library-entity-id="current-country:DEU"] .historical-library-result-flag img')).toHaveCount(1);
  await page.locator('#historicalLibrarySearchInput').fill('USSR');
  await expect(page.locator('.historical-library-filters summary')).toHaveCount(0);
  await selectUiOption(page, '#historicalLibraryStatusInput', 'past');
  await page.locator('#historicalLibraryYearInput').fill('1991');
  const result = page.locator('[data-library-entity-id="historical-country:soviet-union"]');
  await result.click();
  await expect(result.locator('.historical-library-result-flag img')).toHaveCount(1);
  await expect(page.locator('#historicalLibraryPreview')).toContainText('소련');
  await expect(page.locator('#historicalLibraryPreview')).toContainText('근사 경계');
  await expect(page.locator('#historicalLibraryPreview')).toBeHidden();
  await expect(result).not.toHaveAttribute('aria-controls');
  await expect(page.locator('#historicalLibraryPreview a[aria-label^="출처"]')).toHaveCount(0);
  await expect(page.locator('#historicalLibraryPreview svg path')).toHaveCount(0);
  await refuseFiniteActivation(page, testInfo, 'historical-country:soviet-union', errors);
});

test('North Schleswig 1900 remains searchable and finite activation preserves Denmark and source', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const errors = await openLibrary(page);
  await page.locator('#historicalLibrarySearchInput').fill('북슐레스비히');
  await page.locator('#historicalLibraryYearInput').fill('1900');
  const result = page.locator('[data-library-entity-id="historical-country:north-schleswig"]');
  await expect(result.locator('.historical-library-result-flag img')).toHaveCount(1);
  await result.click();
  await expect(page.locator('#historicalLibraryPreview')).toContainText('북슐레스비히');
  await refuseFiniteActivation(page, testInfo, 'historical-country:north-schleswig', errors);
});

test('East Germany finite activation preserves identity, archive, history, save and original source', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const errors = await openLibrary(page);
  await page.locator('#historicalLibrarySearchInput').fill('동독');
  await page.locator('[data-library-entity-id="historical-country:deutsche-demokratische-republik"]').click();
  await expect(page.locator('#historicalLibraryPreview')).toBeHidden();
  await expect(page.locator('#historicalLibraryPreview details')).toHaveCount(0);
  await expect(page.locator('#historicalLibraryPreview svg path')).toHaveCount(0);
  await refuseFiniteActivation(page, testInfo, 'historical-country:deutsche-demokratische-republik', errors);
});
