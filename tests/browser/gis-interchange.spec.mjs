import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { expect, test } from '@playwright/test';
import { selectUiOption } from './helpers/ui-select.mjs';

const eastPrussiaFixture = process.env.PANDOLAB_EAST_PRUSSIA_FILE || 'tests/fixtures/east-prussia-1900-import.geojson';
const eastPrussiaGeometry = JSON.parse(readFileSync(eastPrussiaFixture, 'utf8')).features[0].geometry;
const planarArea = geometry => (geometry?.type === 'Polygon' ? [geometry.coordinates] : geometry?.coordinates || []).reduce((total, polygon) => {
  const ringArea = ring => Math.abs((ring || []).reduce((sum, coordinate, index, source) => {
    if (!index) return sum;
    const previous = source[index - 1];
    return sum + previous[0] * coordinate[1] - coordinate[0] * previous[1];
  }, 0)) / 2;
  return total + Math.max(0, ringArea(polygon[0]) - polygon.slice(1).reduce((sum, ring) => sum + ringArea(ring), 0));
}, 0);
const eastPrussiaExpected = {
  components: eastPrussiaGeometry.type === 'MultiPolygon' ? eastPrussiaGeometry.coordinates.length : 1,
  area: planarArea(eastPrussiaGeometry),
};

test('GeoPackage export contains QGIS-ready territorial and distribution tables', async ({ page }) => {
  test.setTimeout(300_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 30_000 });

  await page.locator('#createMenuBtn').click();
  page.once('dialog', dialog => dialog.accept('스모크 언어'));
  await page.locator('#addDistributionBtn').click();
  await selectUiOption(page, '#distributionTypeInput', 'language');
  await page.locator('#distributionTypeConfirmBtn').click();
  await page.locator('#actionsTabBtn').click();
  const territorialUnitId = await page.locator('#distributionTerritorialUnitInput option').nth(1).getAttribute('value');
  await selectUiOption(page, '#distributionTerritorialUnitInput', territorialUnitId);
  await page.locator('#distributionShareInput').fill('73');
  await page.locator('#addTerritorialDistributionBtn').click();

  await page.locator('#mobileFileBtn').click();
  await expect(page.locator('#saveProjectBtn')).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 240_000 }),
    page.locator('#saveProjectBtn').click(),
  ]);
  expect(download.suggestedFilename()).toBe('판도연구소-프로젝트.gpkg');
  const filePath = await download.path();
  const db = new DatabaseSync(filePath, { readOnly: true });
  try {
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
    for (const table of [
      'countries', 'territories', 'administrative', 'regions',
      'language_distribution', 'ethnicity_distribution', 'religion_distribution',
    ]) expect(tables.has(table)).toBe(true);

    const countryColumns = new Set(db.prepare('PRAGMA table_info(countries)').all().map(row => row.name));
    for (const field of ['id', 'name', 'type', 'parent_id', 'sovereign_id', 'valid_from', 'valid_to', 'color']) {
      expect(countryColumns.has(field)).toBe(true);
    }
    const distributionColumns = new Set(db.prepare('PRAGMA table_info(language_distribution)').all().map(row => row.name));
    for (const field of ['entry_id', 'layer_id', 'source_mode', 'territorial_unit_id', 'share', 'certainty']) {
      expect(distributionColumns.has(field)).toBe(true);
    }
    const row = db.prepare('SELECT source_mode, territorial_unit_id, share, typeof(geom) AS geometry_type FROM language_distribution').get();
    expect(row).toMatchObject({ source_mode: 'territorial', territorial_unit_id: territorialUnitId, share: 73, geometry_type: 'blob' });
    const crs = db.prepare("SELECT srs_id FROM gpkg_geometry_columns WHERE table_name='language_distribution'").get();
    expect(crs.srs_id).toBe(4326);
  } finally {
    db.close();
  }
  expect(errors).toEqual([]);
});

