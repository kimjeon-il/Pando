import { expect, test } from '@playwright/test';

test('toggle thumb keeps equal end clearance across states, themes and layouts', async ({ page }) => {
  await page.route('**/toggle-fixture', route => route.fulfill({ contentType: 'text/html', body: `
    <link rel="stylesheet" href="/assets/css/app.css">
    <link rel="stylesheet" href="/assets/css/ui-v2.bundle.css">
    <label class="ui-choice-row ui-toggle"><input type="checkbox"><span>표시</span></label>` }));
  await page.goto('/toggle-fixture');
  const input = page.getByRole('checkbox');
  for (const width of [1366, 1024, 390]) {
    await page.setViewportSize({ width, height: 800 });
    for (const theme of ['light', 'dark']) {
      await page.locator('html').evaluate((el, value) => { el.dataset.theme = value; }, theme);
      for (const checked of [false, true]) {
        await input.setChecked(checked);
        await expect.poll(() => input.evaluate(el => {
          const track = el.getBoundingClientRect();
          const thumb = getComputedStyle(el, '::before');
          const vertical = (track.height - parseFloat(thumb.height)) / 2;
          const horizontal = el.checked ? track.width - parseFloat(thumb.left) - parseFloat(thumb.width) : parseFloat(thumb.left);
          return Math.abs(horizontal - vertical);
        })).toBeLessThan(0.1);
        const size = await input.boundingBox();
        expect(size.width).toBe(36);
        expect(size.height).toBe(20);
        if (width < 800) expect((await page.locator('label').boundingBox()).height).toBeGreaterThanOrEqual(48);
      }
    }
  }
});
