import { expect, test } from '@playwright/test';

test('country header owns the flag preview and accessible editing menu', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto('/');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 60_000 });
  await page.locator('#layerSearchInput').fill('폴란드');
  await page.locator('.layer-search-result').filter({ hasText: '폴란드' }).first().locator('.layer-child-name').click();
  await expect(page.locator('#editorObjectHeader #flagMenuBtn')).toBeVisible();
  await expect(page.locator('.editor-flag-section')).toHaveCount(0);
  for (const width of [1366, 1024, 390]) {
    await page.setViewportSize({ width, height: 900 });
    if (width < 800 && !await page.locator('#flagMenuBtn').isVisible()) await page.locator('#mobileEditBtn').click();
    await page.locator('#flagMenuBtn').click();
    await expect(page.locator('#flagMenu')).toBeVisible();
    await expect(page.locator('#flagUploadBtn')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('#flagMenu')).toBeHidden();
    await expect(page.locator('#flagMenuBtn')).toBeFocused();
  }
  await page.locator('#flagMenuBtn').click();
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#flagUploadBtn').click();
  await (await chooser).setFiles({ name: 'flag.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="28"><rect width="40" height="28" fill="red"/></svg>') });
  await expect(page.locator('#flagPreview img')).toBeVisible();
  expect(await page.locator('#flagPreview img').evaluate(el => getComputedStyle(el).objectFit)).toBe('contain');
  await page.locator('#flagMenuBtn').click();
  await page.locator('#flagRemoveBtn').click();
  await expect(page.locator('#flagPreview .ui-icon')).toBeVisible();
  await expect(page.locator('#propertyTitle')).toContainText('폴란드');
  await page.locator('#flagMenuBtn').click();
  await expect(page.locator('#flagUploadBtn')).toHaveText('국기 추가');
  await expect(page.locator('#flagRemoveBtn')).toBeHidden();
});