test('GIS data export writes only selected layers and omits project-only metadata', async ({ page }) => {
  test.setTimeout(300_000);
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });

  await page.locator('#mobileFileBtn').click();
  await page.locator('#dataExportBtn').click();
  await expect(page.locator('#gisExportModal')).toBeVisible();
  await page.locator('#gisExportForm .gis-export-layers input').evaluateAll(inputs => {
    for (const input of inputs) input.checked = input.value === 'countries';
  });
  await page.locator('#gisExportNextBtn').click();
  await expect(page.locator('#gisExportSummary')).toContainText('국가');
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 240_000 }),
    page.locator('#gisExportConfirmBtn').click(),
  ]);
  expect(download.suggestedFilename()).toBe('판도연구소-GIS-데이터.gpkg');
  const db = new DatabaseSync(await download.path(), { readOnly: true });
  try {
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
    expect(tables.has('countries')).toBe(true);
    expect(tables.has('territories')).toBe(false);
    expect(tables.has('administrative')).toBe(false);
    expect(tables.has('pandolab_project_settings')).toBe(false);
    expect(tables.has('pandolab_country_assets')).toBe(false);
  } finally {
    db.close();
  }
});

test('mobile vector import advances by stage and preserves detected choices when moving back', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });

  await page.locator('#mobileFileBtn').click();
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.locator('#openGisBtn').click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({
    name: 'mobile-region.geojson',
    mimeType: 'application/geo+json',
    buffer: Buffer.from(JSON.stringify({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        id: 'mobile-region',
        properties: { name: '모바일 시험 지역', country_id: 'DEU' },
        geometry: { type: 'Polygon', coordinates: [[[9, 50], [9, 51], [10, 51], [10, 50], [9, 50]]] },
      }],
    })),
  });
  await expect(page.locator('#gisImportModal')).toBeVisible();
  await expect(page.locator('#gisImportConfirmBtn')).toBeEnabled({ timeout: 30_000 });
  await expect(page.locator('#gisStepIndicator')).toHaveText('1/5 · 파일 확인');
  await expect(page.locator('#gisTargetTypeRow')).toBeHidden();

  await page.locator('#gisImportNextBtn').click();
  await expect(page.locator('#gisStepIndicator')).toHaveText('2/5 · 가져올 내용');
  await expect(page.locator('#gisTargetTypeRow')).toBeVisible();
  await selectUiOption(page, '#gisTargetType', 'territory');
  await expect(page.locator('#gisTargetCountryRow')).toBeVisible();
  await expect(page.locator('#gisTargetCountry')).toHaveValue('DEU');
  await page.locator('#gisImportNextBtn').click();
  await expect(page.locator('#gisStepIndicator')).toHaveText('3/5 · 속성 연결');
  await expect(page.locator('#gisMappingSummary')).toContainText('예: 모바일 시험 지역');
  const detectedNameField = await page.locator('#gisNameField').inputValue();

  await page.locator('#gisImportBackBtn').click();
  await expect(page.locator('#gisTargetType')).toHaveValue('territory');
  await page.locator('#gisImportNextBtn').click();
  await expect(page.locator('#gisNameField')).toHaveValue(detectedNameField);
  await page.locator('#gisImportNextBtn').click();
  await expect(page.locator('#gisStepIndicator')).toHaveText('4/5 · 적용 결과');
  await expect(page.locator('#gisImportImpactSummary')).toContainText('소속 국가:');
  await page.locator('#gisImportNextBtn').click();
  await expect(page.locator('#gisStepIndicator')).toHaveText('5/5 · 최종 확인');
  await expect(page.locator('#gisFinalSummary')).toContainText('전체를 독일 소속 권역');
  await expect(page.locator('#gisImportConfirmBtn')).toBeVisible();

  await page.locator('#gisImportCancelBtn').click();
  await expect(page.locator('#gisImportModal')).toBeHidden();
  await expect(page.locator('#openGisBtn')).toBeFocused();
  expect(errors).toEqual([]);
});

