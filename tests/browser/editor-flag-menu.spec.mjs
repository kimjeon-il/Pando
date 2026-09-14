import { expect, test } from '@playwright/test';

test('territorial selection toolbar owns the shared flag menu and explicit editor entry', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto('/');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 60_000 });

  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('country', 'POL'));
  await expect(page.locator('#selectionToolbar')).toBeVisible();
  await expect(page.locator('#rightPanel')).not.toHaveClass(/surface-open/);
  await expect(page.locator('#countryNameInput')).toHaveValue('폴란드');
  await expect(page.locator('#rightPanel #countryNameInput, #rightPanel #flagMenuBtn, #rightPanel #notesInput')).toHaveCount(0);

  const nameInput = page.locator('#countryNameInput');
  const nameChrome = () => nameInput.evaluate(element => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, border: style.borderTopColor, shadow: style.boxShadow };
  });
  expect(await nameChrome()).toEqual({ background: 'rgba(0, 0, 0, 0)', border: 'rgba(0, 0, 0, 0)', shadow: 'none' });
  await nameInput.focus();
  const focusedNameChrome = await nameChrome();
  expect(focusedNameChrome.background).not.toBe('rgba(0, 0, 0, 0)');
  expect(focusedNameChrome.border).not.toBe('rgba(0, 0, 0, 0)');
  expect(focusedNameChrome.shadow).not.toBe('none');
  await nameInput.fill('가');
  const oneCharacterWidth = await nameInput.evaluate(element => element.getBoundingClientRect().width);
  await nameInput.fill('가나');
  const twoCharacterWidth = await nameInput.evaluate(element => element.getBoundingClientRect().width);
  expect(oneCharacterWidth).toBeLessThan(twoCharacterWidth);
  expect(twoCharacterWidth).toBeLessThan(80);
  await nameInput.fill('폴란드');
  await nameInput.press('Tab');
  await expect.poll(nameChrome).toEqual({ background: 'rgba(0, 0, 0, 0)', border: 'rgba(0, 0, 0, 0)', shadow: 'none' });

  const toolbarCenter = async () => page.locator('#selectionToolbar').evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return Math.round(bounds.left + (bounds.width / 2));
  });
  const initialToolbarCenter = await toolbarCenter();
  await expect(page.locator('#selectionToolbarTypeBtn')).toHaveAttribute('data-tooltip', '하위단위로 전환');
  await page.locator('#selectionToolbarTypeBtn').click();
  await expect(page.locator('#territorialTypeModal')).toBeVisible();
  await page.locator('#territorialTypeCancelBtn').click();
  await expect(page.locator('#selectionToolbarEditBtn')).toHaveAttribute('data-tooltip', '편집');
  await page.locator('#selectionToolbarEditBtn').click();
  await expect(page.locator('#rightPanel')).toHaveClass(/surface-open/);
  await expect(page.locator('#selectionToolbarEditBtn')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#selectionToolbarEditBtn')).toHaveAttribute('aria-label', '편집 닫기');
  expect(await toolbarCenter()).toBe(initialToolbarCenter);
  await page.locator('#selectionToolbarEditBtn').click();
  await expect(page.locator('#rightPanel')).not.toHaveClass(/surface-open/);
  await expect(page.locator('#selectionToolbarEditBtn')).toHaveAttribute('aria-expanded', 'false');
  expect(await toolbarCenter()).toBe(initialToolbarCenter);
  await page.locator('#selectionToolbarEditBtn').click();
  await expect(page.locator('#rightPanel')).toHaveClass(/surface-open/);
  await expect(page.locator('#editorObjectHeader')).toBeHidden();
  await page.locator('#objectSearchBtn').click();
  await expect(page.locator('#objectSearchSurface')).toBeVisible();
  expect(await toolbarCenter()).toBe(initialToolbarCenter);
  await page.keyboard.press('Escape');
  await expect(page.locator('#objectSearchSurface')).toBeHidden();
  expect(await toolbarCenter()).toBe(initialToolbarCenter);
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.locator('#mobileCloseRightBtn').click();

  for (const width of [1366, 1024, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator('#selectionToolbar')).toBeVisible();
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
  await (await chooser).setFiles({
    name: 'flag.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="28"><rect width="40" height="28" fill="red"/></svg>'),
  });
  await expect(page.locator('#flagPreview img')).toBeVisible();
  expect(await page.locator('#flagPreview img').evaluate(element => getComputedStyle(element).objectFit)).toBe('contain');

  await page.locator('#flagMenuBtn').click();
  await page.locator('#flagRemoveBtn').click();
  await expect(page.locator('#flagPreview .ui-icon')).toBeVisible();
  await page.locator('#flagMenuBtn').click();
  await expect(page.locator('#flagUploadBtn')).toHaveText('깃발 추가');
  await expect(page.locator('#flagRemoveBtn')).toBeHidden();
});
