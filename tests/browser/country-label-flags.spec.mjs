import { test, expect } from '@playwright/test';

test('country flags zoom with labels and preserve selection and missing-flag fallback', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  const flags = page.locator('.country-label-flag[href]');
  await expect(flags).toHaveCount(0);
  for (let i = 0; i < 5; i++) await page.locator('#zoomInBtn').click();
  await expect.poll(() => flags.count()).toBeGreaterThan(0);
  const first = flags.first();
  await expect(first).toHaveAttribute('preserveAspectRatio', 'xMidYMid meet');
  const id = await first.evaluate(el => el.parentNode.__data__.id);
  await page.evaluate(id => window.PANDOLAB_TERRITORIAL.select('country', id), id);
  await expect(page.locator('#countryProperties')).toBeVisible();
  await page.locator('#flagRemoveBtn').click();
  await expect.poll(() => flags.evaluateAll((images, id) => images.some(el => el.parentNode.__data__.id === id), id)).toBe(false);
  await expect(page.locator('.country-label-item').filter({ hasText: await page.locator('#countryNameInput').inputValue() }).first()).toBeAttached();
  expect(errors).toEqual([]);
});
