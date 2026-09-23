import { expect, test } from '@playwright/test';

test.use({
  launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'] },
  trace: 'off',
});

test('WebGL2 displays the startup preview', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/?renderer=webgl2', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'preview', { timeout: 30_000 });
  expect(await page.evaluate(() => window.__PANDOLAB_GPU_METRICS__?.renderer)).toBe('webgl2');
});
