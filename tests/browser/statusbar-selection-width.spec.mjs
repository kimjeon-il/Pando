import { expect, test } from '@playwright/test';

test('mobile selection uses remaining statusbar width for the full area and truncates only when necessary', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?renderer=canvas');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 60_000 });
  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('TUR'));
  const text = page.locator('#selectionStatus');
  await expect(text).toHaveText(/튀르키예 · 약 [\d,]+ km²/);
  if (await page.locator('#mobileEditBtn').getAttribute('aria-expanded') === 'true') await page.locator('#mobileEditBtn').click();
  await expect(page.locator('#mapBottomStatus')).toBeVisible();
  for (const width of [320, 390, 600]) {
    await page.setViewportSize({ width, height: 844 });
    await expect.poll(() => text.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    const layout = await page.locator('#mapBottomStatus').evaluate(bar => {
      const selection = bar.querySelector('#statusSelection').getBoundingClientRect();
      const inner = bar.querySelector('.status-inner');
      const rect = inner.getBoundingClientRect();
      return { selectionRight: selection.right, availableRight: rect.right - parseFloat(getComputedStyle(inner).paddingRight),
        overflow: inner.scrollWidth > inner.clientWidth };
    });
    expect(Math.abs(layout.selectionRight - layout.availableRight)).toBeLessThan(2);
    expect(layout.overflow).toBe(false);
  }
  await page.locator('#mapBottomStatus').screenshot({ path: testInfo.outputPath('status-area.png') });
  await page.locator('#mobileEditBtn').click();
  await page.locator('#entityNameInput').fill('아주 긴 국가 이름 '.repeat(12));
  await page.locator('#entityNameInput').dispatchEvent('change');
  await page.locator('#mobileEditBtn').click();
  await expect.poll(() => text.evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true);
  await expect(text).toHaveCSS('text-overflow', 'ellipsis');
  expect(await page.locator('#mapBottomStatus .status-inner').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
});
