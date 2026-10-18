import { test, expect } from '@playwright/test';
import { createViewerProjectPackage } from '../fixtures/viewer-project-package.mjs';

let first;
let latest;
test.beforeAll(async () => {
  first = await createViewerProjectPackage('파일 지도 A');
  latest = await createViewerProjectPackage('마지막 파일 지도');
});

test('viewer opens the real editor GeoPackage and keeps it through invalid files, picker cancellation and a stale read', async ({ page }) => {
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready', 'true', { timeout: 120000 });
  await page.locator('#viewerFile').setInputFiles({ name: 'editor-export.gpkg', mimeType: 'application/geopackage+sqlite3', buffer: first.bytes });
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_VIEWER__.documentSnapshot().territorialEntities[0].properties.name)).toBe('파일 지도 A');
  await expect(page.locator('#viewerStatus')).toHaveAttribute('data-ready','true');
  const loaded = await page.evaluate(() => window.__PANDOLAB_VIEWER__.documentSnapshot());
  expect(loaded.territorialEntities).toEqual(first.project.territorialEntities);
  expect(loaded.geometries).toEqual(first.project.geometries);
  expect(loaded.timelineRecords).toEqual(first.project.timelineRecords);
  await expect(page.getByLabel('연월 입력')).toHaveValue('1914-06');
  await page.locator('#objectSearchBtn').click();
  await page.getByLabel('지도에서 찾기', { exact:true }).fill('파일 지도 A');
  await page.locator('#objectSearchResults button').filter({ hasText: '파일 지도 A' }).first().click();
  await expect(page.locator('#viewerInfo')).toContainText('원본 메타데이터 보존');
  await page.locator('#timelineMonthButton').click();
  await page.getByLabel('연월 입력').fill('1914-07');
  await page.getByLabel('연월 입력').press('Enter');
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_VIEWER__.documentState().timelineCursor)).toBe('1914-07');

  const before = await page.evaluate(() => ({ state: window.__PANDOLAB_VIEWER__.documentState(), project: window.__PANDOLAB_VIEWER__.documentSnapshot() }));
  await page.locator('#viewerFile').setInputFiles({ name: 'broken.gpkg', mimeType: 'application/octet-stream', buffer: Buffer.from('not a sqlite database') });
  await expect(page.locator('#viewerStatus')).toContainText('완료하지 못했습니다');
  expect(await page.evaluate(() => ({ state: window.__PANDOLAB_VIEWER__.documentState(), project: window.__PANDOLAB_VIEWER__.documentSnapshot() }))).toEqual(before);
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#viewerFileToggle').click();
  await page.locator('#viewerOpen').click();
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
