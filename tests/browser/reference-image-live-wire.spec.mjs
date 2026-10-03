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

async function screenPointForReferenceUv(page, targetUv) {
  return page.evaluate(async uv => {
    const stored = await new Promise((resolve, reject) => {
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
    });
    const { buildReferenceImageSourceMapping } = await import('/assets/js/modules/reference-image-source-mapping.js');
    const warp = buildReferenceImageSourceMapping(stored);
    const coordinate = warp.project(uv);
    const local = window.__PANDOLAB_MAP_HOST__.project(coordinate);
    const rect = document.getElementById('map').getBoundingClientRect();
    return { x: rect.left + local[0], y: rect.top + local[1] };
  }, targetUv);
}

test('live-wire accepts a current corner-pin mapping and traces/undoes/applies an edge path', async ({ page }) => {
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

  const start = page.locator('[data-ref-live-wire-action="start"]');
  await expect(start).toBeVisible();
  await expect(start).toBeDisabled();

  await expect.poll(async () => !!(await readStoredRecord(page))).toBe(true);
  const geometry = await referenceScreenGeometry(page);
  const centerX = geometry.center.x;
  const centerY = geometry.center.y;

  await page.locator('[data-ref-action="free-transform"]').click();
  await expect(page.locator('#map')).toHaveClass(/is-reference-free-transform-mode/);
  const corner = geometry.corners[1];
  await page.mouse.move(corner.x, corner.y);
  await page.mouse.down();
  await page.mouse.move(corner.x + 24, corner.y - 12, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => {
    const item = window.__PANDOLAB_REFERENCE_IMAGES__?.list()?.[0];
    return { cornerPin: !!item?.cornerPinEnabled, ready: !!item?.mappingReady };
  })).toEqual({ cornerPin: true, ready: true });
  await page.keyboard.press('Escape');
  await expect(start).toBeEnabled();

  await page.locator('[data-ref-field="locked"]').check();
  await expect(page.locator('[data-ref-live-wire-action="start"]')).toBeDisabled();
  await page.locator('[data-ref-field="locked"]').uncheck();
  await expect(page.locator('[data-ref-live-wire-action="start"]')).toBeEnabled();

  await start.click();
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_REFERENCE_IMAGE_LIVE_WIRE__?.phase())).toBe('armed');
  await expect(page.locator('#map')).toHaveClass(/is-reference-live-wire-mode/);
  await page.locator('[data-ref-live-wire-action="cancel"]').click();
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_REFERENCE_IMAGE_LIVE_WIRE__?.phase())).toBe('idle');

  await start.click();
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_REFERENCE_IMAGE_LIVE_WIRE__?.phase())).toBe('armed');
  await page.evaluate(() => {
    window.__PANDOLAB_REFERENCE_IMAGE_EDITING_ORIGINAL__ = window.__PANDOLAB_REFERENCE_IMAGE_EDITING__;
    window.__PANDOLAB_REFERENCE_IMAGE_EDITING__ = {
      isDraftActive: () => true,
      applyDraftCoordinates: coordinates => {
        window.__PANDOLAB_REFERENCE_IMAGE_APPLIED_LIVE_WIRE_TEST__ = coordinates;
        return true;
      },
    };
  });

  const first = await screenPointForReferenceUv(page, [0.5, 0.18]);
  const second = await screenPointForReferenceUv(page, [0.5, 0.82]);
  await page.mouse.click(first.x, first.y);
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_REFERENCE_IMAGE_LIVE_WIRE__?.phase())).toBe('tracking');
  await page.mouse.move(second.x, second.y, { steps: 6 });
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_REFERENCE_IMAGE_LIVE_WIRE__?.previewPointCount() || 0), { timeout: 10_000 }).toBeGreaterThan(4);
  await page.mouse.click(second.x, second.y);
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_REFERENCE_IMAGE_LIVE_WIRE__?.segmentCount() || 0)).toBe(1);

  await page.keyboard.press('Backspace');
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_REFERENCE_IMAGE_LIVE_WIRE__?.segmentCount() || 0)).toBe(0);
  await page.mouse.move(second.x, second.y, { steps: 4 });
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_REFERENCE_IMAGE_LIVE_WIRE__?.previewPointCount() || 0)).toBeGreaterThan(4);
  await page.mouse.click(second.x, second.y);
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_REFERENCE_IMAGE_LIVE_WIRE__?.phase())).toBe('preview');
  await expect(page.locator('[data-ref-live-wire-action="apply"]')).toBeVisible();
  await page.locator('[data-ref-live-wire-action="apply"]').click();
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_REFERENCE_IMAGE_APPLIED_LIVE_WIRE_TEST__?.length || 0)).toBeGreaterThan(1);
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_REFERENCE_IMAGE_LIVE_WIRE__?.phase())).toBe('idle');

  await page.evaluate(() => {
    window.__PANDOLAB_REFERENCE_IMAGE_EDITING__ = window.__PANDOLAB_REFERENCE_IMAGE_EDITING_ORIGINAL__;
    delete window.__PANDOLAB_REFERENCE_IMAGE_EDITING_ORIGINAL__;
  });
  expect(errors).toEqual([]);
});
