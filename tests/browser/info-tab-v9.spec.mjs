import { expect, test } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { productionGeoPackage } from '../helpers/production-geopackage.mjs';
import { currentCountryFlagUrl } from '../../assets/js/modules/country-flags.js';
import { selectUiOption } from './helpers/ui-select.mjs';

test('editor derives live hierarchy in Relations, focuses only via GPS and preserves metadata validation and history', async ({ page }, testInfo) => {
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
    await page.locator('#relationTabBtn').click();
  };
  for (const [id, parent, children] of [['R', false, false], ['C', true, false], ['A', false, true], ['B', true, true]]) {
    await select(id);
    await expect(page.locator('#entityParentRows .editor-relation-row')).toHaveCount(parent ? 1 : 0);
    expect(await page.locator('#entityChildRows .editor-relation-row').count() > 0).toBe(children);
    await expect(page.locator('#entityRelations')).toBeVisible({ visible: id !== 'R' });
  }
  const rows = page.locator('#entityChildRows .editor-relation-row');
  await expect(rows).toHaveCount(2);
  expect(await page.locator('#entityProperties .editor-info-section').textContent()).not.toMatch(/メモ|메모|유효 기간|관계 없음|소속 없음|산하 없음/);
  expect(await page.locator('#entityProperties .editor-info-section').textContent()).toMatch(/이름[\s\S]*색상[\s\S]*존속기간[\s\S]*비고/);
  await expect(page.locator('#entityProperties .editor-info-section #entityRelations')).toHaveCount(0);
  const style = await rows.last().evaluate(row => {
    const name = row.querySelector('.editor-relation-name');
    const button = row.querySelector('button');
    return { border: getComputedStyle(row).borderTopWidth, background: getComputedStyle(row).backgroundColor,
      truncation: getComputedStyle(name).textOverflow, buttonFits: button.getBoundingClientRect().right <= row.getBoundingClientRect().right };
  });
  expect(style).toEqual({ border: '0px', background: 'rgba(0, 0, 0, 0)', truncation: 'ellipsis', buttonFits: true });
  await expect(rows.first().locator('img')).toBeVisible();
  expect(await rows.first().locator('img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);

  const view = () => page.evaluate(() => window.__PANDOLAB_MAP_HOST__.getViewState());
  const before = await view();
  await rows.first().locator('.editor-relation-name').click();
  expect(await view()).toEqual(before);
  await expect(rows.first().locator('[data-relation-focus] use')).toHaveAttribute('href', await page.locator('#focusSelectedObjectBtn use').getAttribute('href'));
  for (const id of ['C', 'D', 'A']) {
    // Match the real header focus command, including its safe-inset and globe
    // framing rules; a raw geometry midpoint is not the current view contract.
    await select(id);
    await page.locator('#focusSelectedObjectBtn').click();
    const expected = await view();
    await select('B');
    await page.locator(`[data-relation-focus="${id}"]`).click();
    await expect.poll(async () => (await view()).geographicCenter).toEqual(expected.geographicCenter);
    expect((await view()).scale).toBe(expected.scale);
    await expect(page.locator('#entityNameInput')).toHaveValue('B 영토');
  }
  await page.locator('#relationTabBtn').click();
  await expect(page.locator('#entityChangeParentBtn')).toHaveText('변경');
  await expect(page.locator('#entityAddChildBtn')).toHaveText('추가');
  await expect(page.locator('#addEntityChildBtn')).toHaveCount(0);
  await expect(page.locator('#entityParentRow')).toBeHidden();
  await expect(page.locator('#entityChildRow')).toBeHidden();
  await page.locator('#entityChangeParentBtn').click();
  await expect(page.locator('#entityParentRow')).toBeVisible();
  await page.locator('#entityChangeParentBtn').click();
  await expect(page.locator('#entityParentRow')).toBeHidden();
  await expect(page.locator('#entityAddChildBtn')).toBeDisabled();
  await page.locator('#entityChangeParentBtn').click();
  await expect(page.locator('#entityParentInputControl')).toBeVisible();
  await selectUiOption(page, '#entityParentInput', '');
  await expect.poll(() => page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('B').properties.parentId)).toBe('');
  await expect(page.locator('#entityParentRows .editor-relation-row')).toHaveCount(0);
  await expect(page.locator('#entityParentRow')).toBeHidden();
  await expect(rows).toHaveCount(2);
  await page.locator('#undoBtn').click();
  await select('B');
  await expect(page.locator('#entityParentRows .editor-relation-name')).toHaveText('A 영토');

  await page.locator('#editorTabBtn').click();
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
  await page.locator('#undoBtn').click(); await select('B'); await page.locator('#editorTabBtn').click();
  await expect(page.locator('#entityNotesInput')).toHaveValue('원본 메타데이터 보존');
  await page.locator('#redoBtn').click(); await select('B'); await page.locator('#editorTabBtn').click();
  await expect(page.locator('#entityNotesInput')).toHaveValue('비고 변경');
  await page.locator('#editorSurface').screenshot({ path: testInfo.outputPath('info-desktop.png') });
  await page.locator('#relationTabBtn').click();
  const beforeChild = await page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('C'));
  const selectionRevision = await page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().selectionInput.selectionRevision);
  await page.locator('[data-relation-remove="C"]').click();
  await expect.poll(() => page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('C').properties.parentId)).toBe('');
  await expect(page.locator('#entityNameInput')).toHaveValue('B 영토');
  expect(await page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().selectionInput.selectionRevision)).toBe(selectionRevision);
  await page.locator('#undoBtn').click();
  expect(await page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('C'))).toEqual(beforeChild);
  await page.locator('#redoBtn').click();
  await select('B');
  const addRevision = await page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().selectionInput.selectionRevision);
  await page.locator('#entityChangeParentBtn').click();
  await page.locator('#entityAddChildBtn').click();
  await expect(page.locator('#entityParentRow')).toBeHidden();
  await expect(page.locator('#entityChildRow')).toBeVisible();
  await page.locator('#entityAddChildBtn').click();
  await expect(page.locator('#entityChildRow')).toBeHidden();
  await page.locator('#entityAddChildBtn').click();
  await selectUiOption(page, '#entityChildInput', 'C');
  await expect(page.locator('#entityChildRow')).toBeHidden();
  expect(await page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('C'))).toEqual(beforeChild);
  expect(await page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().selectionInput.selectionRevision)).toBe(addRevision);
  await expect(rows).toHaveCount(2);
  await expect(page.locator('#entityChildInput option[value="C"], #entityChildInput option[value="A"], #entityChildInput option[value="B"]')).toHaveCount(0);
  const assertAddButtonFits = async () => {
    const shape = await page.locator('#entityAddChildBtn').evaluate(button => {
      const range = document.createRange(); range.selectNodeContents(button);
      return { lines: [...range.getClientRects()].filter(rect => rect.width > 0).length,
        fits: button.scrollWidth <= button.clientWidth,
        rowFits: button.parentElement.scrollWidth <= button.parentElement.clientWidth };
    });
    expect(shape).toEqual({ lines: 1, fits: true, rowFits: true });
  };
  await assertAddButtonFits();
  await page.locator('#editorSurface').screenshot({ path: testInfo.outputPath('relations-desktop.png') });
  await page.locator('#editorTabBtn').click();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#entityPeriodInput')).toBeVisible();
  await page.locator('#editorSurface').screenshot({ path: testInfo.outputPath('info-mobile-top.png') });
  await page.locator('#relationTabBtn').click();
  await rows.last().scrollIntoViewIfNeeded();
  expect(await rows.last().evaluate(row => row.scrollWidth <= row.clientWidth)).toBe(true);
  await assertAddButtonFits();
  await page.locator('#editorSurface').screenshot({ path: testInfo.outputPath('info-mobile.png') });
  await page.locator('#editorTabBtn').click();
  await page.locator('#entityNotesInput').scrollIntoViewIfNeeded();
  await expect(page.locator('#entityNotesInput')).toHaveValue('비고 변경');
  expect(await page.locator('#editorScrollBody').evaluate(body => body.scrollWidth <= body.clientWidth)).toBe(true);
  await page.locator('#editorSurface').screenshot({ path: testInfo.outputPath('info-mobile-bottom.png') });
  expect(errors).toEqual([]);
});
