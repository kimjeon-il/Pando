import { expect, test } from '@playwright/test';

test('publishes a bounded runtime performance report after the app becomes interactive', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/?debug');
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 60_000 });

  await expect.poll(() => page.evaluate(() => typeof window.__PANDOLAB_PERFORMANCE_REPORT__), {
    timeout: 10_000,
  }).toBe('function');

  const report = await page.evaluate(() => window.__PANDOLAB_PERFORMANCE_REPORT__());
  expect(report.version).toBe(1);
  expect(report.startup).toBeTruthy();
  expect(Number(report.startup.interactiveMs)).toBeGreaterThanOrEqual(0);
  expect(report.longTasks.firstLoadWindowMs).toBe(5_000);
  expect(Array.isArray(report.longTasks.samples)).toBe(true);
  expect(report.longTasks.samples.length).toBeLessThanOrEqual(120);
  expect(report.operations).toBeTruthy();
  expect(Array.isArray(report.memory)).toBe(true);

  const thresholds = await page.evaluate(() => window.__PANDOLAB_PERFORMANCE_THRESHOLDS__);
  expect(thresholds.longTaskMs).toBe(50);
  expect(thresholds.commitToPaintMs).toBe(100);
});
