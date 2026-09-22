import { expect, test } from '@playwright/test';

test('territorial selection appears as a label-anchored card and enters the editor from its body', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto('/');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 60_000 });
  const slotPointerEvents = await page.locator('.selection-toolbar-slot').evaluate(node => getComputedStyle(node).pointerEvents);
  expect(slotPointerEvents).toBe('none');

  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('country', 'DEU'));
  await expect(page.locator('#selectionToolbar')).toBeVisible();
  await expect.poll(() => page.locator('#selectionToolbar').evaluate(node => getComputedStyle(node).pointerEvents)).toBe('auto');
  await expect(page.locator('#editorSurface')).not.toHaveClass(/surface-open/);
  await expect(page.locator('#selectionCardName')).toHaveText('독일');
  await expect(page.locator('#selectionCardFlagPreview')).toBeVisible();
  await expect(page.locator('g.country-label-item.selection-card-source-hidden')).toHaveCount(1);
  await expect(page.locator('#editorSurface #countryNameInput, #editorSurface #flagMenuBtn')).toHaveCount(2);
  await expect(page.locator('#editorSurface #notesInput')).toHaveCount(1);
  await expect(page.locator('#selectionToolbar #objectVisibilityBtn, #selectionToolbar #objectLockBtn')).toHaveCount(2);
  await expect(page.locator('#editorSurface .surface-header-actions #objectVisibilityBtn, #editorSurface .surface-header-actions #objectLockBtn, #editorSurface .surface-header-actions #objectDeleteBtn')).toHaveCount(0);

  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('country', 'BGR'));
  await expect(page.locator('#selectionCardName')).toHaveText('불가리아');
  const bulgariaPosition = await page.locator('#selectionToolbar').boundingBox();
  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('country', 'RUS'));
  await expect(page.locator('#selectionCardName')).toHaveText('러시아');
  const russiaPosition = await page.locator('#selectionToolbar').boundingBox();
  expect(Math.hypot(
    russiaPosition.x - bulgariaPosition.x,
    russiaPosition.y - bulgariaPosition.y,
  )).toBeGreaterThan(20);

  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('country', 'DEU'));
  await expect(page.locator('#selectionCardName')).toHaveText('독일');

  await page.locator('#selectionToolbarEditBtn').click();
  await expect(page.locator('#editorSurface')).toHaveClass(/surface-open/);
  await expect(page.locator('#editorSurface #changeCountryTypeBtn')).toHaveCount(1);
  await expect(page.locator('#editorObjectHeader')).toBeVisible();
  await expect(page.locator('#selectionToolbar')).toBeHidden();
  await expect(page.locator('g.country-label-item.selection-card-source-hidden')).toHaveCount(0);
  await expect(page.locator('#editorTabBtn')).toBeVisible();
  await expect(page.locator('#actionsTabBtn')).toBeVisible();
  await expect(page.locator('#relationTabBtn')).toBeVisible();
  await expect(page.locator('#editorSurface')).not.toHaveAttribute('data-editor-inline-relation', 'true');
  await expect(page.locator('#countryProperties > .editor-info-section')).toHaveAttribute('aria-label', '정보');
  await expect(page.locator('#countryProperties > .editor-action-section:not(.editor-relation-section)')).toHaveAttribute('aria-label', '편집');
  await expect(page.locator('#countryProperties > .editor-relation-section')).toHaveAttribute('aria-label', '관계');
  await expect(page.locator('#countryProperties > .editor-section > .editor-section-title')).toHaveCount(0);
  await page.locator('#relationTabBtn').click();
  await expect(page.locator('#changeCountryTypeBtn')).toBeVisible();
  await expect(page.locator('#annexTerritoryBtn')).toBeHidden();
  await expect(page.locator('#countryNameInput')).toBeHidden();
  await page.locator('#editorTabBtn').click();
  await expect(page.locator('#countryNameInput')).toBeVisible();
  await expect(page.locator('#changeCountryTypeBtn')).toBeHidden();
  for (const width of [1366, 1024, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator('#flagMenuBtn')).toBeVisible();
    await page.locator('#flagMenuBtn').click();
    await expect(page.locator('#flagMenu')).toBeVisible();
    await expect(page.locator('#flagLibraryBtn')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('#flagMenu')).toBeHidden();
    await expect(page.locator('#flagMenuBtn')).toBeFocused();
  }

  await page.locator('#flagMenuBtn').click();
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#flagUploadBtn').click();
  await (await chooser).setFiles({
    name: 'flag.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="28"><rect width="40" height="28" fill="red"/></svg>'),
  });
  await expect(page.locator('#selectionCardFlagPreview img')).toHaveCount(1);
  expect(await page.locator('#selectionCardFlagPreview img').evaluate(element => getComputedStyle(element).objectFit)).toBe('contain');

  await page.locator('#flagMenuBtn').click();
  await page.locator('#flagRemoveBtn').click();
  await expect(page.locator('#selectionCardFlagPreview .ui-icon')).toHaveCount(1);
  await page.locator('#flagMenuBtn').click();
  await expect(page.locator('#flagMenu')).toHaveClass(/ui-command-menu/);
  await expect(page.locator('#flagMenu .ui-menu-item')).toHaveCount(4);
  await expect(page.locator('#flagUploadBtn')).toHaveText('파일');
  await expect(page.locator('#flagDefaultBtn')).toBeEnabled();
  await expect(page.locator('#flagRemoveBtn')).toBeDisabled();
});
