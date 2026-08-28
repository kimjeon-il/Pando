import { DatabaseSync } from 'node:sqlite';
import { expect, test } from '@playwright/test';

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
  await page.locator('#distributionTypeInput').selectOption('language');
  await page.locator('#distributionTypeConfirmBtn').click();
  await page.locator('#actionsTabBtn').click();
  const regionId = await page.locator('#distributionRegionInput option').nth(1).getAttribute('value');
  await page.locator('#distributionRegionInput').selectOption(regionId);
  await page.locator('#distributionShareInput').fill('73');
  await page.locator('#addRegionDistributionBtn').click();

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
      'countries', 'territories', 'administrative_units', 'historical_regions',
      'language_distribution', 'ethnicity_distribution', 'religion_distribution',
    ]) expect(tables.has(table)).toBe(true);

    const countryColumns = new Set(db.prepare('PRAGMA table_info(countries)').all().map(row => row.name));
    for (const field of ['id', 'name', 'type', 'parent_id', 'sovereign_id', 'valid_from', 'valid_to', 'color']) {
      expect(countryColumns.has(field)).toBe(true);
    }
    const distributionColumns = new Set(db.prepare('PRAGMA table_info(language_distribution)').all().map(row => row.name));
    for (const field of ['entry_id', 'layer_id', 'source_mode', 'region_id', 'share', 'certainty']) {
      expect(distributionColumns.has(field)).toBe(true);
    }
    const row = db.prepare('SELECT source_mode, region_id, share, typeof(geom) AS geometry_type FROM language_distribution').get();
    expect(row).toMatchObject({ source_mode: 'region', region_id: regionId, share: 73, geometry_type: 'blob' });
    const crs = db.prepare("SELECT srs_id FROM gpkg_geometry_columns WHERE table_name='language_distribution'").get();
    expect(crs.srs_id).toBe(4326);
  } finally {
    db.close();
  }
  expect(errors).toEqual([]);
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
  await page.locator('#fileImportMenuBtn').click();
  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.locator('#importVectorBtn').click();
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
  await expect(page.locator('#gisStepIndicator')).toHaveText('2/5 · 가져올 종류');
  await page.locator('#gisTargetType').selectOption('region');
  await page.locator('#gisImportNextBtn').click();
  await expect(page.locator('#gisStepIndicator')).toHaveText('3/5 · 속성 연결');
  await expect(page.locator('#gisMappingSummary')).toContainText('예: 모바일 시험 지역');
  const detectedNameField = await page.locator('#gisNameField').inputValue();

  await page.locator('#gisImportBackBtn').click();
  await expect(page.locator('#gisTargetType')).toHaveValue('region');
  await page.locator('#gisImportNextBtn').click();
  await expect(page.locator('#gisNameField')).toHaveValue(detectedNameField);
  await page.locator('#gisImportNextBtn').click();
  await expect(page.locator('#gisFixedOpenModeNote')).toBeVisible();
  await page.locator('#gisImportNextBtn').click();
  await expect(page.locator('#gisStepIndicator')).toHaveText('5/5 · 최종 확인');
  await expect(page.locator('#gisFinalSummary')).toContainText('현재 프로젝트에 가져옵니다');
  await expect(page.locator('#gisImportConfirmBtn')).toBeVisible();

  await page.locator('#gisImportCancelBtn').click();
  await expect(page.locator('#gisImportModal')).toBeHidden();
  await expect(page.locator('#mobileFileBtn')).toBeFocused();
  expect(errors).toEqual([]);
});
