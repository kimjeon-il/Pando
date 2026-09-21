import { expect, test } from '@playwright/test';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9WlWsAAAAASUVORK5CYII=',
  'base64',
);

async function openApp(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' || message.text().includes('[reference-image-restore]')) errors.push(message.text());
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  await expect(page.locator('.reference-image-launcher')).toBeVisible();
  await expect(page.locator('.map-command-toolbar #referenceImageBtn')).toBeVisible();
  await expect(page.locator('.map-command-search + #referenceImageBtn')).toHaveCount(1);
  await expect(page.locator('#referenceImageBtn + #resetViewBtn')).toHaveCount(1);
  await expect(page.locator('#referenceImageBtn')).toHaveAttribute('aria-label', '참조 이미지');
  await expect(page.locator('#referenceImageBtn')).toHaveAttribute('data-tooltip', '참조 이미지');
  await expect(page.locator('#referenceImageBtn')).toHaveText('');
  await expect(page.locator('#referenceImageBtn use')).toHaveAttribute('href', '#icon-reference-image');
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
          controlPoints: value.controlPoints || [],
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
  await page.locator('[data-ref-field="name"]').focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('.reference-image-panel')).toBeVisible();
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
  const cameraBefore = await page.evaluate(() => window.__PANDOLAB_VIEW_STATE__);
  await page.mouse.move(centerX, centerY);
  await page.mouse.down();
  await page.mouse.move(centerX + 34, centerY + 22, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await readReferenceStore(page))[0]?.screenRect?.x).toBeCloseTo(storedBeforeMove.x + 34, 0);
  expect(await page.evaluate(() => window.__PANDOLAB_VIEW_STATE__)).toEqual(cameraBefore);
  await page.locator('[data-ref-action="undo"]').click();
  await expect.poll(async () => (await readReferenceStore(page))[0]?.screenRect?.x).toBeCloseTo(storedBeforeMove.x, 0);
  await page.locator('[data-ref-action="redo"]').click();
  await expect.poll(async () => (await readReferenceStore(page))[0]?.screenRect?.x).toBeCloseTo(storedBeforeMove.x + 34, 0);
  await page.locator('[data-ref-action="placement"]').click();

  await page.keyboard.press('Escape');
  await expect(page.locator('#map')).not.toHaveClass(/is-reference-placement-mode/);
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_REFERENCE_IMAGES__.list()[0]?.placementEditing)).toBe(false);

  await addImage(page, 'top.png');
  await expect(page.locator('.reference-image-list-row')).toHaveCount(2);
  await page.locator('[data-ref-action="undo"]').focus();
  await page.keyboard.press('Control+z');
  await expect(page.locator('.reference-image-list-row')).toHaveCount(1);
  await page.locator('[data-ref-action="redo"]').click();
  await expect(page.locator('.reference-image-list-row')).toHaveCount(2);
  // Restoring records keeps the current image selected when it still exists.
  await page.locator('.reference-image-list-row').filter({ hasText: 'top.png' }).click();
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
  const selectedBeforeGcp = await page.locator('#selectionToolbar').getAttribute('aria-hidden');
  await expect(page.locator('#map')).toHaveClass(/is-reference-gcp-mode/);
  await page.mouse.click(baseCenterX, baseCenterY);
  await page.mouse.move(baseCenterX - 120, baseCenterY - 120);
  await page.mouse.down();
  await page.mouse.move(baseCenterX - 90, baseCenterY - 100, { steps: 4 });
  await page.mouse.up();
  expect(await page.evaluate(() => window.__PANDOLAB_REFERENCE_IMAGES__.list().find(item => item.name === '<Base "reference">').controlPointCount)).toBe(0);
  await page.mouse.click(baseCenterX + 90, baseCenterY + 40);
  await page.mouse.click(baseCenterX + 12, baseCenterY + 8);
  await page.mouse.click(baseCenterX + 135, baseCenterY + 65);
  await expect.poll(() => page.evaluate(() => {
    const item = window.__PANDOLAB_REFERENCE_IMAGES__.list().find(value => value.name === '<Base "reference">');
    return { count: item?.controlPointCount, mode: item?.warpMode };
  })).toEqual({ count: 2, mode: 'similarity' });
  await expect(page.locator('[data-ref-action="placement"]')).toBeDisabled();
  expect(await page.locator('#selectionToolbar').getAttribute('aria-hidden')).toEqual(selectedBeforeGcp);
  await page.keyboard.press('Escape');
  const pointBeforeDirectEdit = (await readReferenceStore(page)).find(item => item.name === '<Base "reference">').controlPoints[0];
  const pointScreen = await page.evaluate(point => {
    const screen = window.__PANDOLAB_MAP_HOST__.project(point.coordinate);
    const rect = document.getElementById('map').getBoundingClientRect();
    return { x: rect.left + screen[0], y: rect.top + screen[1] };
  }, pointBeforeDirectEdit);
  await page.locator('[data-ref-action="gcp-edit"]').click();
  await expect(page.locator('#map')).toHaveClass(/is-reference-gcp-edit-mode/);
  await page.mouse.move(pointScreen.x, pointScreen.y);
  await page.mouse.down();
  await page.mouse.move(pointScreen.x + 24, pointScreen.y + 18, { steps: 3 });
  await page.mouse.up();
  await expect.poll(async () => (await readReferenceStore(page)).find(item => item.name === '<Base "reference">').controlPoints[0].coordinate).not.toEqual(pointBeforeDirectEdit.coordinate);
  await page.locator('[data-ref-action="undo"]').click();
  await expect.poll(async () => (await readReferenceStore(page)).find(item => item.name === '<Base "reference">').controlPoints[0].coordinate).toEqual(pointBeforeDirectEdit.coordinate);
  await page.mouse.click(pointScreen.x, pointScreen.y);
  await page.keyboard.press('Delete');
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_REFERENCE_IMAGES__.list().find(value => value.name === '<Base "reference">')?.controlPointCount)).toBe(1);
  await page.locator('[data-ref-action="undo"]').click();
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_REFERENCE_IMAGES__.list().find(value => value.name === '<Base "reference">')?.controlPointCount)).toBe(2);
  await page.locator('[data-ref-action="gcp-edit"]').click();
  await expect(page.locator('[data-ref-action="flip-x"]')).toBeDisabled();
  await page.locator('[data-ref-field="locked"]').check();
  await expect(page.locator('[data-ref-action="delete"]')).toBeDisabled();
  await expect(page.locator('[data-ref-action="clear-gcp"]')).toBeDisabled();
  await expect(page.locator('[data-ref-action="edit-coordinate"]').first()).toBeDisabled();
  await page.locator('[data-ref-field="locked"]').uncheck();
  const pointsBefore = (await readReferenceStore(page)).find(item => item.name === '<Base "reference">').controlPoints;
  await page.locator('[data-ref-action="edit-coordinate"]').first().click();
  await page.keyboard.press('Escape');
  expect((await readReferenceStore(page)).find(item => item.name === '<Base "reference">').controlPoints).toEqual(pointsBefore);
  await page.locator('[data-ref-action="edit-coordinate"]').first().click();
  // Stay inside the globe; blank space beyond the sphere has no map coordinate.
  await page.mouse.click(baseCenterX + 40, baseCenterY + 35);
  await expect.poll(async () => (await readReferenceStore(page)).find(item => item.name === '<Base "reference">').controlPoints[0].coordinate).not.toEqual(pointsBefore[0].coordinate);
  await page.locator('[data-ref-action="undo"]').click();
  await expect.poll(async () => (await readReferenceStore(page)).find(item => item.name === '<Base "reference">').controlPoints).toEqual(pointsBefore);
  await page.locator('[data-ref-action="clear-gcp"]').click();
  await page.locator('#confirmModalCancelBtn').click();
  expect((await readReferenceStore(page)).find(item => item.name === '<Base "reference">').controlPoints).toEqual(pointsBefore);
  await page.locator('[data-ref-action="delete"]').click();
  await page.locator('#confirmModalOkBtn').click();
  await expect(page.locator('.reference-image-list-row')).toHaveCount(1);
  await page.locator('[data-ref-action="undo"]').click();
  await expect(page.locator('.reference-image-list-row')).toHaveCount(2);

  // Reload only after the debounced image metadata transaction is durable.
  await expect.poll(async () => (await readReferenceStore(page)).map(item => ({
    name: item.name,
    points: item.controlPointCount,
  }))).toEqual([
    { name: 'Top reference', points: 0 },
    { name: '<Base "reference">', points: 2 },
  ]);

  await page.reload();
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  // The map's enhanced event precedes the lazy image bootstrap and blob decoding.
  await expect(page.locator('.reference-image-launcher')).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => ({
    names: await page.evaluate(() => window.__PANDOLAB_REFERENCE_IMAGES__?.list().map(item => item.name) || []),
    errors,
  }), { timeout: 30_000 }).toEqual({ names: ['Top reference', '<Base "reference">'], errors: [] });
  const restored = await page.evaluate(() => window.__PANDOLAB_REFERENCE_IMAGES__.list());
  expect(restored.map(item => item.name)).toEqual(['Top reference', '<Base "reference">']);
  expect(restored.find(item => item.name === '<Base "reference">').controlPointCount).toBe(2);
  expect(restored.find(item => item.name === '<Base "reference">').rotation).toBe(45);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#app')).toHaveAttribute('data-layout', 'mobile');
  await expect(page.locator('#createMenuBtn')).toBeHidden();
  await expect(page.locator('.map-command-search')).toBeHidden();
  await expect(page.locator('#referenceImageBtn')).toBeVisible();
  await expect(page.locator('#resetViewBtn')).toBeVisible();
  const commandToolbarSizes = await page.evaluate(() => {
    const toolbar = document.querySelector('.map-command-toolbar').getBoundingClientRect();
    const reference = document.querySelector('#referenceImageBtn').getBoundingClientRect();
    const reset = document.querySelector('#resetViewBtn').getBoundingClientRect();
    return {
      toolbar: { width: toolbar.width, height: toolbar.height },
      reference: { width: reference.width, height: reference.height },
      reset: { width: reset.width, height: reset.height },
    };
  });
  expect(commandToolbarSizes.toolbar.width).toBeCloseTo(114, 0);
  expect(commandToolbarSizes.toolbar.height).toBeCloseTo(62, 0);
  expect(commandToolbarSizes.reference.width).toBeCloseTo(48, 0);
  expect(commandToolbarSizes.reference.height).toBeCloseTo(48, 0);
  expect(commandToolbarSizes.reset.width).toBeCloseTo(48, 0);
  expect(commandToolbarSizes.reset.height).toBeCloseTo(48, 0);
  await page.locator('.reference-image-launcher').click();
  const imagePanel = page.locator('.reference-image-panel');
  await expect(imagePanel).toBeVisible();
  const panelBounds = await imagePanel.boundingBox();
  const navigationBounds = await page.locator('.mobile-bottom-bar').boundingBox();
  expect(panelBounds.x).toBeGreaterThanOrEqual(0);
  expect(panelBounds.x + panelBounds.width).toBeLessThanOrEqual(390);
  expect(panelBounds.y + panelBounds.height).toBeLessThanOrEqual(navigationBounds.y);
  await page.locator('#mobileDisplayBtn').click();
  await expect(page.locator('#mobileDisplayBtn')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#mapDisplaySurface')).toBeVisible();
  await expect(imagePanel).toBeHidden();
  await page.locator('#mobileDisplayBtn').click();
  await expect(page.locator('#mobileDisplayBtn')).toHaveAttribute('aria-expanded', 'false');
  await page.setViewportSize({ width: 1024, height: 900 });
  await expect(imagePanel).toBeHidden();
  await page.locator('.reference-image-launcher').click();
  await expect(imagePanel).toBeVisible();
  expect(await page.evaluate(() => window.__PANDOLAB_REFERENCE_IMAGES__.list().length)).toBe(2);
  expect(errors).toEqual([]);
});
