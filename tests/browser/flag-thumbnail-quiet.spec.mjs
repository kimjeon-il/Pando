import { expect, test } from '@playwright/test';

test('flag thumbnail keeps its aspect ratio without hover highlight', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 60_000 });
  await page.getByRole('button', { name: '레이어', exact: true }).click();
  await page.getByRole('searchbox', { name: '레이어 검색' }).fill('독일');
  await page.getByRole('button', { name: '독일 국가', exact: true }).click();
  const flag = page.locator('#flagMenuBtn');
  await expect(flag).toBeVisible();
  await flag.hover();
  await expect.poll(() => flag.evaluate(el => {
    const style = getComputedStyle(el);
    const image = el.querySelector('img');
    return { background: style.backgroundColor, border: style.borderColor, fit: image && getComputedStyle(image).objectFit };
  })).toEqual({ background: 'rgba(0, 0, 0, 0)', border: 'rgba(0, 0, 0, 0)', fit: 'contain' });
});
