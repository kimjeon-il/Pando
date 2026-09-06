import { test, expect } from '@playwright/test';

test('library title occupies the flexible column and close button stays right', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  await page.locator('#createMenuBtn').click();
  await page.locator('#createLibraryTabBtn').click();
  await page.locator('#addFromLibraryBtn').click();
  const title = page.locator('#historicalLibraryTitle');
  await expect(title).toBeVisible();
  await expect(title).toHaveText('국가·지역 라이브러리');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(async () => title.evaluate(el => {
      const header = el.closest('header').getBoundingClientRect();
      const text = el.getBoundingClientRect();
      const close = document.getElementById('historicalLibraryCloseBtn').getBoundingClientRect();
      return text.width > 180 && text.height < 60 && close.x >= text.right
        && close.right <= header.right + 1 && close.y < text.bottom;
    })).toBe(true);
  }
  await page.locator('#historicalLibraryCloseBtn').click();
  await expect(page.locator('#historicalLibraryModal')).toBeHidden();
  expect(errors).toEqual([]);
});
