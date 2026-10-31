import { gotoEditor } from './helpers/editor-entry.mjs';
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
  await gotoEditor(page, '/?demTerrain=raster');
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  await expect.poll(() => page.evaluate(() => typeof window.PANDOLAB_TERRITORIAL?.select === 'function')).toBe(true);

  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('DEU'));
  await expect(page.locator('#propertyTypeLabel')).toHaveText('객체');
  await expect(page.locator('#entityProperties')).toBeVisible();
  await expect(page.locator('#actionsTabBtn')).toBeVisible();
  await expect(page.locator('#editEntityBorderBtn')).toHaveCount(1);

  const search = page.locator('#objectSearchInput');
  if (!await search.isVisible()) await page.locator('#objectSearchBtn').click();
  await search.fill('프랑스');
  const franceRow = page.locator('#objectSearchResults [data-object-search-select="countries"][data-item-id="FRA"]');
  await expect(franceRow).toHaveCount(1);
  await franceRow.click({ modifiers: ['Control'] });

  await expect(page.locator('#multiSelectionBar, #multiSelectionModeBtn, #clearMultiSelectionBtn')).toHaveCount(0);
  await expect(page.locator('#multiProperties')).toBeVisible();
  await expect(page.locator('#propertyTitle')).toHaveText('2개 선택');
  await expect(page.locator('#multiPropertiesColorLabel')).toHaveText('색상');
  await page.locator('#actionsTabBtn').click();
  await expect(page.locator('#multiBorderEditBtn')).toBeVisible();
  await expect(page.locator('#multiBorderEditBtn')).toHaveText('국경 조정');
  await expect(page.locator('#multiBorderEditBtn small')).toBeEmpty();
  await expect(page.locator('#multiSubunitMergeBtn')).toBeHidden();
  if (await page.locator('#multiBorderEditBtn').isEnabled()) {
    await expect(page.locator('#multiBorderEditHelp')).toBeHidden();
    await expect(page.locator('#multiBorderEditBtn')).toHaveAttribute('data-tooltip', '국경 조정');
  } else {
    await expect(page.locator('#multiBorderEditHelp')).toBeVisible();
    await expect(page.locator('#multiBorderEditHelp')).not.toBeEmpty();
    await expect(page.locator('#multiBorderEditBtn')).toHaveAttribute('aria-describedby', 'multiBorderEditHelp');
  }
  expect(errors).toEqual([]);
});
