import { expect, test } from '@playwright/test';
import { gotoEditor } from './helpers/editor-entry.mjs';

async function openEditor(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoEditor(page, '/?debug=1&renderer=canvas&demTerrain=raster');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
}

test('object actions share the canonical menu surface and item semantics', async ({ page }) => {
  test.setTimeout(150_000);
  await openEditor(page);
  const menu = page.locator('#objectActionsMenu');
  const item = menu.locator('#objectFocusMenuBtn');
  await expect(menu).toHaveClass(/ui-menu-surface/);
  await expect(menu).toHaveClass(/ui-menu-list/);
  await expect(item).toHaveClass(/ui-menu-item/);
  await expect(item).toHaveAttribute('role', 'menuitem');
  await menu.evaluate(element => element.classList.remove('hidden'));
  await expect(menu).toBeVisible();
  const style = await item.evaluate(element => ({
    display: getComputedStyle(element).display,
    width: element.getBoundingClientRect().width,
    background: getComputedStyle(element.parentElement).backgroundColor,
  }));
  expect(style.display).toBe('grid');
  expect(style.width).toBeGreaterThan(40);
  expect(style.background).not.toBe('rgba(0, 0, 0, 0)');
  await item.focus();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
});

test('native project setup uses the shared dialog layout at mobile width', async ({ page }) => {
  test.setTimeout(150_000);
  await openEditor(page);
  await page.locator('#mobileFileBtn').click();
  await page.locator('#newProjectBtn').click();
  const dialog = page.locator('#projectSetupDialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveJSProperty('open', true);
  await expect(dialog.locator('.ui-dialog-card')).toHaveCount(1);
  await expect(dialog.locator('.ui-dialog-header')).toContainText('새 프로젝트');
  await expect(dialog.locator('.ui-dialog-actions #projectSetupSubmit')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await dialog.evaluate(element => element.getBoundingClientRect().width)).toBeLessThanOrEqual(390);
  await page.locator('#projectSetupCancel').click();
  await expect(dialog).not.toBeVisible();
});

for (const product of ['viewer', 'editor']) {
  test(product + ' preferences trap focus once and revert the uncommitted theme', async ({ page }) => {
    test.setTimeout(150_000);
    if (product === 'editor') await openEditor(page);
    else {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto('/?debug=1');
      await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready', 'true', { timeout: 120_000 });
    }
    const trigger = page.locator('#preferencesBtn');
    await trigger.click();
    const modal = page.locator('#preferencesModal');
    await expect(modal).toBeVisible();
    const initial = await page.locator('#preferencesThemeInput').inputValue();
    await page.locator('#preferencesApplyBtn').focus();
    await page.keyboard.press('Tab');
    await expect(page.locator('[data-preference-theme="light"]')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('#preferencesApplyBtn')).toBeFocused();
    await page.locator('[data-preference-theme="dark"]').click();
    await expect(page.locator('#preferencesThemeInput')).toHaveValue('dark');
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
    await expect(page.locator('#preferencesThemeInput')).toHaveValue(initial);
    await expect(trigger).toBeFocused();
  });
}
