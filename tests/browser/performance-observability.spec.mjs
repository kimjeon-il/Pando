import { expect, test } from '@playwright/test';

test('publishes a bounded runtime performance report after the app becomes interactive', async ({ page }, testInfo) => {
  test.setTimeout(85_000);
  const consoleErrors = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/?debug');
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 60_000 });

  await expect.poll(() => page.evaluate(() => typeof window.__PANDOLAB_PERFORMANCE_REPORT__), {
    timeout: 10_000,
  }).toBe('function');
  // Bootstrap overlay disappearance does not imply an interactive map.
  // Record stage telemetry if the app never reaches the Core-backed interactive state.
  // Do not turn an absent interactive marker into a fabricated zero measurement.
  try {
    await expect.poll(() => page.evaluate(() => {
      const report = window.__PANDOLAB_PERFORMANCE_REPORT__?.();
      return Number.isFinite(report?.startup?.interactiveMs) && report.startup.interactiveMs >= 0;
    }), { timeout: 35_000, intervals: [250, 750, 1500] }).toBe(true);
  } catch (error) {
    const details = await page.evaluate(() => ({
      appReadiness: document.querySelector('#app')?.dataset.readiness ?? null,
      overlayHidden: document.querySelector('#bootstrapLoading')?.hasAttribute('hidden') ?? null,
      bootstrap: window.__PANDOLAB_STARTUP_METRICS__ ?? null,
      report: window.__PANDOLAB_PERFORMANCE_REPORT__?.() ?? null,
      mapStatus: document.querySelector('[role="status"]')?.textContent?.slice(0, 400) ?? null,
    }));
    const diagnostics = { details, consoleErrors };
    await testInfo.attach('p3-interactive-stage-diagnostic.json', {
      body: Buffer.from(JSON.stringify(diagnostics, null, 2)), contentType: 'application/json',
    });
    console.error('P3_INTERACTIVE_STAGE:', JSON.stringify(diagnostics).slice(0, 5000));
    throw error;
  }

  const report = await page.evaluate(() => window.__PANDOLAB_PERFORMANCE_REPORT__());
  expect(report.version).toBe(1);
  expect(report.startup).toBeTruthy();
  expect(report.startup.interactiveMs).toBeGreaterThanOrEqual(0);
  expect(report.longTasks.firstLoadWindowMs).toBe(5_000);
  expect(Array.isArray(report.longTasks.samples)).toBe(true);
  expect(report.longTasks.samples.length).toBeLessThanOrEqual(120);
  expect(report.operations).toBeTruthy();
  expect(Array.isArray(report.memory)).toBe(true);

  const thresholds = await page.evaluate(() => window.__PANDOLAB_PERFORMANCE_THRESHOLDS__);
  expect(thresholds.longTaskMs).toBe(50);
  expect(thresholds.commitToPaintMs).toBe(100);
});
