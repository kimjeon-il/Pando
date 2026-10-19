import { gotoEditor } from './helpers/editor-entry.mjs';
import { expect, test } from '@playwright/test';
import { staticAutosaveProject } from '../helpers/timeline-project.mjs';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9WlWsAAAAASUVORK5CYII=',
  'base64',
);

test('duplicate raw records survive whole saves and independent completed edits need no shutdown rewrite', async ({ page }) => {
  await gotoEditor(page, '/assets/css/app.css');
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
  await gotoEditor(page, '/assets/css/app.css');
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
  await gotoEditor(page, '/');
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
  await gotoEditor(page, '/');
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

test('reference image list controls and task tabs preserve selection and stored appearance', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = await openApp(page);
  await clearReferenceStore(page);
  await page.reload();
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  await expect(page.locator('#referenceImageBtn')).toBeVisible();
  await page.locator('#referenceImageBtn').click();
  await addImage(page, 'first.png');
  await addImage(page, 'second.png');
  await expect(page.locator('.reference-image-list-row')).toHaveCount(2);

  const first = page.locator('.reference-image-list-item').filter({ hasText: 'first.png' });
  await first.locator('[data-ref-list-action="visible"]').click();
  await expect.poll(() => page.evaluate(() =>
    window.__PANDOLAB_REFERENCE_IMAGES__.list().find(item => item.name === 'first.png')?.visible,
  )).toBe(false);
  await expect(first.locator('.reference-image-list-row .reference-image-visibility use')).toHaveAttribute('href', '#icon-eye-off');

  await page.locator('[data-ref-tab="match"]').click();
  await page.locator('[data-ref-action="gcp"]').click();
  await expect(page.locator('#map')).toHaveClass(/is-reference-gcp-mode/);
  await first.locator('[data-ref-list-action="locked"]').click();
  await expect(page.locator('#map')).toHaveClass(/is-reference-gcp-mode/);
  await expect.poll(() => page.evaluate(() =>
    window.__PANDOLAB_REFERENCE_IMAGES__.list().find(item => item.name === 'first.png')?.locked,
  )).toBe(true);
  await expect(first.locator('.reference-image-list-row small')).toContainText('잠김');
  await first.locator('[data-ref-list-action="locked"]').click();
  await expect.poll(() => page.evaluate(() =>
    window.__PANDOLAB_REFERENCE_IMAGES__.list().find(item => item.name === 'first.png')?.locked,
  )).toBe(false);
  await page.keyboard.press('Escape');
  await expect(page.locator('#map')).not.toHaveClass(/is-reference-gcp-mode/);

  await first.locator('[data-ref-list-action="forward"]').click();
  await expect.poll(() => page.evaluate(() =>
    window.__PANDOLAB_REFERENCE_IMAGES__.list().map(item => item.name),
  )).toEqual(['second.png', 'first.png']);
  await first.locator('.reference-image-list-row').click();
  await expect(page.locator('[data-ref-field="name"]')).toHaveValue('first.png');

  await page.locator('[data-ref-tab="match"]').click();
  await expect(page.locator('[data-ref-tab="match"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-ref-section="placement"]')).toBeHidden();
  await expect(page.locator('[data-ref-action="gcp"]')).toBeVisible();
  await expect(page.locator('[data-ref-field="opacity"]')).toBeVisible();

  await page.locator('[data-ref-tab="match"]').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('[data-ref-tab="display"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-ref-section="match"]')).toBeHidden();
  await expect(page.locator('[data-ref-field="blend"]')).toBeVisible();
  await page.locator('[data-ref-field="blend"]').selectOption('multiply');
  await page.locator('[data-ref-field="opacity"]').evaluate(input => {
    input.value = '0.37';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
  await expect.poll(() => page.evaluate(() => {
    const item = window.__PANDOLAB_REFERENCE_IMAGES__.list().find(record => record.name === 'first.png');
    return { blend: item?.blendMode, opacity: item?.opacity };
  })).toEqual({ blend: 'multiply', opacity: 0.37 });

  await expect.poll(async () => page.evaluate(async () => {
    const store = await import('/assets/js/modules/reference-image-store.js');
    const item = (await store.listStoredReferenceImages()).find(record => record.name === 'first.png');
    return { blend: item?.blendMode, opacity: item?.opacity, visible: item?.visible, locked: item?.locked };
  })).toEqual({ blend: 'multiply', opacity: 0.37, visible: false, locked: false });
  await page.reload();
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  await expect.poll(() => page.evaluate(() =>
    window.__PANDOLAB_REFERENCE_IMAGES__?.list().find(item => item.name === 'first.png')?.opacity,
  )).toBe(0.37);
  expect(errors).toEqual([]);
});

test('explicit map navigation, Space and overlapping images keep each input owner separate', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await openApp(page);
  await clearReferenceStore(page);
  await page.reload();
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  await page.locator('#referenceImageBtn').click();
  await addImage(page, 'underlay.png');
  await addImage(page, 'overlay.png');
  await page.locator('.reference-image-list-row').filter({ hasText: 'underlay.png' }).click();
  await page.locator('[data-ref-tab="placement"]').click();
  await page.locator('[data-ref-action="placement"]').click();
  await expect(page.locator('#map')).toHaveClass(/is-reference-placement-mode/);
  const before = await readReferenceStore(page);
  const firstId = before.find(item => item.name === 'underlay.png').id;
  const secondId = before.find(item => item.name === 'overlay.png').id;
  const firstMapQuad = before.find(item => item.id === firstId).mapQuad;
  const upperMapQuad = before.find(item => item.id === secondId).mapQuad;
  const center = (await referenceScreenGeometry(page, 'underlay.png')).center;
  await page.mouse.move(center.x, center.y);
  await expect(page.locator('#map')).toHaveAttribute('data-reference-pointer', 'move');

  const mapMode = page.locator('.reference-image-selected-card [data-ref-action="navigation-toggle"]');
  await mapMode.click();
  await expect(mapMode).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#map')).toHaveClass(/is-reference-map-pan-mode/);
  await expect(page.locator('[data-ref-action="placement"]')).toHaveAttribute('aria-pressed', 'true');
  const cameraBefore = await page.evaluate(() => JSON.stringify(window.__PANDOLAB_VIEW_STATE__));
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + 50, center.y + 20, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => JSON.stringify(window.__PANDOLAB_VIEW_STATE__))).not.toBe(cameraBefore);
  expect((await readReferenceStore(page)).find(item => item.id === firstId).mapQuad).toEqual(firstMapQuad);
  expect((await readReferenceStore(page)).find(item => item.id === secondId).mapQuad).toEqual(upperMapQuad);

  await mapMode.click();
  await expect(page.locator('#map')).not.toHaveClass(/is-reference-map-pan-mode/);
  await expect(page.locator('#map')).toHaveClass(/is-reference-placement-mode/);
  const imageCenter = (await referenceScreenGeometry(page, 'underlay.png')).center;
  await page.mouse.move(imageCenter.x, imageCenter.y);
  await page.mouse.down();
  await page.mouse.move(imageCenter.x + 34, imageCenter.y + 18, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => {
    const current = (await readReferenceStore(page)).find(item => item.id === firstId)?.mapQuad;
    return JSON.stringify(current) !== JSON.stringify(firstMapQuad);
  }).toBe(true);
  expect((await readReferenceStore(page)).find(item => item.id === secondId).mapQuad).toEqual(upperMapQuad);
  const editedQuad = (await readReferenceStore(page)).find(item => item.id === firstId).mapQuad;

  await page.locator('#map').focus();
  await page.keyboard.down('Space');
  await expect(page.locator('#map')).toHaveClass(/is-reference-space-pan/);
  const spaceCenter = (await referenceScreenGeometry(page, 'underlay.png')).center;
  const viewBeforeSpace = await page.evaluate(() => JSON.stringify(window.__PANDOLAB_VIEW_STATE__));
  await page.mouse.move(spaceCenter.x, spaceCenter.y);
  await page.mouse.down();
  await page.mouse.move(spaceCenter.x - 45, spaceCenter.y + 18, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up('Space');
  await expect(page.locator('#map')).not.toHaveClass(/is-reference-space-pan/);
  await expect.poll(() => page.evaluate(() => JSON.stringify(window.__PANDOLAB_VIEW_STATE__))).not.toBe(viewBeforeSpace);
  expect((await readReferenceStore(page)).find(item => item.id === firstId).mapQuad).toEqual(editedQuad);
  expect((await readReferenceStore(page)).find(item => item.id === secondId).mapQuad).toEqual(upperMapQuad);
  await page.locator('.reference-image-toolbar [data-ref-action="undo"]').click();
  await expect.poll(async () => (await readReferenceStore(page)).find(item => item.id === firstId).mapQuad).toEqual(firstMapQuad);
  expect(errors).toEqual([]);
});

