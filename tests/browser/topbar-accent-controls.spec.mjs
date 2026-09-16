import { expect, test } from '@playwright/test';

const commandStyle = locator => locator.evaluate(element => {
  const style = getComputedStyle(element);
  return { background: style.backgroundColor, color: style.color, border: style.borderTopColor };
});

test('file uses the same topbar command states and accent actions keep white text', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto('/');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 60_000 });

  const file = page.locator('#mobileFileBtn');
  const view = page.locator('#mapDisplayBtn');
  expect(await commandStyle(file)).toEqual(await commandStyle(view));

  await file.hover();
  await page.waitForTimeout(200);
  const fileHover = await commandStyle(file);
  await view.hover();
  await page.waitForTimeout(200);
  expect(fileHover).toEqual(await commandStyle(view));

  await file.click();
  await expect(file).toHaveAttribute('aria-expanded', 'true');
  await page.waitForTimeout(200);
  expect(await commandStyle(file)).toEqual(fileHover);
  await page.keyboard.press('Escape');

  await page.locator('#preferencesBtn').click();
  await page.locator('[data-preference-accent="#e87924"]').click();
  await expect(page.locator('#preferencesApplyBtn')).toHaveCSS('color', 'rgb(255, 255, 255)');
});
