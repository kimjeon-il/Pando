import { gotoEditor } from './helpers/editor-entry.mjs';
import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { staticAutosaveProject } from '../helpers/timeline-project.mjs';
import { defaultUserPreferences, STORAGE_KEY } from "../../shared/frontend/js/modules/user-preferences.js";
import { withNativeActionDiagnostics } from './helpers/native-action-diagnostics.mjs';

const hydroSearchDiagnostic = {
  selector: '#objectSearchResults .object-search-result',
  rowSelector: '.object-search-result[data-object-key="hydro:river:00000000-0000-4000-8000-000000000005"]',
};

// Tracing delayed a positive screenshot pixel result beyond the CI poll budget.
// Preserve the real paint oracle, failure screenshots, and explicit paint proof.
test.use({ channel: 'chromium', viewport: { width: 1440, height: 900 }, trace: 'off' });

test('editing a river color updates actual GPU paint and undo restores metadata, geometry and paint', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(30_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await gotoEditor(page, '/assets/css/app.css');
  // The canonical timeline requires a lifetime and geometry binding for each
  // stored hydro identity. Extend an already serialized fixture with both.
  const hydroId = '00000000-0000-4000-8000-000000000005';
  const hydroRef = { domain: 'hydro', id: hydroId };
  const saved = staticAutosaveProject();
  saved.hydroEdits.push({ type: 'Feature', id: hydroId, geometry: null,
    properties: { pandolab_domain: 'hydro', pandolab_id: hydroId,
      pandolab_schema_version: 1, category: 'river', name: '메타데이터 검증 강',
      editorColor: '#3b82c4', notes: '', locked: false } });
  saved.geometries.push({ id: 'p8-hydro-shape', version: 1,
    geojson: { type: 'LineString', coordinates: [[5, 45], [8, 46], [10, 45]] } });
  saved.timelineRecords.lifetimes.push({
    id: 'p8-hydro-life', objectRef: hydroRef, validFrom: null, validTo: null,
  });
  saved.timelineRecords.geometryBindings.push({
    id: 'p8-hydro-binding', objectRef: hydroRef, validFrom: null, validTo: null,
    geometryRef: { id: 'p8-hydro-shape', version: 1 },
  });
  const preferences = defaultUserPreferences(); preferences.selection.outlineVisible = false;
  await page.evaluate(({ saved, preferences, key }) => {
    localStorage.setItem('pandolab-editor-project', JSON.stringify(saved));
    localStorage.setItem(key, JSON.stringify(preferences));
  }, { saved, preferences, key: STORAGE_KEY });
  await gotoEditor(page, '/?debug=1');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 30_000 });
  await page.locator('#objectSearchBtn').click();
  await page.locator('#objectSearchInput').fill('메타데이터 검증 강');
  await withNativeActionDiagnostics(page, testInfo, { ...hydroSearchDiagnostic, label: 'hydro-search-selection' }, async () => {
    await page.locator('#objectSearchResults .object-search-result').click();
  });
  await expect(page.locator('#hydroProperties')).toBeVisible();
  await expect(page.locator('#hydroEditFields')).toBeVisible();
  await expect(page.locator('#hydroBuiltinHelp')).toBeHidden();
  await expect(page.locator('#hydroBuiltinNotes')).toBeHidden();
  await expect(page.locator('details[data-od-id="hydro-details"] summary')).toHaveText('비고');
  await expect(page.locator('label[for="hydroNotesInput"]')).toHaveClass(/ui-visually-hidden/);
  await page.locator('details[data-od-id="hydro-details"] summary').click();
  await expect(page.locator('#hydroNotesInput')).toBeVisible();
  await page.waitForFunction(() => window.__PANDOLAB_MAP_HOST__.getViewState().projection === 'flat');
  await page.locator('#focusSelectedObjectBtn').click();
  await page.locator('#actionsTabBtn').click();
  await expect(page.locator('#hydroVerticesBtn')).toBeVisible();
  await page.locator('#hydroVerticesBtn').click();
  await expect(page.locator('#modeTaskName')).toHaveText('수계 좌표 편집');
  await expect(page.locator('#modeTaskStage')).toHaveText('정점 이동');
  await expect(page.locator('#modeTaskTargetSummary')).toHaveText('메타데이터 검증 강');
  await expect(page.locator('#modeTaskViewTime')).toBeHidden();
  await expect(page.locator('#modeTaskAffectedSummary')).toBeHidden();
  await expect(page.locator('#modePrimaryBtn')).toHaveText('좌표 편집 완료');
  await page.locator('#modePrimaryBtn').click();
  await expect(page.locator('#modeActionBar')).toBeHidden();
  await page.locator('#editorTabBtn').click();
  await page.addStyleTag({ content: '#map .map-selection-outline, #map .map-selection-fill, #map .object-edit-outline { visibility: hidden !important; }' });
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpu.hydroEditBatchCount)).toBe(1);
  const originalColor = await page.locator('#hydroColorInput').inputValue();
  const original = await page.locator('path.hydro-edit-shape').evaluate(node => structuredClone(node.__data__));
  const pixelSamples = [];
  const colorPixels = async color => {
    const screenshot = (await page.screenshot()).toString('base64');
    const sample = await page.evaluate(async ({ screenshot, color }) => {
      const image = new Image(); image.src = `data:image/png;base64,${screenshot}`; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(image, 0, 0);
      const map = document.querySelector('#map').getBoundingClientRect();
      const point = window.__PANDOLAB_VIEW_DEBUG__.geoToScreen([8, 46]);
      const pixels = context.getImageData(Math.round(map.x + point[0]) - 20, Math.round(map.y + point[1]) - 20, 40, 40).data;
      const expected = [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16));
      let count = 0;
      for (let index = 0; index < pixels.length; index += 4) if (expected.every((value, channel) => Math.abs(pixels[index + channel] - value) <= 8)) count++;
      return { color, count, revision: window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpu.hydroEditRevision };
    }, { screenshot, color });
    pixelSamples.push(sample);
    return sample.count;
  };
  await expect.poll(() => colorPixels(originalColor)).toBeGreaterThan(0);
  const before = await page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpu.hydroEditRevision);
  await page.locator('#hydroColorTrigger').click();
  const swatch = page.locator(`#hydroColorPopover [data-color-value]:not([data-color-value="${originalColor}"])`).first();
  const nextColor = await swatch.getAttribute('data-color-value');
  await swatch.click();
  await expect(page.locator('#hydroColorInput')).toHaveValue(nextColor);
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpu.hydroEditRevision)).toBe(before + 1);
  await expect.poll(() => colorPixels(nextColor)).toBeGreaterThan(0);
  await page.locator('#undoBtn').click();
  await expect(page.locator('#hydroProperties')).toBeHidden();
  await page.locator('#objectSearchBtn').click();
  await page.locator('#objectSearchInput').fill('메타데이터 검증 강');
  await withNativeActionDiagnostics(page, testInfo, { ...hydroSearchDiagnostic, label: 'hydro-search-reselection' }, async () => {
    await page.locator('#objectSearchResults .object-search-result').click();
  });
  await expect(page.locator('#hydroColorInput')).toHaveValue(originalColor);
  expect(await page.locator('path.hydro-edit-shape').evaluate(node => node.__data__)).toEqual(original);
  await expect.poll(() => colorPixels(originalColor), { timeout: 30_000 }).toBeGreaterThan(0);
  expect(errors).toEqual([]);
  const paintProof = testInfo.outputPath('hydro-color-paint.json');
  await writeFile(paintProof, JSON.stringify(pixelSamples, null, 2));
  await testInfo.attach('hydro-color-paint', { path: paintProof, contentType: 'application/json' });
});
