import { expect, test } from '@playwright/test';
import { staticAutosaveProject } from '../helpers/timeline-project.mjs';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9WlWsAAAAASUVORK5CYII=',
  'base64',
);

test('duplicate raw records survive whole saves and independent completed edits need no shutdown rewrite', async ({ page }) => {
  await page.goto('/assets/css/app.css');
  await page.evaluate(async png => {
    const store = await import('/assets/js/modules/reference-image-store.js');
    const blob = new Blob([Uint8Array.from(atob(png), char => char.charCodeAt(0))], { type: 'image/png' });
    await store.replaceStoredReferenceImages([
      {
        id: 'shared',
        name: 'Decoded',
        order: 0,
        blob,
        modelVersion: 5,
        mapQuad: [[-5, 5], [5, 5], [5, -5], [-5, -5]],
        cornerPinEnabled: false,
      },
      { id: 'shared', name: 'Duplicate original', order: 1, blob: new Blob(['duplicate-original']), custom: { keep: true } },
    ]);
  }, PNG_1X1.toString('base64'));
  await page.addInitScript(() => {
    window.referenceWrites = 0;
    const put = window.IDBObjectStore.prototype.put;
    window.IDBObjectStore.prototype.put = function (...args) {
      if (this.transaction.db.name === 'pandolab-reference-images') window.referenceWrites++;
      return put.apply(this, args);
    };
  });
  await openApp(page);
  await page.locator('#referenceImageBtn').click();
  await addImage(page, 'Second.png');
  await expect(page.locator('.reference-image-list-row')).toHaveCount(2);
  await page.locator('[data-ref-action="send-backward"]').click();
  await expect.poll(async () => (await readReferenceStore(page)).length).toBe(3);
  const original = await page.evaluate(async () => {
    const store = await import('/assets/js/modules/reference-image-store.js');
    const raw = (await store.listStoredReferenceImages()).find(record => record.name === 'Duplicate original');
    return raw ? { bytes: await raw.blob.text(), custom: raw.custom } : null;
  });
  expect(original).toEqual({ bytes: 'duplicate-original', custom: { keep: true } });
  await page.evaluate(() => {
    for (const [index, id] of window.__PANDOLAB_REFERENCE_IMAGES__.list().map(value => value.id).entries()) {
      document.querySelector(`[data-reference-image-id="${id}"]`).click();
      const input = document.querySelector('[data-ref-field="name"]');
      input.value = `Completed ${index}`;
      input.dispatchEvent(new window.Event('input', { bubbles: true }));
    }
  });
  await expect.poll(async () => (await readReferenceStore(page)).filter(item => item.name.startsWith('Completed')).length).toBe(2);
  const writes = await page.evaluate(() => window.referenceWrites);
  await page.evaluate(() => window.__PANDOLAB_REFERENCE_IMAGES__.destroy());
  // A read behind the store's mutation queue is a durability barrier, not a timer.
  await page.evaluate(async () => {
    const store = await import('/assets/js/modules/reference-image-store.js');
    await store.listStoredReferenceImages();
  });
  expect(await page.evaluate(() => window.referenceWrites)).toBe(writes);
});

test('unchanged image startup and shutdown never rewrite the collection', async ({ page }) => {
  await page.addInitScript(() => {
    window.referenceWrites = 0;
    const put = window.IDBObjectStore.prototype.put;
    window.IDBObjectStore.prototype.put = function (...args) {
      if (this.transaction.db.name === 'pandolab-reference-images') window.referenceWrites++;
      return put.apply(this, args);
    };
  });
  await openApp(page);
  expect(await page.evaluate(() => window.referenceWrites)).toBe(0);
  await page.evaluate(() => window.__PANDOLAB_REFERENCE_IMAGES__.destroy());
  expect(await page.evaluate(() => window.referenceWrites)).toBe(0);
});

