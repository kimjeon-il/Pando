import { expect, test } from '@playwright/test';

test('distribution and terrain radios share a quiet row treatment', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 60_000 });
  await page.getByRole('button', { name: '레이어', exact: true }).click();
  await page.getByRole('tab', { name: /지도|표시 설정/, exact: true }).click();
  const rows = page.locator('.terrain-mode-option');
  await expect(rows).toHaveCount(2);
  for (const row of [rows.nth(0), rows.nth(1)]) {
    await row.hover();
    await expect.poll(() => row.evaluate(el => {
      const style = getComputedStyle(el);
      return [style.borderTopWidth, style.backgroundColor, style.borderRadius, style.minHeight];
    })).toEqual(['0px', 'rgba(0, 0, 0, 0)', '0px', '48px']);
  }
  await rows.nth(1).click();
  await expect(rows.nth(1).locator('input')).toBeChecked();
  await expect.poll(() => rows.nth(1).evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
});
