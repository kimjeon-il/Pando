import { expect, test } from '@playwright/test';

const EDGE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAoUlEQVR4nO3QQRHAQAyAwGs1xL+tyGll7D3AAAzPzHwHsrtSf15qv4AG6ABNA3SApgE6QNMAHaBpgA7QNEAHaBqgAzQN0AGaBugATQN0gKYBOkDTAB2gaYAO0DRAB2gaoAM0DdABmgboAE0DdICmATpA0wAdoGmADtA0QAdoGqADNA3QAZoG6ABNA3SApgE6QNMAHaBpgA7QNEAHaBqgAzQ/A0IEQI9OdPoAAAAASUVORK5CYII=',
  'base64',
);

async function clearReferenceStore(page) {
  await page.evaluate(async () => new Promise((resolve, reject) => {
    const request = indexedDB.open('pandolab-reference-images', 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('state-v2')) request.result.createObjectStore('state-v2');
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('state-v2', 'readwrite');
      tx.objectStore('state-v2').put({ version: 1, records: [] }, 'reference-images');
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  }));
}

async function readStoredRecord(page) {
  return page.evaluate(async () => new Promise((resolve, reject) => {
    const request = indexedDB.open('pandolab-reference-images', 2);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('state-v2', 'readonly');
      const get = tx.objectStore('state-v2').get('reference-images');
      get.onsuccess = () => resolve(get.result?.records?.[0] || null);
      get.onerror = () => reject(get.error);
      tx.oncomplete = () => db.close();
    };
  }));
}

async function waitForReady(page) {
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  await expect(page.locator('.reference-image-launcher')).toBeVisible();
}

test('line refinement requires a ready unlocked warp and supports cancel/apply preview flow', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await waitForReady(page);
  await clearReferenceStore(page);
  await page.reload();
  await waitForReady(page);

  await page.locator('.reference-image-launcher').click();
  await page.locator('[data-ref-file]').setInputFiles({ name: 'edge.png', mimeType: 'image/png', buffer: EDGE_PNG });
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_REFERENCE_IMAGES__?.list().length || 0)).toBe(1);

  const start = page.locator('[data-ref-line-action="start"]');
  await expect(start).toBeVisible();
  await expect(start).toBeDisabled();

  await expect.poll(async () => !!(await readStoredRecord(page))).toBe(true);
  const stored = await readStoredRecord(page);
  const mapBox = await page.locator('#map').boundingBox();
  const centerX = mapBox.x + stored.screenRect.x + stored.screenRect.width / 2;
  const centerY = mapBox.y + stored.screenRect.y + stored.screenRect.height / 2;

  await page.locator('[data-ref-action="gcp"]').click();
  await page.mouse.click(centerX, centerY);
  await page.mouse.click(centerX + 90, centerY + 40);
  await page.mouse.click(centerX + 12, centerY + 8);
  await page.mouse.click(centerX + 135, centerY + 65);
  await expect.poll(() => page.evaluate(() => {
    const item = window.__PANDOLAB_REFERENCE_IMAGES__?.list()?.[0];
    return { points: item?.controlPointCount || 0, ready: !!item?.diagnostics };
  })).toEqual({ points: 2, ready: true });
  await page.keyboard.press('Escape');
  await expect(start).toBeEnabled();

  const lock = page.locator('[data-ref-field="locked"]');
  await lock.check();
  await expect(page.locator('[data-ref-line-action="start"]')).toBeDisabled();
  await page.locator('[data-ref-field="locked"]').uncheck();
  await expect(page.locator('[data-ref-line-action="start"]')).toBeEnabled();

  await page.locator('[data-ref-line-action="start"]').click();
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_REFERENCE_IMAGE_LINE_REFINER__?.phase())).toBe('armed');
  await expect(page.locator('#map')).toHaveClass(/is-reference-line-refine-mode/);
  await page.locator('[data-ref-line-action="cancel"]').click();
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_REFERENCE_IMAGE_LINE_REFINER__?.phase())).toBe('idle');
  await expect(page.locator('#map')).not.toHaveClass(/is-reference-line-refine-mode/);

  await page.locator('[data-ref-line-action="start"]').click();
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_REFERENCE_IMAGE_LINE_REFINER__?.phase())).toBe('armed');
  await page.evaluate(() => {
    window.__PANDOLAB_REFERENCE_IMAGE_EDITING_ORIGINAL__ = window.__PANDOLAB_REFERENCE_IMAGE_EDITING__;
    window.__PANDOLAB_REFERENCE_IMAGE_EDITING__ = {
      isDraftActive: () => true,
      applyDraftCoordinates: coordinates => {
        window.__PANDOLAB_REFERENCE_IMAGE_APPLIED_TEST__ = coordinates;
        return true;
      },
    };
  });

  const boundaryX = centerX + 90;
  const boundaryY = centerY + 40;
  await page.mouse.move(boundaryX + 4, boundaryY - 45);
  await page.mouse.down();
  await page.mouse.move(boundaryX + 4, boundaryY + 45, { steps: 18 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_REFERENCE_IMAGE_LINE_REFINER__?.phase()), { timeout: 10_000 }).toBe('preview');
  await expect(page.locator('[data-ref-line-action="apply"]')).toBeVisible();
  await page.locator('[data-ref-line-action="apply"]').click();
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_REFERENCE_IMAGE_APPLIED_TEST__?.length || 0)).toBeGreaterThan(1);
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_REFERENCE_IMAGE_LINE_REFINER__?.phase())).toBe('idle');
  await page.evaluate(() => {
    window.__PANDOLAB_REFERENCE_IMAGE_EDITING__ = window.__PANDOLAB_REFERENCE_IMAGE_EDITING_ORIGINAL__;
    delete window.__PANDOLAB_REFERENCE_IMAGE_EDITING_ORIGINAL__;
  });

  expect(errors).toEqual([]);
});
