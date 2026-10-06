import { expect, test } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { productionGeoPackage } from '../helpers/production-geopackage.mjs';
import { currentCountryFlagUrl } from '../../assets/js/modules/country-flags.js';
import { selectUiOption } from './helpers/ui-select.mjs';

test('info v9 derives live hierarchy, focuses only via GPS and preserves metadata validation and history', async ({ page }, testInfo) => {
  test.setTimeout(210_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  // This UI regression runs on the production Canvas path by default. GPU
  // resource and terrain regressions have their own focused browser checks.
  const renderer = process.env.PANDOLAB_INFO_RENDERER || 'canvas';
  await page.goto(`/?debug=1&renderer=${renderer}&demTerrain=raster`);
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  const project = JSON.parse(await readFile(new URL('../fixtures/timeline-exchange/static.json', import.meta.url), 'utf8'));
  const extra = structuredClone(project.territorialEntities[2]);
  extra.id = 'D'; extra.properties.name = '아주 긴 객체 이름으로 표시하는 산하 객체 ' + '긴 이름 '.repeat(12).trim();
  project.territorialEntities.push(extra);
  for (const collection of ['lifetimes', 'geometryBindings', 'parentRelations']) {
    const record = structuredClone(project.timelineRecords[collection].find(row => row.entityId === 'C'));
    record.id += ':D'; record.entityId = 'D';
    project.timelineRecords[collection].push(record);
  }
  for (const relation of project.timelineRecords.parentRelations) {
    relation.parentId = ['C', 'D'].includes(relation.entityId) ? 'B' : relation.parentId;
    relation.coverageMode = 'explicit';
  }
  for (const [id, x, y, size] of [['A', 0, 0, 12], ['B', 1, 1, 10], ['C', 2, 2, 3], ['D', 7, 7, 3]]) {
    const geometry = { type: 'Polygon', coordinates: [[[x, y], [x, y + size], [x + size, y + size], [x + size, y], [x, y]]] };
    project.geometries.push({ id: `info-shape:${id}`, version: 1, geojson: geometry });
    project.timelineRecords.geometryBindings.find(record => record.entityId === id).geometryRef = { id: `info-shape:${id}`, version: 1 };
  }
  const flag = currentCountryFlagUrl('DEU');
  for (const feature of project.territorialEntities) feature.properties.metadata.flagDataUrl = flag.slice(flag.indexOf('/assets/'));
  const file = await productionGeoPackage('write', new ArrayBuffer(0), project);
  const filePath = testInfo.outputPath('info-project.gpkg');
  await writeFile(filePath, new Uint8Array(file.buffer));
  await page.locator('#mobileFileBtn').click();
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#openProjectBtn').click();
  await (await chooser).setFiles(filePath);
  await expect(page.locator('#gisImportTitle')).toHaveText('프로젝트 불러오기', { timeout: 30_000 });
  await expect(page.locator('#gisImportForm')).not.toHaveClass(/\bis-busy\b/, { timeout: 30_000 });
  await expect(page.locator('#gisImportError')).toBeEmpty();
  await page.locator('#gisImportConfirmBtn').click();
  await expect(page.locator('#gisImportModal')).toBeHidden({ timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => !!window.PANDOLAB_TERRITORIAL.get('D')), { timeout: 30_000 }).toBe(true);

  const select = async id => {
    await page.evaluate(id => window.PANDOLAB_TERRITORIAL.select(id), id);
    await expect(page.locator('#entityProperties')).toBeVisible();
    await expect(page.locator('#entityNameInput')).toHaveValue(project.territorialEntities.find(feature => feature.id === id).properties.name);
    await page.locator('#editorTabBtn').click();
  };
  for (const [id, parent, children] of [['R', false, false], ['C', true, false], ['A', false, true], ['B', true, true]]) {
    await select(id);
    await expect(page.locator('#entityInfoParent')).toBeVisible({ visible: parent });
    await expect(page.locator('#entityInfoChildren')).toBeVisible({ visible: children });
    await expect(page.locator('#entityInfoRelations')).toBeVisible({ visible: parent || children });
  }
  const rows = page.locator('#entityInfoChildren .editor-info-relation-row');
  await expect(rows).toHaveCount(2);
  expect(await page.locator('#entityProperties .editor-info-section').innerText()).not.toMatch(/メモ|메모|유효 기간|관계 없음|소속 없음|산하 없음/);
  expect(await page.locator('#entityProperties .editor-info-section').innerText()).toMatch(/소속[\s\S]*산하[\s\S]*존속기간[\s\S]*비고/);
  const style = await rows.last().evaluate(row => {
    const name = row.querySelector('.editor-info-relation-name');
    const button = row.querySelector('button');
    return { border: getComputedStyle(row).borderTopWidth, background: getComputedStyle(row).backgroundColor,
      truncation: getComputedStyle(name).textOverflow, buttonFits: button.getBoundingClientRect().right <= row.getBoundingClientRect().right };
  });
  expect(style).toEqual({ border: '0px', background: 'rgba(0, 0, 0, 0)', truncation: 'ellipsis', buttonFits: true });
  await expect(rows.first().locator('img')).toBeVisible();
  expect(await rows.first().locator('img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);

  const view = () => page.evaluate(() => window.__PANDOLAB_MAP_HOST__.getViewState());
  const before = await view();
  await rows.first().locator('.editor-info-relation-name').click();
  expect(await view()).toEqual(before);
  await expect(rows.first().locator('use')).toHaveAttribute('href', await page.locator('#focusSelectedObjectBtn use').getAttribute('href'));
  for (const id of ['C', 'D', 'A']) {
    // Match the real header focus command, including its safe-inset and globe
    // framing rules; a raw geometry midpoint is not the current view contract.
    await select(id);
    await page.locator('#focusSelectedObjectBtn').click();
    const expected = await view();
    await select('B');
    await page.locator(`[data-info-relation-focus="${id}"]`).click();
    await expect.poll(async () => (await view()).geographicCenter).toEqual(expected.geographicCenter);
    expect((await view()).scale).toBe(expected.scale);
    await expect(page.locator('#entityNameInput')).toHaveValue('B 영토');
  }
  await page.locator('#relationTabBtn').click();
  await expect(page.locator('#entityParentInputControl')).toBeVisible();
  await selectUiOption(page, '#entityParentInput', '');
  await expect.poll(() => page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('B').properties.parentId)).toBe('');
  await page.locator('#editorTabBtn').click();
  await expect(page.locator('#entityInfoParent')).toBeHidden();
  await expect(rows).toHaveCount(2);
  await page.locator('#undoBtn').click();
  await select('B');
  await expect(page.locator('#entityInfoParent .editor-info-relation-name')).toHaveText('A 영토');

  const period = page.locator('#entityPeriodInput');
  for (const id of ['entityNotesInput', 'labelNotesInput', 'hydroNotesInput']) {
    await expect(page.locator(`label[for="${id}"]`)).toHaveText('비고');
  }
  await expect(period).toHaveValue('');
  await expect(page.locator('#entityValidFromInput, #entityValidToInput')).toHaveCount(0);
  const records = () => page.evaluate(() => ({ from: window.PANDOLAB_TERRITORIAL.get('B').properties.validFrom,
    to: window.PANDOLAB_TERRITORIAL.get('B').properties.validTo }));
  for (const input of ['1871-01-18 ~ 1918-11-09', '1871-01-18 ~', '~ 1918-11-09', '1900 ~~ 1901', '1900-02-29 ~', '1918 ~ 1871']) {
    await period.fill(input); await period.dispatchEvent('change');
    await expect(period).toHaveAttribute('aria-invalid', 'true');
    expect(await records()).toEqual({ from: null, to: null });
  }
  await period.fill(' ~ '); await period.dispatchEvent('change');
  await expect(period).toHaveValue('');
  await expect(period).not.toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#redoBtn')).toBeEnabled();
  await page.locator('#entityNotesInput').fill('비고 변경');
  await page.locator('#entityNotesInput').dispatchEvent('change');
  expect(await page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('B').properties.notes)).toBe('비고 변경');
  await page.locator('#undoBtn').click(); await select('B');
  await expect(page.locator('#entityNotesInput')).toHaveValue('원본 메타데이터 보존');
  await page.locator('#redoBtn').click(); await select('B');
  await expect(page.locator('#entityNotesInput')).toHaveValue('비고 변경');
  await page.locator('#editorSurface').screenshot({ path: testInfo.outputPath('info-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#entityPeriodInput')).toBeVisible();
  await page.locator('#editorSurface').screenshot({ path: testInfo.outputPath('info-mobile-top.png') });
  await rows.last().scrollIntoViewIfNeeded();
  expect(await rows.last().evaluate(row => row.scrollWidth <= row.clientWidth)).toBe(true);
  await page.locator('#editorSurface').screenshot({ path: testInfo.outputPath('info-mobile.png') });
  await page.locator('#entityNotesInput').scrollIntoViewIfNeeded();
  await expect(page.locator('#entityNotesInput')).toHaveValue('비고 변경');
  expect(await page.locator('#editorScrollBody').evaluate(body => body.scrollWidth <= body.clientWidth)).toBe(true);
  await page.locator('#editorSurface').screenshot({ path: testInfo.outputPath('info-mobile-bottom.png') });
  expect(errors).toEqual([]);
});
