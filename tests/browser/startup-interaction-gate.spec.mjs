import { expect, test } from '@playwright/test';

test('canonical geometry request waits for a complete quiet input window', async ({ page }) => {
  test.setTimeout(90_000);
  const requestedUrls = [];
  page.on('request', request => requestedUrls.push(request.url()));
  let geometryRequests = 0;
  let meshRequests = 0;
  let geometryRequestedAt = 0;
  await page.route('**/countries-canonical-v0.32.0.pcg.gz*', async route => {
    geometryRequests += 1;
    geometryRequestedAt = Date.now();
    await route.abort('aborted');
  });
  await page.route('**/world-mesh-v0.12.6.bin.gz*', async route => {
    meshRequests += 1;
    await route.abort('aborted');
  });

  await page.goto('/');
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 45_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'preview');
  for (const lazyAsset of [
    'ui-modal.bundle.css',
    'confirm-modal-controller.js',
    'import-service.js',
    'historical-library.js',
  ]) expect(requestedUrls.some(url => url.includes(lazyAsset))).toBe(false);

  const map = page.locator('#map');
  const startedAt = Date.now();
  while (Date.now() - startedAt < 1_200) {
    await map.dispatchEvent('pointermove', {
      pointerId: 1,
      pointerType: 'mouse',
      clientX: 180,
      clientY: 180,
    });
    await page.waitForTimeout(100);
  }
  expect(geometryRequests).toBe(0);
  expect(meshRequests).toBe(0);

  const quietStartedAt = Date.now();
  await expect.poll(() => geometryRequests, { timeout: 3_000 }).toBe(1);
  // The loop includes one final 100ms wait after its last pointer event.
  expect(geometryRequestedAt - quietStartedAt).toBeGreaterThanOrEqual(325);
  expect(meshRequests).toBe(0);
  const metrics = await page.evaluate(() => window.__PANDOLAB_STARTUP_METRICS__ || {});
  expect(metrics.canonicalWorkStartedDuringInputCount).toBe(0);
  expect(metrics.loadPolicy?.mode).toBe('sequential');

  await page.evaluate(() => window.PANDOLAB_ENSURE_MODAL_STYLES());
  await page.evaluate(() => window.PANDOLAB_ENSURE_MODAL_STYLES());
  expect(requestedUrls.filter(url => url.includes('ui-modal.bundle.css'))).toHaveLength(1);
});