test('undecodable image originals survive full saves, deletion, undo and a pending shutdown edit', async ({ page }) => {
  await page.goto('/assets/css/app.css');
  await page.evaluate(async () => {
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('pandolab-reference-images', 2);
      request.onupgradeneeded = () => request.result.createObjectStore('state-v2');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('state-v2', 'readwrite');
        tx.objectStore('state-v2').put({ version: 2, records: [{ id: 'broken', name: 'Original', order: 0,
          blob: new Blob(['broken-original'], { type: 'image/png' }), custom: { keep: true } }] }, 'reference-images');
        tx.oncomplete = () => { db.close(); resolve(); };
      };
    });
  });
  await openApp(page);
  await page.locator('#referenceImageBtn').click();
  await addImage(page, 'Healthy.png');
  await expect.poll(async () => (await readReferenceStore(page)).length).toBe(2);
  await page.locator('[data-ref-action="delete"]').click();
  await page.locator('#confirmModalOkBtn').click();
  await expect.poll(async () => (await readReferenceStore(page)).length).toBe(1);
  await page.locator('.reference-image-toolbar [data-ref-action="undo"]').click();
  await expect.poll(async () => (await readReferenceStore(page)).length).toBe(2);
  await page.locator('[data-ref-field="name"]').fill('Pending shutdown');
  await page.evaluate(() => window.__PANDOLAB_REFERENCE_IMAGES__.destroy());
  await expect.poll(async () => (await readReferenceStore(page)).find(item => item.id !== 'broken')?.name).toBe('Pending shutdown');
  const original = await page.evaluate(async () => {
    const store = await import('/assets/js/modules/reference-image-store.js');
    const item = (await store.listStoredReferenceImages()).find(record => record.id === 'broken');
    return { bytes: await item.blob.text(), custom: item.custom };
  });
  expect(original).toEqual({ bytes: 'broken-original', custom: { keep: true } });
});

async function openApp(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' || message.text().includes('[reference-image-restore]')) errors.push(message.text());
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(value => localStorage.setItem('pandolab-editor-project', JSON.stringify(value)), staticAutosaveProject());
  await page.goto('/');
  await expect(page.locator('#referenceImageBtn')).toBeVisible();
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  await expect(page.locator('.reference-image-launcher')).toBeVisible();
  await expect(page.locator('.map-command-toolbar #referenceImageBtn')).toBeVisible();
  await expect(page.locator('#createMenuBtn + #referenceImageBtn')).toHaveCount(1);
  await expect(page.locator('#referenceImageBtn + .map-command-search')).toHaveCount(1);
  await expect(page.locator('#referenceImageBtn')).toHaveAttribute('aria-label', '이미지 추가');
  await expect(page.locator('#referenceImageBtn')).toHaveAttribute('data-tooltip', '이미지 추가');
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
        tx.objectStore('state-v2').put({ version: 2, records: [] }, 'reference-images');
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
          modelVersion: value.modelVersion,
          mapQuad: value.mapQuad,
          cornerPinEnabled: value.cornerPinEnabled === true,
          controlPointCount: value.controlPoints?.length || 0,
          controlPoints: value.controlPoints || [],
        })).sort((a, b) => a.order - b.order));
      };
      get.onerror = () => reject(get.error);
      tx.oncomplete = () => db.close();
    };
  }));
}

async function referenceScreenPointForUv(page, name, uv) {
  return page.evaluate(async ({ recordName, imageUv }) => {
    const store = await import('/assets/js/modules/reference-image-store.js');
    const record = (await store.listStoredReferenceImages()).find(item => item.name === recordName);
    const { referenceImagePlacementPointAtUv } = await import('/assets/js/modules/reference-image-transform.js');
    const point = referenceImagePlacementPointAtUv(record, imageUv, window.__PANDOLAB_MAP_HOST__);
    const rect = document.getElementById('map').getBoundingClientRect();
    return { x: rect.left + point[0], y: rect.top + point[1] };
  }, { recordName: name, imageUv: uv });
}

