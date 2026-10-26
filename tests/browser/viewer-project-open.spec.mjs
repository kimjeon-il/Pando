import { test, expect } from '@playwright/test';
import { createViewerProjectPackage } from '../fixtures/viewer-project-package.mjs';
import { createInitialDocument } from "../../shared/frontend/js/modules/initial-document.js";
import { createDistributionLayer, createDistributionEntry } from "../../shared/frontend/js/modules/distribution-model.js";
import { openViewingDisplay, closeViewingDisplay } from './helpers/viewing-display.mjs';

let first;
let latest;
test.beforeAll(async () => {
  first = await createViewerProjectPackage('파일 지도 A');
  latest = await createViewerProjectPackage('마지막 파일 지도');
});

test('viewer menus follow project replacement while builtin sources stay available', async ({ page }, info) => {
  test.setTimeout(150000);
  page.setDefaultTimeout(15000);
  const empty = createInitialDocument({ appVersion: '0.36.0' });
  const layer = createDistributionLayer({ id: crypto.randomUUID(), name: '값 0 분포' });
  const entry = createDistributionEntry({ id: crypto.randomUUID(), layerId: layer.id, mode: 'geometry', value: 0,
    geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } });
  const packages = [
    await createViewerProjectPackage('빈 분포', { ...empty, distributionLayers: [layer] }),
    await createViewerProjectPackage('분포 자료', { ...empty, distributionLayers: [layer], distributionEntries: [entry] }),
  ];
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?debug=1&renderer=canvas');
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready', 'true', { timeout: 120000 });
  for (const [index, fixture] of [packages[0], packages[1], packages[0]].entries()) {
    await page.locator('#projectFileInput').setInputFiles({ name: 'menu.gpkg', mimeType: 'application/geopackage+sqlite3', buffer: fixture.bytes });
    await expect.poll(() => page.evaluate(() => window.__PANDOLAB_VIEWER__.documentSnapshot().documentId)).toBe(fixture.project.documentId);
    await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready', 'true');
    const before = await page.evaluate(() => window.__PANDOLAB_VIEWER__.documentSnapshot());
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await openViewingDisplay(page);
      for (const group of ['objects', 'genericFeatures']) await expect(page.locator(`[data-map-display-group="${group}"]`)).toBeHidden();
      for (const group of ['rivers', 'lakes', 'labels', 'terrain']) await expect(page.locator(`[data-map-display-group="${group}"]`)).toBeVisible();
      if (index === 1) await expect(page.locator('#distributionMenuGroup')).toBeVisible();
      else await expect(page.locator('#distributionMenuGroup')).toBeHidden();
      if (index === 1 && viewport.width === 1440 || index === 2 && viewport.width === 390)
        await page.screenshot({ path: info.outputPath(`viewer-menu-${index}-${viewport.width}.png`) });
      await closeViewingDisplay(page);
    }
    expect(await page.evaluate(() => window.__PANDOLAB_VIEWER__.documentSnapshot())).toEqual(before);
    expect(await page.evaluate(() => window.__PANDOLAB_VIEWER__.documentState().canUndo)).toBe(false);
  }
  expect(errors).toEqual([]);
});

test('viewer opens the real editor GeoPackage and keeps it through invalid files, picker cancellation and a stale read', async ({ page }) => {
  test.setTimeout(240000);
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?debug=1&renderer=canvas');
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready', 'true', { timeout: 120000 });
  const initialGeneration=await page.evaluate(()=>window.__PANDOLAB_VIEWER__.rendererStats().projectGeneration);
  await page.locator('#projectFileInput').setInputFiles({ name: 'editor-export.gpkg', mimeType: 'application/geopackage+sqlite3', buffer: first.bytes });
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_VIEWER__.documentSnapshot().territorialEntities[0].properties.name),{timeout:45000}).toBe('파일 지도 A');
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true');
  expect(await page.evaluate(()=>window.__PANDOLAB_VIEWER__.rendererStats().projectGeneration)).toBeGreaterThan(initialGeneration);
  const loaded = await page.evaluate(() => window.__PANDOLAB_VIEWER__.documentSnapshot());
  expect(loaded.territorialEntities).toEqual(first.project.territorialEntities);
  expect(loaded.geometries).toEqual(first.project.geometries);
  expect(loaded.timelineRecords).toEqual(first.project.timelineRecords);
  expect(loaded.projectSetup).toEqual(first.project.projectSetup);
  await expect(page.locator('#timelineDateButton')).toHaveAttribute('aria-label', '1914년, 6월말 기준, 시점 직접 입력');
  await page.locator('#objectSearchBtn').click();
  await page.getByLabel('지도에서 찾기', { exact:true }).fill('파일 지도 A');
  await page.locator('#objectSearchResults button').filter({ hasText: '파일 지도 A' }).first().click();
  expect(await page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentSnapshot().territorialEntities[0].properties.notes)).toBe('원본 메타데이터 보존');
  await page.locator('#timelineDateButton').click();await page.locator('#timelineViewUnit').selectOption('month');
  await page.locator('#timelineYearInput').fill('1914');
  await page.locator('#timelineMonthInput').selectOption('7');
  await page.locator('#timelineYearInput').press('Enter');
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_VIEWER__.documentState().timelineCursor)).toBe('1914-07');

  const before = await page.evaluate(() => ({ state: window.__PANDOLAB_VIEWER__.documentState(), project: window.__PANDOLAB_VIEWER__.documentSnapshot() }));
  await page.locator('#projectFileInput').setInputFiles({ name: 'broken.gpkg', mimeType: 'application/octet-stream', buffer: Buffer.from('not a sqlite database') });
  await expect(page.locator('#actionStatus')).toHaveClass(/error/,{timeout:45000});
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true');
  expect(await page.evaluate(() => ({ state: window.__PANDOLAB_VIEWER__.documentState(), project: window.__PANDOLAB_VIEWER__.documentSnapshot() }))).toEqual(before);
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#mobileFileBtn').click();
  await page.locator('#openProjectBtn').click();
  await (await chooser).setFiles([]);
  expect(await page.evaluate(() => ({ state: window.__PANDOLAB_VIEWER__.documentState(), project: window.__PANDOLAB_VIEWER__.documentSnapshot() }))).toEqual(before);

  await page.evaluate(async ({ earlier, newer }) => {
    const api = window.__PANDOLAB_VIEWER__;
    const old = new File([new Uint8Array(earlier)], 'earlier.gpkg');
    const originalRead = old.arrayBuffer.bind(old);
    let release;
    old.arrayBuffer = () => new Promise(resolve => { release = () => originalRead().then(resolve); });
    const pending = api.openFile(old);
    await api.openFile(new File([new Uint8Array(newer)], 'latest.gpkg'));
    await release();
    await pending;
  }, { earlier: [...first.bytes], newer: [...latest.bytes] });
  const final = await page.evaluate(() => ({ state: window.__PANDOLAB_VIEWER__.documentState(), project: window.__PANDOLAB_VIEWER__.documentSnapshot() }));
  expect(final.project.territorialEntities[0].properties.name).toBe('마지막 파일 지도');
  expect(final.project.geometries).toEqual(latest.project.geometries);
  expect(final.state.canUndo).toBe(false);
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true');
  expect(errors).toEqual([]);
});
