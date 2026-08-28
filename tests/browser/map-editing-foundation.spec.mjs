import { expect, test } from '@playwright/test';

async function openApp(page, viewport, path = '/') {
  await page.setViewportSize(viewport);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(path);
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  return errors;
}

const removedToolIds = [
  'measureDistanceBtn', 'measureAreaBtn', 'measureDistanceMobileBtn', 'measureAreaMobileBtn',
  'snapSettingsBtn', 'snapSettingsMobileBtn', 'snapSettingsPanel',
  'mapAuditBtn', 'mapAuditMobileBtn', 'mapAuditPanel',
];

test('desktop keeps automatic snapping and area feedback while removed map tools stay absent', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await openApp(page, { width: 1440, height: 900 });

  for (const id of removedToolIds) await expect(page.locator(`#${id}`)).toHaveCount(0);
  await expect(page.locator('.measurement-layer')).toHaveCount(0);
  await expect(page.locator('.snap-indicator-layer')).toHaveCount(1);

  await page.locator('#layerSearchInput').fill('폴란드');
  await page.locator('#layerSearchResults .layer-search-result').first().click();
  await expect(page.locator('#countryAreaValue')).toBeVisible();
  await expect(page.locator('#countryAreaValue')).toContainText('km²');
  await expect(page.locator('#coordStatus')).toBeHidden();
  expect(errors).toEqual([]);
});

test('the full audit remains available only in debug mode', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = await openApp(page, { width: 1440, height: 900 }, '/?debug');
  const panel = page.locator('#debugMapPanel');
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: '전체 지도 검사' }).click();
  await expect(panel.locator('pre')).not.toContainText('audit: running', { timeout: 120_000 });
  await expect(panel.locator('pre')).toContainText('audit:');
  expect(errors).toEqual([]);
});

test('mobile uses the same simplified map surface without removed tool entry points', async ({ page }) => {
  const errors = await openApp(page, { width: 390, height: 844 });
  await expect(page.locator('#app')).toHaveAttribute('data-layout', 'mobile');
  for (const id of removedToolIds) await expect(page.locator(`#${id}`)).toHaveCount(0);
  await expect(page.locator('.measurement-layer')).toHaveCount(0);
  await expect(page.locator('#debugMapPanel')).toBeHidden();
  await expect(page.locator('#coordStatus')).toBeHidden();
  expect(errors).toEqual([]);
});