async function referenceScreenGeometry(page, name) {
  return page.evaluate(async recordName => {
    const store = await import('/assets/js/modules/reference-image-store.js');
    const record = (await store.listStoredReferenceImages()).find(item => item.name === recordName);
    if (!record) return null;
    const { referenceImagePlacementGeometry } = await import('/assets/js/modules/reference-image-transform.js');
    const geometry = referenceImagePlacementGeometry(record, window.__PANDOLAB_MAP_HOST__);
    if (!geometry) return null;
    const rect = document.getElementById('map').getBoundingClientRect();
    return {
      center: { x: rect.left + geometry.center[0], y: rect.top + geometry.center[1] },
      corners: geometry.corners.map(point => ({ x: rect.left + point[0], y: rect.top + point[1] })),
    };
  }, name);
}

async function addImage(page, name) {
  await page.locator('[data-ref-file]').setInputFiles({ name, mimeType: 'image/png', buffer: PNG_1X1 });
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_REFERENCE_IMAGES__?.list().length || 0)).toBeGreaterThan(0);
}

test('reference image toolbar button is present before enhanced startup', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('.map-command-toolbar #referenceImageBtn')).toBeVisible();
  await expect(page.locator('#referenceImageBtn use')).toHaveAttribute('href', '#icon-reference-image');
});

test('reference image surface docks beside the desktop map, resizes and collapses without covering it', async ({ page }) => {
  const errors = await openApp(page);
  const originalWidth = (await page.locator('#map').boundingBox()).width;
  await page.locator('#referenceImageBtn').click();
  const panel = page.locator('#referenceImageSurface');
  await expect(panel).toBeVisible();
  const bounds = async () => page.evaluate(() => {
    const box = selector => {
      const rect = document.querySelector(selector).getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width, height: rect.height };
    };
    return { workspace: box('.workspace'), map: box('#map'), panel: box('#referenceImageSurface') };
  });
  const docked = await bounds();
  expect(docked.map.width).toBeLessThan(originalWidth - 300);
  expect(docked.map.right).toBeCloseTo(docked.panel.left, 0);
  expect(docked.panel.right).toBeCloseTo(docked.workspace.right, 0);
  expect(docked.panel.width).toBeCloseTo(340, 0);

  const toggle = page.locator('.reference-image-collapse-button');
  await expect(toggle).toBeVisible();
  await page.locator('.reference-image-panel-header strong').waitFor({ state: 'visible' });
  await toggle.click();
  await expect(panel).toHaveClass(/reference-image-collapsed/);
  const folded = await bounds();
  expect(folded.map.right).toBeCloseTo(folded.panel.left, 0);
  expect(folded.panel.width).toBeCloseTo(64, 0);
  expect(folded.map.width).toBeGreaterThan(docked.map.width + 200);
  await toggle.click();
  await expect(panel).not.toHaveClass(/reference-image-collapsed/);

  const start = await bounds();
  const handle = page.locator('.reference-image-resize-handle');
  await expect(handle).toBeVisible();
  await page.mouse.move(start.panel.left + 4, 160);
  await page.mouse.down();
  await page.mouse.move(start.panel.left - 56, 160, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await bounds()).panel.width).toBeGreaterThan(start.panel.width + 40);
  const resized = await bounds();
  expect(resized.map.right).toBeCloseTo(resized.panel.left, 0);

  await page.locator('.reference-image-panel-header [data-ref-action="close"]').click();
  await expect(panel).toBeHidden();
  await expect.poll(async () => (await page.locator('#map').boundingBox()).width).toBeCloseTo(originalWidth, 0);
  expect(errors).toEqual([]);
});

