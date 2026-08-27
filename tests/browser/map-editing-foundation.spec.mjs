import { expect, test } from '@playwright/test';

async function openApp(page, viewport) {
  await page.setViewportSize(viewport);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/');
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  return errors;
}

async function addMeasurementPoints(page) {
  const box = await page.locator('#map').boundingBox();
  await page.mouse.click(box.x + box.width * 0.46, box.y + box.height * 0.48);
  await page.mouse.click(box.x + box.width * 0.56, box.y + box.height * 0.48);
}

test('desktop snapping, measurement, projection overlays, and audit worker share one map surface', async ({ page }) => {
  const errors = await openApp(page, { width: 1440, height: 900 });

  await page.locator('#snapSettingsBtn').click();
  await expect(page.locator('#snapSettingsPanel')).toBeVisible();
  await page.locator('#snapSensitivityInput').selectOption('high');
  await page.locator('#snapSettingsCloseBtn').click();
  await page.locator('#snapSettingsBtn').click();
  await expect(page.locator('#snapSensitivityInput')).toHaveValue('high');
  await page.locator('#snapSettingsCloseBtn').click();

  await page.locator('#measureDistanceBtn').click();
  await expect(page.locator('#measureDistanceBtn')).toHaveAttribute('aria-pressed', 'true');
  await addMeasurementPoints(page);
  await expect(page.locator('.measurement-layer .measurement-shape')).toHaveCount(1);
  await expect(page.locator('.measurement-layer .measurement-shape')).toHaveAttribute('d', /L/);
  await page.locator('#flatBtn').click();
  await expect(page.locator('.measurement-layer .measurement-shape')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.measurement-layer .measurement-shape')).toHaveCount(0);

  await page.locator('#mapAuditBtn').click();
  await expect(page.locator('#mapAuditPanel')).toBeVisible();
  await page.locator('#mapAuditRunBtn').click();
  await expect(page.locator('#mapAuditStatus')).not.toHaveText('검사 중…', { timeout: 90_000 });
  await expect(page.locator('#mapAuditSummary')).not.toBeEmpty();
  expect(errors).toEqual([]);
});

test('mobile exposes the same measurement, audit, and snapping entry points', async ({ page }) => {
  const errors = await openApp(page, { width: 390, height: 844 });
  await expect(page.locator('#app')).toHaveAttribute('data-layout', 'mobile');

  await expect(page.locator('#measureDistanceMobileBtn')).toBeVisible();
  await page.locator('#measureDistanceMobileBtn').click();
  await addMeasurementPoints(page);
  await expect(page.locator('.measurement-layer .measurement-shape')).toHaveCount(1);
  await page.keyboard.press('Escape');

  await page.locator('#snapSettingsMobileBtn').click();
  await expect(page.locator('#snapSettingsPanel')).toBeVisible();
  await page.locator('#snapSettingsCloseBtn').click();
  await page.locator('#mapAuditMobileBtn').click();
  await expect(page.locator('#mapAuditPanel')).toBeVisible();
  expect(errors).toEqual([]);
});