test('mobile navigation button preserves GCP phase and two-finger pinch cancels an image drag', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await openApp(page);
  await clearReferenceStore(page);
  await page.reload();
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#app')).toHaveAttribute('data-layout', 'mobile');
  await page.locator('#referenceImageBtn').click();
  await addImage(page, 'touch-input.png');
  await page.locator('[data-ref-tab="match"]').click();
  await page.locator('[data-ref-action="gcp"]').click();
  const summaryMode = page.locator('.reference-image-editing-summary [data-ref-action="navigation-toggle"]');
  await expect(summaryMode).toBeVisible();
  const first = await referenceScreenPointForUv(page, 'touch-input.png', [0.5, 0.5]);
  await page.mouse.click(first.x, first.y);
  await expect(page.locator('.reference-image-editing-summary > span')).toContainText('실제 지도 위치');
  await summaryMode.click();
  await expect(page.locator('#map')).toHaveClass(/is-reference-gcp-mode/);
  await expect(page.locator('#map')).toHaveClass(/is-reference-map-pan-mode/);
  await summaryMode.click();
  await expect(page.locator('#map')).not.toHaveClass(/is-reference-map-pan-mode/);
  await expect(page.locator('.reference-image-editing-summary > span')).toContainText('실제 지도 위치');

  // Finish the temporary point workflow, then exercise the map's pointer
  // controller with two synthetic touch pointers on the selected image.
  await page.keyboard.press('Escape');
  await page.locator('[data-ref-tab="placement"]').click();
  await page.locator('[data-ref-action="placement"]').click();
  const before = (await readReferenceStore(page))[0].mapQuad;
  const gestureResult = await page.evaluate(async () => {
    const map = document.getElementById('map');
    const store = await import('/assets/js/modules/reference-image-store.js');
    const { referenceImagePlacementPointAtUv } = await import('/assets/js/modules/reference-image-transform.js');
    const record = (await store.listStoredReferenceImages())[0];
    const center = referenceImagePlacementPointAtUv(record, [0.5, 0.5], window.__PANDOLAB_MAP_HOST__);
    const rect = map.getBoundingClientRect();
    const touch = (type, id, x, y) => map.dispatchEvent(new window.PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch', button: 0,
      clientX: rect.left + x, clientY: rect.top + y,
    }));
    const beforeZoom = window.__PANDOLAB_MAP_HOST__.getViewState?.();
    touch('pointerdown', 701, center[0], center[1]);
    touch('pointermove', 701, center[0] + 18, center[1] + 10);
    touch('pointerdown', 702, center[0] + 35, center[1] + 2);
    touch('pointermove', 702, center[0] + 60, center[1] + 14);
    touch('pointerup', 702, center[0] + 60, center[1] + 14);
    touch('pointerup', 701, center[0] + 18, center[1] + 10);
    return { beforeZoom, afterZoom: window.__PANDOLAB_MAP_HOST__.getViewState?.() };
  });
  expect(gestureResult.afterZoom).not.toEqual(gestureResult.beforeZoom);
  expect((await readReferenceStore(page))[0].mapQuad).toEqual(before);
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
  const directEditButton = page.locator('[data-ref-action="gcp-edit"]');
  await directEditButton.scrollIntoViewIfNeeded();
  await expect.poll(() => directEditButton.evaluate(button => {
    const rect = button.getBoundingClientRect();
    return button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
  }), { message: 'The active point-edit control remains clickable in the task area.' }).toBe(true);
  await directEditButton.click();
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
