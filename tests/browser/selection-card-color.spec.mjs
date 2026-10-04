import { expect, test } from '@playwright/test';
import { COUNTRY_DEFAULT_COLORS } from '../../assets/js/modules/country-default-colors.js';

test.use({ viewport: { width: 1366, height: 900 }, trace: 'off', actionTimeout: 10_000, launchOptions: { args: [
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox',
] } });

test('country label hover after reload resolves the card color without changing selection or reporting a runtime error', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.stack || error.message));
  const url = process.env.PANDOLAB_TEST_SITE_URL
    ? new URL('?renderer=webgl2&debug=1', process.env.PANDOLAB_TEST_SITE_URL).href : '/?renderer=webgl2&debug=1';
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  const revision = await page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().selectionInput.selectionRevision);
  await page.locator('g.territorial-label-item[data-label-id="DEU"]').hover();
  await expect.poll(() => errors).toEqual([]);
  await expect(page.locator('#selectionToolbar')).toBeVisible();
  await expect(page.locator('#selectionCardName')).toHaveText('독일');
  await expect.poll(() => page.locator('#entityColorTrigger .ui-color-preview')
    .evaluate(node => node.style.getPropertyValue('--swatch-color'))).toBe(COUNTRY_DEFAULT_COLORS.DEU.toLowerCase());
  expect(await page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().selectionInput.selectionRevision)).toBe(revision);
  await expect(page.locator('#editorSurface')).not.toHaveClass(/surface-open/);
  await expect(page.locator('#actionStatus')).not.toContainText('PL-RUNTIME-001');
  expect(errors).toEqual([]);
});
