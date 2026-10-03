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
      tx.objectStore('state-v2').put({ version: 2, records: [] }, 'reference-images');
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

async function screenPointForReferenceUv(page, uv) {
  return page.evaluate(async targetUv => {
    const store = await import('/assets/js/modules/reference-image-store.js');
    const stored = (await store.listStoredReferenceImages())[0];
    const { buildReferenceImageSourceMapping } = await import('/assets/js/modules/reference-image-source-mapping.js');
    const mapping = buildReferenceImageSourceMapping(stored);
    const coordinate = mapping.project(targetUv);
    const screen = window.__PANDOLAB_MAP_HOST__.project(coordinate);
    const rect = document.getElementById('map').getBoundingClientRect();
    return { x: rect.left + screen[0], y: rect.top + screen[1] };
  }, uv);
}

async function referenceScreenGeometry(page) {
  return page.evaluate(async () => {
    const store = await import('/assets/js/modules/reference-image-store.js');
    const record = (await store.listStoredReferenceImages())[0];
    const { referenceImagePlacementGeometry } = await import('/assets/js/modules/reference-image-transform.js');
    const geometry = referenceImagePlacementGeometry(record, window.__PANDOLAB_MAP_HOST__);
    const rect = document.getElementById('map').getBoundingClientRect();
    return {
      center: { x: rect.left + geometry.center[0], y: rect.top + geometry.center[1] },
      corners: geometry.corners.map(point => ({ x: rect.left + point[0], y: rect.top + point[1] })),
    };
  });
}

async function waitForReady(page) {
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  await expect(page.locator('.reference-image-launcher')).toBeVisible();
}

test('line refinement accepts a current corner-pin mapping and supports cancel/apply preview flow', async ({ page }) => {
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
  const geometry = await referenceScreenGeometry(page);

  await page.locator('[data-ref-action="free-transform"]').click();
  await expect(page.locator('#map')).toHaveClass(/is-reference-free-transform-mode/);
  const corner = geometry.corners[1];
  const target = {
    x: corner.x + (geometry.center.x - corner.x) * 0.14,
    y: corner.y + (geometry.center.y - corner.y) * 0.14,
  };
  await page.mouse.move(corner.x, corner.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => {
    const item = window.__PANDOLAB_REFERENCE_IMAGES__?.list()?.[0];
    return { cornerPin: !!item?.cornerPinEnabled, ready: !!item?.mappingReady };
  })).toEqual({ cornerPin: true, ready: true });
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
  await page.keyboard.press('Escape');
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

  const roughStart = await screenPointForReferenceUv(page, [0.52, 0.12]);
  const roughEnd = await screenPointForReferenceUv(page, [0.52, 0.48]);
  await page.mouse.move(roughStart.x, roughStart.y);
  await page.mouse.down();
  await page.mouse.move(roughEnd.x, roughEnd.y, { steps: 18 });
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