test('East Prussia imports as a complete German administrative unit and undo treats land transfer atomically', async ({ page }) => {
  test.setTimeout(300_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });

  await page.locator('#mobileFileBtn').click();
  const chooserPromise = page.waitForEvent('filechooser');
  await page.locator('#openGisBtn').click();
  await (await chooserPromise).setFiles(eastPrussiaFixture);
  await expect(page.locator('#gisImportForm')).not.toHaveClass(/\bis-busy\b/, { timeout: 90_000 });
  await page.locator('#gisImportNextBtn').click();
  await selectUiOption(page, '#gisTargetType', 'administrative');
  await selectUiOption(page, '#gisTargetCountry', 'DEU');
  await expect(page.locator('#gisParentRegion')).toHaveValue('');
  await page.locator('#gisImportNextBtn').click();
  await expect(page.locator('#gisNameField')).toHaveValue('pandolab_name');
  await expect(page.locator('#gisCountryField')).toHaveValue('sovereign_id');
  await page.locator('#gisImportNextBtn').click();
  await expect(page.locator('#gisStepIndicator')).toHaveText('4/5 · 적용 결과', { timeout: 90_000 });
  await expect(page.locator('#gisImportImpactSummary')).toContainText('소속 국가: 독일');
  await expect(page.locator('#gisImportImpactSummary')).toContainText('영토를 내주는 국가:');
  await page.locator('#gisImportNextBtn').click();
  await expect(page.locator('#gisImportConfirmBtn')).toHaveText('영토 이전 후 가져오기');
  await page.locator('#gisImportConfirmBtn').click();
  await expect(page.locator('#gisImportModal')).toBeHidden({ timeout: 90_000 });
  await expect(page.locator('#actionStatus')).not.toHaveClass(/\bworking\b/, { timeout: 120_000 });
  expect(errors).toEqual([]);
  await expect(page.locator('#actionStatus')).toContainText('전체 형상으로 가져왔습니다');

  const readImported = () => page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('pandolab-editor', 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const project = await new Promise((resolve, reject) => {
        const transaction = database.transaction('projects', 'readonly');
        const request = transaction.objectStore('projects').get('active-project');
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
      const feature = project?.territorialUnits?.find(item => String(item.properties?.metadata?.sourceId) === 'HIST_DEU_OSTPREUSSEN_1900');
      if (!feature) return null;
      const polygons = feature.geometry?.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry?.coordinates || [];
      const area = polygons.reduce((sum, polygon) => {
        const ringArea = ring => Math.abs((ring || []).reduce((ringSum, coordinate, index, source) => {
          if (!index) return ringSum;
          const previous = source[index - 1];
          return ringSum + previous[0] * coordinate[1] - coordinate[0] * previous[1];
        }, 0)) / 2;
        return sum + Math.max(0, ringArea(polygon[0]) - polygon.slice(1).reduce((holeSum, ring) => holeSum + ringArea(ring), 0));
      }, 0);
      return { owner: feature.properties?.sovereignId, components: feature.geometry?.coordinates?.length || 0, area };
    } finally {
      database.close();
    }
  });
  await expect.poll(readImported, { timeout: 20_000 }).toMatchObject({ owner: 'DEU', components: eastPrussiaExpected.components });
  expect((await readImported()).area).toBeCloseTo(eastPrussiaExpected.area, 8);

  await page.locator('#undoBtn').click();
  await expect.poll(readImported, { timeout: 20_000 }).toBeNull();
  await page.locator('#redoBtn').click();
  await expect.poll(readImported, { timeout: 20_000 }).toMatchObject({ owner: 'DEU', components: eastPrussiaExpected.components });
  expect((await readImported()).area).toBeCloseTo(eastPrussiaExpected.area, 8);
  expect(errors).toEqual([]);
});
