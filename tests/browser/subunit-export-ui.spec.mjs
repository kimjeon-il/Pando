import { test, expect } from '@playwright/test';

test('GIS export shows one subunit choice and counts subunit-only selection', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  await page.locator('#mobileFileBtn').click();
  await page.locator('#dataExportBtn').click();
  const choices = page.locator('.gis-export-layers input');
  await expect(choices).toHaveCount(6);
  await expect(page.locator('.gis-export-layers label').filter({ hasText: '하위단위' })).toHaveCount(1);
  for (const input of await choices.all()) await input.uncheck();
  await page.locator('.gis-export-layers input[value="subunits"]').check();
  await page.locator('#gisExportNextBtn').click();
  await expect(page.locator('#gisExportModal')).toContainText(/하위단위\s+46개/);
  await expect(page.locator('#gisExportModal')).not.toContainText('생성할 데이터 없음');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#gisExportConfirmBtn')).toBeVisible();
});
