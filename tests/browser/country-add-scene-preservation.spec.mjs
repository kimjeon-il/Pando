import { expect, test } from '@playwright/test';

async function openApp(page, renderer) {
  await page.goto(`/?debug=1&renderer=${renderer}`);
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 60_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 120_000 });
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_GPU_METRICS__?.renderer), { timeout: 30_000 }).toBe(renderer);
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_GPU_METRICS__?.sceneCache?.state), { timeout: 30_000 }).toBe('valid');
}

for (const renderer of ['webgl2', 'webgl1']) {
  test(`${renderer} keeps the completed scene visible while a country addition patch is prepared`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
      const NativeWorker = window.Worker;
      window.Worker = class DelayedCountryAddPatchWorker extends NativeWorker {
        constructor(url, options) {
          super(url, options);
          this.delaysCountryPatch = options?.name === 'pandolab-country-patch-mesh';
        }

        postMessage(message, transfer = []) {
          if (this.delaysCountryPatch && message?.geometryRevision) {
            window.setTimeout(() => NativeWorker.prototype.postMessage.call(this, message, transfer), 1800);
            return;
          }
          NativeWorker.prototype.postMessage.call(this, message, transfer);
        }
      };
    });
    await openApp(page, renderer);

    await page.locator('#createMenuBtn').click();
    await page.locator('#addFromLibraryBtn').click();
    await expect(page.locator('#historicalLibraryModal')).toBeVisible();
    await page.locator('#historicalLibrarySearchInput').fill('동프로이센');
    await page.locator('#historicalLibraryYearInput').fill('1900');
    await page.locator('[data-library-entity-id="historical-country:east-prussia"]').click();
    await page.locator('#historicalLibraryAddBtn').click();
    await expect(page.locator('#historicalLibraryAddBtn')).toHaveText('확인 후 추가');
    await page.locator('#historicalLibraryAddBtn').click();

    await expect.poll(() => page.evaluate(() => window.__PANDOLAB_GPU_METRICS__?.countryPatchPresentation?.phase), {
      timeout: 15_000,
    }).toBe('waiting-mesh');
    const duringPatch = await page.evaluate(() => ({
      metrics: window.__PANDOLAB_GPU_METRICS__,
      previewCount: document.querySelectorAll('.country-patch-preview').length,
    }));
    expect(duringPatch.metrics.sceneCache?.state).toBe('valid');
    expect(duringPatch.metrics.pendingCountryCount).toBeGreaterThan(0);
    expect(duringPatch.previewCount).toBeGreaterThan(0);

    await expect.poll(() => page.evaluate(() => window.__PANDOLAB_GPU_METRICS__?.pendingCountryCount || 0), {
      timeout: 60_000,
    }).toBe(0);
    await expect.poll(() => page.locator('.country-patch-preview').count(), { timeout: 10_000 }).toBe(0);
  });
}
