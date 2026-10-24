import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { gotoEditor } from './helpers/editor-entry.mjs';
import { selectUiOption } from './helpers/ui-select.mjs';
import { staticAutosaveProject } from '../helpers/timeline-project.mjs';
import { qgisFixture } from '../fixtures/qgis/pando.mjs';

test('QGIS exchange imports line and area through the editor and one Undo/Redo', async ({ page }) => {
  test.setTimeout(120_000);
  const collection = process.env.PANDOLAB_QGIS_EXCHANGE_FILE
    ? JSON.parse(readFileSync(process.env.PANDOLAB_QGIS_EXCHANGE_FILE)) : qgisFixture;
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await gotoEditor(page, '/assets/css/app.css');
  const saved = staticAutosaveProject({ genericFeatures: [] });
  await page.evaluate(value => localStorage.setItem('pandolab-editor-project', JSON.stringify(value)), saved);
  await gotoEditor(page, '/');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 60_000 });
  await page.getByRole('button', { name: '파일 메뉴 열기' }).click();
  await page.locator('#fileAdvancedBtn').click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('#openGisBtn').click()]);
  await chooser.setFiles({ name: 'qgis-pando.geojson', mimeType: 'application/geo+json', buffer: Buffer.from(JSON.stringify(collection)) });
  await expect(page.locator('#gisImportModal')).toBeVisible();
  await expect(page.locator('#gisImportConfirmBtn')).toBeEnabled({ timeout: 30_000 });
  await page.locator('#gisTargetType').evaluate(select => {
    select.value = 'generic';
    select.dispatchEvent(new select.ownerDocument.defaultView.Event('change', { bubbles: true }));
  });
  for (let i = 0; i < 2; i++) await page.locator('#gisImportNextBtn').click();
  await page.locator('#gisImportConfirmBtn').click();
  await expect(page.locator('#gisImportModal')).toBeHidden();
  const read = () => page.evaluate(() => window.__testEditorTimeline.state().genericFeatures);
  await expect.poll(async () => (await read()).length).toBe(2);
  const imported = await read();
  for (const expected of qgisFixture.features) {
    const actual = imported.find(feature => feature.properties.name === expected.properties.name);
    expect(actual.id).not.toBe(expected.id);
    if (expected.geometry.type === 'Polygon') {
      // The canonical Core normalizer can reverse/rotate a ring. Check its coverage and vertices.
      expect(await page.evaluate(({ left, right }) => window.polygonClipping.xor(left, right), {
        left: actual.geometry.coordinates, right: expected.geometry.coordinates,
      })).toEqual([]);
      expect([...new Set(actual.geometry.coordinates.flat().map(JSON.stringify))].sort())
        .toEqual([...new Set(expected.geometry.coordinates.flat().map(JSON.stringify))].sort());
    } else expect(actual.geometry).toEqual(expected.geometry);
    expect(actual.properties.source.sourceId).toBe(expected.properties.source.sourceId);
    expect(actual.properties.source.details).toEqual({ ...expected.properties.source.details,
      attributes: { id: expected.id } });
  }
  await page.locator('#undoBtn').click();
  await expect.poll(async () => (await read()).length).toBe(0);
  await page.locator('#redoBtn').click();
  await expect.poll(async () => (await read()).length).toBe(2);
  if (!await page.locator('#fileMenu').isVisible()) await page.locator('#mobileFileBtn').click();
  if (!await page.locator('#dataExportBtn').isVisible()) await page.locator('#fileAdvancedBtn').click();
  await page.locator('#dataExportBtn').click();
  await selectUiOption(page, '#gisExportFormat', 'geojson-zip');
  const [download] = await Promise.all([
    page.waitForEvent('download'), page.locator('#gisExportConfirmBtn').click(),
  ]);
  const bytes = readFileSync(await download.path());
  const exported = await page.evaluate(value => JSON.parse(window.fflate.strFromU8(
    window.fflate.unzipSync(Uint8Array.from(value))['generic_features.geojson'])), [...bytes]);
  expect(exported.features).toEqual(await read());
  if (process.env.PANDOLAB_QGIS_PANDO_EXPORT) writeFileSync(process.env.PANDOLAB_QGIS_PANDO_EXPORT,
    JSON.stringify(exported), { flag: 'wx' });
  expect(errors).toEqual([]);
});
