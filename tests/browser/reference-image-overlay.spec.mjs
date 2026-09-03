import { expect, test } from '@playwright/test';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9WlWsAAAAASUVORK5CYII=',
  'base64',
);

async function openApp(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  await expect(page.locator('.reference-image-launcher')).toBeVisible();
  return errors;
}

async function clearReferenceStore(page) {
  await page.evaluate(async () => {
    await new Promise((resolve, reject) => {
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
    });
  });
}

async function readReferenceStore(page) {
  return page.evaluate(async () => new Promise((resolve, reject) => {
    const request = indexedDB.open('pandolab-reference-images', 2);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('state-v2', 'readonly');
      const get = tx.objectStore('state-v2').get('reference-images');
      get.onsuccess = () => {
        const values = Array.isArray(get.result?.records) ? get.result.records : [];
        resolve(values.map(value => ({
          id: value.id,
          name: value.name,
          order: value.order,
          rotation: value.rotation || 0,
          screenRect: value.screenRect,
          controlPointCount: value.controlPoints?.length || 0,
        })).sort((a, b) => a.order - b.order));
      };
      get.onerror = () => reject(get.error);
      tx.oncomplete = () => db.close();
    };
  }));
}

async function addImage(page, name) {
  await page.locator('[data-ref-file]').setInputFiles({ name, mimeType: 'image/png', buffer: PNG_1X1 });
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_REFERENCE_IMAGES__?.list().length || 0)).toBeGreaterThan(0);
}

test('reference images support placement, ordering, georeferencing and persistence without blocking normal map input', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await openApp(page);
  await clearReferenceStore(page);
  await page.reload();
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });

  await page.locator('.reference-image-launcher').click();
  await addImage(page, 'base.png');
  await expect(page.locator('.reference-image-list-row')).toHaveCount(1);
  await expect(page.locator('.reference-image-list-row .reference-image-visibility use')).toHaveAttribute('href', '#icon-eye');

  const nameInput = page.locator('[data-ref-field="name"]');
  await nameInput.fill('<Base "reference">');
  await expect(page.locator('.reference-image-list-row strong')).toHaveText('<Base "reference">');
  await page.locator('[data-ref-field="rotation"]').fill('45');
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_REFERENCE_IMAGES__.list()[0]?.rotation)).toBe(45);

  await page.locator('[data-ref-action="placement"]').click();
  await expect(page.locator('#map')).toHaveClass(/is-reference-placement-mode/);
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_REFERENCE_IMAGES__.list()[0]?.placementEditing)).toBe(true);

  await expect.poll(async () => {
    const records = await readReferenceStore(page);
    return records[0]?.screenRect || null;
  }).not.toBeNull();
  const storedBeforeMove = (await readReferenceStore(page))[0].screenRect;
  const mapBox = await page.locator('#map').boundingBox();
  const centerX = mapBox.x + storedBeforeMove.x + storedBeforeMove.width / 2;
  const centerY = mapBox.y + storedBeforeMove.y + storedBeforeMove.height / 2;
  await page.mouse.move(centerX, centerY);
  await page.mouse.down();
  await page.mouse.move(centerX + 34, centerY + 22, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await readReferenceStore(page))[0]?.screenRect?.x).toBeCloseTo(storedBeforeMove.x + 34, 0);

  await page.keyboard.press('Escape');
  await expect(page.locator('#map')).not.toHaveClass(/is-reference-placement-mode/);
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_REFERENCE_IMAGES__.list()[0]?.placementEditing)).toBe(false);

  await addImage(page, 'top.png');
  await page.locator('[data-ref-field="name"]').fill('Top reference');
  await expect(page.locator('.reference-image-list-row')).toHaveCount(2);
  await page.locator('[data-ref-action="send-backward"]').click();
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_REFERENCE_IMAGES__.list().map(item => item.name))).toEqual(['Top reference', '<Base "reference">']);

  await page.locator('.reference-image-list-row').filter({ hasText: '<Base "reference">' }).click();
  const baseStored = (await readReferenceStore(page)).find(item => item.name === '<Base "reference">');
  const currentMapBox = await page.locator('#map').boundingBox();
  const baseCenterX = currentMapBox.x + baseStored.screenRect.x + baseStored.screenRect.width / 2;
  const baseCenterY = currentMapBox.y + baseStored.screenRect.y + baseStored.screenRect.height / 2;
  await page.locator('[data-ref-action="gcp"]').click();
  await expect(page.locator('#map')).toHaveClass(/is-reference-gcp-mode/);
  await page.mouse.click(baseCenterX, baseCenterY);
  await page.mouse.click(baseCenterX + 90, baseCenterY + 40);
  await page.mouse.click(baseCenterX + 12, baseCenterY + 8);
  await page.mouse.click(baseCenterX + 135, baseCenterY + 65);
  await expect.poll(() => page.evaluate(() => {
    const item = window.__PANDOLAB_REFERENCE_IMAGES__.list().find(value => value.name === '<Base "reference">');
    return { count: item?.controlPointCount, mode: item?.warpMode };
  })).toEqual({ count: 2, mode: 'similarity' });
  await expect(page.locator('[data-ref-action="placement"]')).toBeDisabled();
  await page.keyboard.press('Escape');

  await page.reload();
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_REFERENCE_IMAGES__?.list().length || 0)).toBe(2);
  const restored = await page.evaluate(() => window.__PANDOLAB_REFERENCE_IMAGES__.list());
  expect(restored.map(item => item.name)).toEqual(['Top reference', '<Base "reference">']);
  expect(restored.find(item => item.name === '<Base "reference">').controlPointCount).toBe(2);
  expect(restored.find(item => item.name === '<Base "reference">').rotation).toBe(45);
  expect(errors).toEqual([]);
});