test('reference image bottom sheet collapses without closing on mobile', async ({ page }) => {
  const errors = await openApp(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#app')).toHaveAttribute('data-layout', 'mobile');
  const originalWidth = (await page.locator('#map').boundingBox()).width;
  await page.locator('#referenceImageBtn').click();
  const panel = page.locator('#referenceImageSurface');
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute('data-sheet-snap', '1');
  await expect(panel.locator('.reference-image-panel-header')).toBeVisible();
  const toggle = panel.locator('.reference-image-collapse-button');
  await toggle.click();
  await expect(panel).toHaveClass(/reference-image-collapsed/);
  await expect(panel).toHaveAttribute('data-sheet-snap', '0');
  await expect(panel).toBeVisible();
  await toggle.click();
  await expect(panel).not.toHaveClass(/reference-image-collapsed/);
  await expect(panel).toHaveAttribute('data-sheet-snap', '1');
  expect((await page.locator('#map').boundingBox()).width).toBeCloseTo(originalWidth, 0);

  // A calibration gesture must survive compacting and re-expanding the sheet.
  await addImage(page, 'mobile-calibration.png');
  await panel.locator('[data-ref-tab="match"]').click();
  await panel.locator('[data-ref-action="gcp"]').click();
  await expect(page.locator('#map')).toHaveClass(/is-reference-gcp-mode/);
  const guidance = panel.locator('.reference-image-editing-summary > span');
  await expect(guidance).toContainText('이미지에서');
  const first = await referenceScreenPointForUv(page, 'mobile-calibration.png', [0.5, 0.5]);
  await page.mouse.click(first.x, first.y);
  await expect(guidance).toContainText('실제 지도 위치');
  await toggle.click();
  await expect(page.locator('#map')).toHaveClass(/is-reference-gcp-mode/);
  await toggle.click();
  await expect(guidance).toContainText('실제 지도 위치');
  expect(errors).toEqual([]);
});

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
  await page.locator('[data-ref-field="name"]').press('Escape');
  await expect(page.locator('.reference-image-panel')).toBeVisible();
  await expect(page.locator('.reference-image-list-row .reference-image-visibility use')).toHaveAttribute('href', '#icon-eye');

  const nameInput = page.locator('[data-ref-field="name"]');
  await nameInput.fill('<Base "reference">');
  await expect(page.locator('.reference-image-list-row strong')).toHaveText('<Base "reference">');
  await page.locator('[data-ref-field="rotation"]').fill('45');
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_REFERENCE_IMAGES__.list()[0]?.rotation)).toBeCloseTo(45, 8);

  await page.locator('[data-ref-action="placement"]').click();
  await expect(page.locator('#map')).toHaveClass(/is-reference-placement-mode/);
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_REFERENCE_IMAGES__.list()[0]?.placementEditing)).toBe(true);

  await expect.poll(async () => {
    const records = await readReferenceStore(page);
    return records[0]?.mapQuad || null;
  }).not.toBeNull();
  const storedBeforeMove = structuredClone((await readReferenceStore(page))[0].mapQuad);
  const geometryBeforeMove = await referenceScreenGeometry(page, '<Base "reference">');
  const centerX = geometryBeforeMove.center.x;
  const centerY = geometryBeforeMove.center.y;
  const cameraBefore = await page.evaluate(() => window.__PANDOLAB_VIEW_STATE__);
  await page.mouse.move(centerX, centerY);
  await page.mouse.down();
  await page.mouse.move(centerX + 34, centerY + 22, { steps: 4 });
  await page.mouse.up();
  let storedAfterMove;
  await expect.poll(async () => {
    storedAfterMove = (await readReferenceStore(page))[0]?.mapQuad || null;
    return JSON.stringify(storedAfterMove) !== JSON.stringify(storedBeforeMove);
  }).toBe(true);
  expect(await page.evaluate(() => window.__PANDOLAB_VIEW_STATE__)).toEqual(cameraBefore);
  await expect(page.locator('.reference-image-editing-summary')).toBeHidden();
  await expect(page.locator('[data-ref-action="placement"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-ref-action="placement"]').click();
  await expect(page.locator('.reference-image-toolbar [data-ref-action="undo"]')).toBeVisible();
  await page.locator('.reference-image-toolbar [data-ref-action="undo"]').click();
  await expect.poll(async () => (await readReferenceStore(page))[0]?.mapQuad).toEqual(storedBeforeMove);
  await page.locator('.reference-image-toolbar [data-ref-action="redo"]').click();
  await expect.poll(async () => (await readReferenceStore(page))[0]?.mapQuad).toEqual(storedAfterMove);

  await expect(page.locator('#map')).not.toHaveClass(/is-reference-placement-mode/);
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_REFERENCE_IMAGES__.list()[0]?.placementEditing)).toBe(false);

  await addImage(page, 'top.png');
  await expect(page.locator('.reference-image-list-row')).toHaveCount(2);
  await page.locator('.reference-image-toolbar [data-ref-action="undo"]').click();
  await expect(page.locator('.reference-image-list-row')).toHaveCount(1);
  await page.locator('.reference-image-toolbar [data-ref-action="redo"]').click();
  await expect(page.locator('.reference-image-list-row')).toHaveCount(2);
  // Restoring records keeps the current image selected when it still exists.
  await page.locator('.reference-image-list-row').filter({ hasText: 'top.png' }).click();
  await page.locator('[data-ref-field="name"]').fill('Top reference');
  await expect(page.locator('.reference-image-list-row')).toHaveCount(2);
  await page.locator('[data-ref-action="send-backward"]').click();
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_REFERENCE_IMAGES__.list().map(item => item.name))).toEqual(['Top reference', '<Base "reference">']);

  await page.locator('.reference-image-list-row').filter({ hasText: '<Base "reference">' }).click();
  const baseGeometry = await referenceScreenGeometry(page, '<Base "reference">');
  const firstImagePoint = await referenceScreenPointForUv(page, '<Base "reference">', [0.35, 0.35]);
  const secondImagePoint = await referenceScreenPointForUv(page, '<Base "reference">', [0.7, 0.65]);
  const baseCenterX = baseGeometry.center.x;
  const baseCenterY = baseGeometry.center.y;
  await page.locator('[data-ref-tab="match"]').click();
  await page.locator('[data-ref-action="gcp"]').click();
  const selectedBeforeGcp = await page.locator('#propertyTitle').textContent();
  await expect(page.locator('#map')).toHaveClass(/is-reference-gcp-mode/);
  await page.mouse.click(firstImagePoint.x, firstImagePoint.y);
  await page.mouse.move(baseCenterX - 120, baseCenterY - 120);
  await page.mouse.down();
  await page.mouse.move(baseCenterX - 90, baseCenterY - 100, { steps: 4 });
  await page.mouse.up();
  expect(await page.evaluate(() => window.__PANDOLAB_REFERENCE_IMAGES__.list().find(item => item.name === '<Base "reference">').controlPointCount)).toBe(0);
  await page.mouse.click(firstImagePoint.x + 35, firstImagePoint.y + 15);
  await page.mouse.click(secondImagePoint.x, secondImagePoint.y);
  await page.mouse.click(secondImagePoint.x + 42, secondImagePoint.y + 22);
  await expect.poll(() => page.evaluate(() => {
    const item = window.__PANDOLAB_REFERENCE_IMAGES__.list().find(value => value.name === '<Base "reference">');
    return { count: item?.controlPointCount, mode: item?.warpMode };
  })).toEqual({ count: 2, mode: 'similarity' });
  await expect(page.locator('[data-ref-action="placement"]')).toBeDisabled();
  expect(await page.locator('#propertyTitle').textContent()).toEqual(selectedBeforeGcp);
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
  await expect(page.locator('.reference-image-editing-summary')).toBeHidden();
  await expect(page.locator('[data-ref-action="gcp-edit"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-ref-action="gcp-edit"]').click();
  await expect(page.locator('.reference-image-toolbar [data-ref-action="undo"]')).toBeVisible();
  await page.locator('.reference-image-toolbar [data-ref-action="undo"]').click();
  await expect.poll(async () => (await readReferenceStore(page)).find(item => item.name === '<Base "reference">').controlPoints[0].coordinate).toEqual(pointBeforeDirectEdit.coordinate);

  await page.locator('[data-ref-action="gcp-edit"]').click();
  await page.mouse.click(pointScreen.x, pointScreen.y);
  await page.keyboard.press('Delete');
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_REFERENCE_IMAGES__.list().find(value => value.name === '<Base "reference">')?.controlPointCount)).toBe(1);
  await expect(page.locator('.reference-image-editing-summary')).toBeHidden();
  await expect(page.locator('[data-ref-action="gcp-edit"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-ref-action="gcp-edit"]').click();
  await page.locator('.reference-image-toolbar [data-ref-action="undo"]').click();
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_REFERENCE_IMAGES__.list().find(value => value.name === '<Base "reference">')?.controlPointCount)).toBe(2);
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
  await page.locator('.reference-image-toolbar [data-ref-action="undo"]').click();
  await expect.poll(async () => (await readReferenceStore(page)).find(item => item.name === '<Base "reference">').controlPoints).toEqual(pointsBefore);
  await page.locator('[data-ref-action="clear-gcp"]').click();
  await page.locator('#confirmModalCancelBtn').click();
  expect((await readReferenceStore(page)).find(item => item.name === '<Base "reference">').controlPoints).toEqual(pointsBefore);
  await page.locator('[data-ref-action="delete"]').click();
  await page.locator('#confirmModalOkBtn').click();
  await expect(page.locator('.reference-image-list-row')).toHaveCount(1);
  await page.locator('.reference-image-toolbar [data-ref-action="undo"]').click();
  await expect(page.locator('.reference-image-list-row')).toHaveCount(2);

  // Reload only after the debounced image metadata transaction is durable.
  await expect.poll(async () => (await readReferenceStore(page)).map(item => ({
    name: item.name,
    points: item.controlPointCount,
  }))).toEqual([
    { name: 'Top reference', points: 0 },
    { name: '<Base "reference">', points: 2 },
  ]);

  const baseMapQuadBeforeReload = structuredClone(
    (await readReferenceStore(page)).find(item => item.name === '<Base "reference">').mapQuad,
  );
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
  const restoredStored = await readReferenceStore(page);
  expect(restoredStored.find(item => item.name === '<Base "reference">').mapQuad).toEqual(baseMapQuadBeforeReload);

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
  expect(commandToolbarSizes.toolbar.width).toBeCloseTo(98, 0);
  expect(commandToolbarSizes.toolbar.height).toBeCloseTo(54, 0);
  expect(commandToolbarSizes.reference.width).toBeCloseTo(40, 0);
  expect(commandToolbarSizes.reference.height).toBeCloseTo(40, 0);
  expect(commandToolbarSizes.reset.width).toBeCloseTo(40, 0);
  expect(commandToolbarSizes.reset.height).toBeCloseTo(40, 0);
  await page.locator('.reference-image-launcher').click();
  const imagePanel = page.locator('.reference-image-panel');
  await expect(imagePanel).toBeVisible();
  const panelBounds = await imagePanel.boundingBox();
  const navigationBounds = await page.locator('.mobile-bottom-bar').boundingBox();
  expect(panelBounds.x).toBeGreaterThanOrEqual(0);
  expect(panelBounds.x + panelBounds.width).toBeLessThanOrEqual(390);
  expect(panelBounds.y + panelBounds.height).toBeLessThanOrEqual(navigationBounds.y);
  await page.locator('#mobileMenuBtn').click();
  await expect(page.locator('#mobileGlobalMenu')).toBeVisible();
  await page.locator('#mobileDisplayBtn').click();
  await expect(page.locator('#mapDisplaySurface')).toBeVisible();
  await expect(imagePanel).toBeHidden();
  await page.locator('#mobileMenuBtn').click();
  await expect(page.locator('#mobileGlobalMenu')).toBeVisible();
  await page.locator('#mobileDisplayBtn').click();
  await expect(page.locator('#mapDisplaySurface')).toBeHidden();
  await page.setViewportSize({ width: 1024, height: 900 });
  await expect(imagePanel).toBeHidden();
  await page.locator('.reference-image-launcher').click();
  await expect(imagePanel).toBeVisible();
  expect(await page.evaluate(() => window.__PANDOLAB_REFERENCE_IMAGES__.list().length)).toBe(2);
  expect(errors).toEqual([]);
});
